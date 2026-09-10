// NEXText Remote Update Manager — REMOTE Web/Config path.
//
// This module is ONE half of a deliberately split update architecture:
//
//   A. REMOTE WEB/CONFIG UPDATE  -> this file + config/remoteConfig Firestore doc
//      (feature flags, web build number, config version, APK version policy).
//      Does NOT change the installed APK version.
//
//   B. NATIVE APK UPDATE         -> src/updater/updateChecker.js
//      (checks GitHub Releases for a newer signed APK; native install flow).
//      Required whenever native code / Capacitor plugins / manifest change.
//
// The two are intentionally separate. Admin changing remote configuration never
// bumps the APK version, and a web-only deploy never creates a fake APK release.
//
// Security: config/remoteConfig is world-readable (no secrets) and admin-write-
// only (enforced by firestore.rules). Never store keys/credentials here.

import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot, getDoc, setDoc } from "firebase/firestore";
import { db } from "./config";
import { APP_VERSION, compareVersions } from "../version";

export const REMOTE_CONFIG_DOC = doc(db, "config", "remoteConfig");
const CACHE_KEY = "nextext_remote_config_cache";

// Discovered feature flags. Admin toggles these remotely. Only list flags whose
// corresponding functionality actually exists in this build — never create a
// fake toggle that does not affect anything.
export const REMOTE_FEATURE_KEYS = [
  "statusExtend",
  "jewishStyleUpdates",
  "newStatusBuilder",
  "appleMusicSmartSearch",
  "zemerSmartSearch",
];

export const DEFAULT_REMOTE_CONFIG = {
  configVersion: 1,
  webBuild: "2026.09.08.1",
  latestApkVersion: APP_VERSION,
  minApkVersion: "1.7.95",
  updateSeverity: "optional", // optional | recommended | required
  updateMessage: "",
  note: "",
  lastDeployAt: null,
  features: {},
};

// Validate/normalize an incoming remote config. Returns null when malformed so
// the caller can keep the last-known-good value instead of crashing.
function sanitize(raw, lastGood) {
  if (!raw || typeof raw !== "object") return null;
  const out = {
    configVersion: Number(raw.configVersion) || lastGood?.configVersion || 1,
    webBuild: typeof raw.webBuild === "string" ? raw.webBuild : lastGood?.webBuild || DEFAULT_REMOTE_CONFIG.webBuild,
    latestApkVersion: typeof raw.latestApkVersion === "string" ? raw.latestApkVersion : lastGood?.latestApkVersion || APP_VERSION,
    minApkVersion: typeof raw.minApkVersion === "string" ? raw.minApkVersion : lastGood?.minApkVersion || "1.7.95",
    updateSeverity: ["optional", "recommended", "required"].includes(raw.updateSeverity)
      ? raw.updateSeverity
      : lastGood?.updateSeverity || "optional",
    updateMessage: typeof raw.updateMessage === "string" ? raw.updateMessage : "",
    note: typeof raw.note === "string" ? raw.note : "",
    lastDeployAt: raw.lastDeployAt ?? lastGood?.lastDeployAt ?? null,
    features: {},
  };
  const feats = raw.features && typeof raw.features === "object" ? raw.features : {};
  for (const k of REMOTE_FEATURE_KEYS) {
    const f = feats[k];
    out.features[k] =
      f && typeof f === "object"
        ? {
            enabled: !!f.enabled,
            rolloutPct: typeof f.rolloutPct === "number" ? Math.max(0, Math.min(100, f.rolloutPct)) : 100,
            users: Array.isArray(f.users) ? f.users : undefined,
            minApk: typeof f.minApk === "string" ? f.minApk : undefined,
            expiresAt: f.expiresAt ?? undefined,
          }
        : { enabled: false, rolloutPct: 100 };
  }
  return out;
}

function hashUid(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return h;
}

