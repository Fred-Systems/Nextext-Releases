import { useSyncExternalStore, useState, useEffect } from "react";
import { doc, onSnapshot, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "./config";
import { onAuthStateChanged } from "firebase/auth";

const CONFIG_REF_PATH = ["config", "globalSettings"];
const CACHE_KEY = "nextext_global_settings_cache";

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// A single shared subscription backs every useGlobalSettings() consumer. This
// collapses what used to be ~24 concurrent onSnapshot listeners (one per
// component) on the same doc into ONE Firestore listener.
//
// CRITICAL: the Firestore rule for config/{doc} requires isSignedIn(). Starting
// the listener before auth resolves made the first read unauthenticated, which
// Firestore denied ("Missing or insufficient permissions") — and our retry
// loop then hammered the backend into a 429 all day. So we only subscribe once
// the user is actually signed in.
let cache = loadCache();
let quotaLimited = false;
const listeners = new Set();
let unsub = null;
let authSub = null;
let retryTimer = null;

function emit() {
  listeners.forEach((l) => {
    try { l(); } catch {}
  });
}

function isQuotaError(err) {
  const s = String(err?.code || err?.name || err?.message || "");
  return s.includes("resource-exhausted") || s.includes("429") || s.toLowerCase().includes("quota");
}

function start() {
  if (unsub) return;
  if (!auth.currentUser) {
    // Wait for auth before subscribing, so we never read unauthenticated
    // (which trips the isSignedIn() rule and starts a deny/retry loop).
    if (!authSub) {
      authSub = onAuthStateChanged(auth, (u) => {
        if (u && !unsub) start();
      });
    }
    return;
  }
  try {
    unsub = onSnapshot(
      doc(db, ...CONFIG_REF_PATH),
      (snap) => {
        quotaLimited = false;
        cache = snap.exists() ? snap.data() : null;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
        emit();
      },
      (err) => {
        // Only retry on quota errors. Permission errors mean we're not
        // supposed to read this — retrying would just loop into another 429.
        if (isQuotaError(err)) {
          quotaLimited = true;
          console.warn("[globalSettings] Firestore quota limited (429). Using cached/default values and retrying.");
          if (!retryTimer) {
            retryTimer = setTimeout(() => { retryTimer = null; restart(); }, 20000);
          }
        } else {
          console.error("[globalSettings] listener error:", err);
        }
        emit();
      }
    );
  } catch (e) {
    console.error("[globalSettings] failed to subscribe:", e);
  }
}

function restart() {
  if (unsub) { try { unsub(); } catch {} unsub = null; }
  start();
}

export function subscribe(cb) {
  listeners.add(cb);
  start();
  return () => { listeners.delete(cb); };
}

export function getSnapshot() { return cache; }
export function getQuotaSnapshot() { return quotaLimited; }

export function useGlobalSettings() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useGlobalSettingsQuotaLimited() {
  return useSyncExternalStore(subscribe, getQuotaSnapshot, getQuotaSnapshot);
}

export async function ensureGlobalSettingsExist() {
  const ref = doc(db, ...CONFIG_REF_PATH);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      defaultDailyLimitBytes: null,
      mediaExpiryDays: 3,
      editWindowMinutes: 20,
      forceLogoutNonAdmins: false,
      hideStt: false,
      mediaAutoDelete: false,
      mediaAutoDeleteUserVisible: true,
      mediaAutoDeleteFallback: "expiry",
      statusVideoPipelineEnabled: false,
      show_video_thumbnails: true,
      updatedBy: null,
      updatedAt: null,
    });
  }
}

export async function updateGlobalSettings(patch, adminUid) {
  await setDoc(doc(db, ...CONFIG_REF_PATH), { ...patch, updatedBy: adminUid, updatedAt: new Date() }, { merge: true });
}

// ── Background-music download permission (mirrors the Jewish Statuses override) ──
// Stored as globalSettings.musicDownloads.enabled (global ON/OFF) plus a per-user
// `musicDownloadsOverride` on the user doc ("inherit" | "enabled" | "disabled").
// Truth table: global ON + inherit -> enabled; global OFF + inherit -> disabled;
// global ON + disabled -> disabled; global OFF + enabled -> enabled.
export function resolveMusicDownloadAllowed(globalSettings, userDoc) {
  const globalEnabled = globalSettings?.musicDownloads?.enabled === true;
  const override = userDoc?.musicDownloadsOverride || "inherit";
  if (override === "enabled") return true;
  if (override === "disabled") return false;
  return globalEnabled;
}

// ── Cloned-voice test access (mirrors the Jewish Status downloads override) ──
// Stored as globalSettings.clonedVoiceTest.enabled (global ON/OFF, default OFF)
// plus a per-user `clonedVoiceTestOverride` on the user doc
// ("inherit" | "enabled" | "disabled").
// Truth table: global ON + inherit -> allowed; global OFF + inherit -> denied;
// global ON + disabled -> denied; global OFF + enabled -> allowed.
export function resolveClonedVoiceTestAccess(globalSettings, userDoc) {
  const globalEnabled = globalSettings?.clonedVoiceTest?.enabled === true;
  const override = userDoc?.clonedVoiceTestOverride || "inherit";
  if (override === "enabled") return true;
  if (override === "disabled") return false;
  return globalEnabled;
}

