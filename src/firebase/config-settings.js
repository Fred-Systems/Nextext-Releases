import { useSyncExternalStore } from "react";
import { doc, onSnapshot, getDoc, setDoc } from "firebase/firestore";
import { db } from "./config";

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
// component) on the same doc into ONE Firestore listener — critical because
// each listener is a BatchGetDocuments RPC and the free tier quickly returns
// 429 "resource-exhausted" under that load.
let cache = loadCache();
let quotaLimited = false;
const listeners = new Set();
let unsub = null;
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
        if (isQuotaError(err)) {
          quotaLimited = true;
          console.warn("[globalSettings] Firestore quota limited (429). Using cached/default values and retrying.");
        } else {
          console.error("[globalSettings] listener error:", err);
        }
        // Firestore retries on its own, but add a manual re-subscribe backoff so
        // we recover once the quota window resets.
        if (!retryTimer) {
          retryTimer = setTimeout(() => { retryTimer = null; restart(); }, 20000);
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

function subscribe(cb) {
  listeners.add(cb);
  start();
  return () => { listeners.delete(cb); };
}

function getSnapshot() { return cache; }
function getQuotaSnapshot() { return quotaLimited; }

export function useGlobalSettings() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// True while Firestore is returning 429 resource-exhausted for the config doc.
// Lets the UI show a non-blocking "temporarily busy" banner instead of a blank.
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
      updatedBy: null,
      updatedAt: null,
    });
  }
}

export async function updateGlobalSettings(patch, adminUid) {
  await setDoc(doc(db, ...CONFIG_REF_PATH), { ...patch, updatedBy: adminUid, updatedAt: new Date() }, { merge: true });
}