// Evaluate a single feature flag against the caller's context.
// opts: { uid, apkVersion }
export function getFeatureFlag(config, name, opts = {}) {
  const f = config?.features?.[name];
  if (!f || f.enabled === false) return false;
  if (f.minApk && opts.apkVersion && compareVersions(opts.apkVersion, f.minApk) < 0) return false;
  if (f.expiresAt && typeof f.expiresAt.toMillis === "function" && f.expiresAt.toMillis() < Date.now()) return false;
  if (Array.isArray(f.users) && f.users.length && opts.uid && !f.users.includes(opts.uid)) return false;
  if (f.rolloutPct != null && f.rolloutPct < 100 && opts.uid) {
    if (hashUid(opts.uid) % 100 >= f.rolloutPct) return false;
  }
  return true;
}

// Classify APK update necessity using the admin-set policy.
export function getApkUpdateStatus(config, apkVersion = APP_VERSION) {
  const latest = config?.latestApkVersion || APP_VERSION;
  const min = config?.minApkVersion || "0";
  const cmpMin = compareVersions(min, apkVersion);
  const cmpLatest = compareVersions(latest, apkVersion);
  let severity = "none";
  if (cmpMin > 0) severity = "required";
  else if (cmpLatest > 0) {
    const s = config?.updateSeverity;
    severity = s === "required" ? "required" : s === "recommended" ? "recommended" : "optional";
  }
  return {
    severity,
    latestApkVersion: latest,
    minApkVersion: min,
    message: config?.updateMessage || "",
  };
}

// Local, resilient subscription. Caches last-known-good to localStorage and
// falls back to it when the network/permissions fail, so the app never crashes
// or wipes working settings offline.
export function useRemoteConfig() {
  const lastGood = useRef(null);
  const [config, setConfig] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const s = sanitize(JSON.parse(raw), null);
        if (s) {
          lastGood.current = s;
          return s;
        }
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_REMOTE_CONFIG;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const unsub = onSnapshot(
      REMOTE_CONFIG_DOC,
      (snap) => {
        if (!active) return;
        const sanitized = sanitize(snap.data(), lastGood.current);
        if (sanitized) {
          lastGood.current = sanitized;
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(sanitized));
          } catch {
            /* ignore */
          }
          setConfig(sanitized);
          setError(null);
        } else {
          // Malformed remote doc: keep last-known-good, surface a soft error.
          setError(new Error("Malformed remote config received; using cached."));
        }
        setLoading(false);
      },
      (e) => {
        if (!active) return;
        // Offline / permission error: state already holds the cached value.
        setError(e);
        setLoading(false);
      }
    );
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return { config, loading, error };
}

// Read the doc once without subscribing (used for admin init / manual checks).
export async function fetchRemoteConfig() {
  try {
    const snap = await getDoc(REMOTE_CONFIG_DOC);
    return snap.exists() ? sanitize(snap.data(), null) : null;
  } catch {
    return null;
  }
}

// ── Admin writers (require isAdmin() per firestore.rules) ─────────────────

export async function setRemoteConfigPatch(patch, adminUid) {
  await setDoc(REMOTE_CONFIG_DOC, { ...patch, updatedBy: adminUid, updatedAt: new Date() }, { merge: true });
}

export async function setFeatureFlag(name, flagPatch, adminUid) {
  const prev = await fetchRemoteConfig();
  const current = prev?.features?.[name] || { enabled: false, rolloutPct: 100 };
  const next = { ...current, ...flagPatch };
  await setDoc(REMOTE_CONFIG_DOC, { features: { [name]: next }, updatedBy: adminUid, updatedAt: new Date() }, { merge: true });
  return next;
}

// Atomically bump configVersion (call after a meaningful change so clients can
// detect a newer configuration). Does not touch the APK version.
export async function bumpRemoteConfigVersion(adminUid) {
  const prev = await fetchRemoteConfig();
  const nextVersion = (prev?.configVersion || 0) + 1;
  await setDoc(
    REMOTE_CONFIG_DOC,
    { configVersion: nextVersion, updatedBy: adminUid, updatedAt: new Date() },
    { merge: true }
  );
  return nextVersion;
}

// Restore a previously captured config snapshot (rollback). The admin UI is
// responsible for capturing prevConfig before a change.
export async function rollBackRemoteConfig(previous, adminUid) {
  if (!previous) return;
  await setDoc(REMOTE_CONFIG_DOC, { ...previous, updatedBy: adminUid, updatedAt: new Date() }, { merge: true });
}