// ── Admin Default Launch Page (single authoritative startup destination) ──
// Stored server-side as globalSettings.launchPageDefault ("chats" | "groups").
// Returns the configured value, or null when the admin hasn't configured one
// (callers then fall back to the user's local launch-page setting, then Chats).
// Server-side so it survives reinstall/storage-clear/new-device.
export function getDefaultLaunchPage(globalSettings) {
  const v = globalSettings?.launchPageDefault;
  return v === "groups" || v === "chats" ? v : null;
}

// ── General app media storage provider ──
// Authoritative value lives in Firestore config/globalSettings.active_storage_provider.
// Cloudinary is the intended default (NOT Supabase). Never fall back to Supabase.
export function getActiveStorageProvider(globalSettings) {
  return globalSettings?.active_storage_provider === "supabase" ? "supabase" : "cloudinary";
}

// ── Jewish Status downloads (mirrors the music-download permission architecture) ──
// globalSettings.jewishStatuses.downloads.enabled (default OFF) + per-user
// `jewishStatusDownloadsOverride` ("inherit" | "enabled" | "disabled").
export function resolveJewishStatusDownloadAllowed(globalSettings, userDoc) {
  const globalEnabled = globalSettings?.jewishStatuses?.downloads?.enabled === true;
  const override = userDoc?.jewishStatusDownloadsOverride || "inherit";
  if (override === "enabled") return true;
  if (override === "disabled") return false;
  return globalEnabled;
}

// ── Jewish Status attribution (admin-controllable) ──
export function resolveJewishStatusAttribution(globalSettings) {
  const a = globalSettings?.jewishStatuses?.attribution || {};
  return {
    show: a.show !== false, // default SHOW
    text: a.text || "Statuses courtesy of JewishStatus & YidStatus. This app is not affiliated with either service.",
    jewishStatusLink: a.jewishStatusLink || "https://jewishstatus.com",
    yidStatusLink: a.yidStatusLink || "https://yidstatus.com",
  };
}

// ── Status Builder version flag (OLD vs NEW WhatsApp-style builder) ──
// Authoritative value: globalSettings.statusBuilder.version ("new" | "old",
// also accepts "new_for_all" / "old_for_all"). Default is "new".
// Server-side (Firestore) — survives reload/logout/reinstall/device change.
// Single resolver: every builder entry point must go through it (no scattered
// `if (setting === "new")` checks).
export function getStatusBuilderVersion(globalSettings) {
  const v = String(globalSettings?.statusBuilder?.version || "new").toLowerCase();
  if (v === "old" || v === "old_for_all") return "old";
  return "new";
}

// ── Google Sign-In visibility (default HIDDEN — provider not configured) ──
export function resolveGoogleSignInVisible(globalSettings) {
  return globalSettings?.auth?.googleSignIn === "show";
}

// ── Announcements ──
// Admin posts a site-wide announcement; it shows at the top of every user's chat
// list until the user dismisses it (dismissal is per-user, stored on their doc).
export async function setAnnouncement(text, myUid) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(db, ...CONFIG_REF_PATH), { announcement: { id, text: clean, ts: Date.now(), by: myUid } }, { merge: true });
  return id;
}

export async function clearAnnouncement() {
  await setDoc(doc(db, ...CONFIG_REF_PATH), { announcement: null }, { merge: true });
}

export async function dismissAnnouncement(myUid, id) {
  if (!myUid || !id) return;
  await setDoc(doc(db, "users", myUid), { dismissedAnnouncementId: id }, { merge: true });
}

// Reactive read of the current user's dismissed announcement id.
export function useDismissedAnnouncement(myUid) {
  const [id, setId] = useState(null);
  useEffect(() => {
    if (!myUid) return undefined;
    const ref = doc(db, "users", myUid);
    const unsub = onSnapshot(ref, (s) => setId(s.data()?.dismissedAnnouncementId || null), () => {});
    return () => unsub();
  }, [myUid]);
  return id;
}

// ── Custom AI personas (admin-added) ──
// Each persona: { key, name, icon, systemPrompt, speakStyle, answerStyle,
// description, voiceRef? }. Stored in config/globalSettings.personas (array).
export async function setPersona(p) {
  if (!p || !p.key || !p.name) return;
  const ref = doc(db, ...CONFIG_REF_PATH);
  const snap = await getDoc(ref);
  const arr = snap.exists() ? (snap.data()?.personas || []) : [];
  const idx = arr.findIndex((x) => x.key === p.key);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...p };
  else arr.push(p);
  await setDoc(ref, { personas: arr }, { merge: true });
}

export async function deletePersona(key) {
  if (!key) return;
  const ref = doc(db, ...CONFIG_REF_PATH);
  const snap = await getDoc(ref);
  const arr = snap.exists() ? (snap.data()?.personas || []) : [];
  await setDoc(ref, { personas: arr.filter((x) => x.key !== key) }, { merge: true });
}
