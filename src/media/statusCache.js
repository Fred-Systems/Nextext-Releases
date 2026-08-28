// Bounded LRU media cache for Status assets: poster, card preview, HLS segments (via platform cache), fallback.
// Uses IndexedDB via localStorage fallback for small assets; respects expiry.

const CACHE_PREFIX = "nextext_status_cache_";
const INDEX_KEY = "nextext_media_cache_index";
const MAX_ENTRIES = 80; // bounded

function loadIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveIndex(idx) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch {}
}

export function getCachedAsset(statusId, assetVersion) {
  const key = `${CACHE_PREFIX}${statusId}_${assetVersion}`;
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

export function setCachedAsset(statusId, assetVersion, data, expiresAt) {
  const idx = loadIndex();
  idx[`${statusId}_${assetVersion}`] = { ts: Date.now(), expiresAt: expiresAt?.toMillis?.() || expiresAt || null };
  // LRU eviction: keep most recent MAX_ENTRIES, prefer unexpired
  const entries = Object.entries(idx).sort((a, b) => b[1].ts - a[1].ts);
  if (entries.length > MAX_ENTRIES) {
    for (let i = MAX_ENTRIES; i < entries.length; i++) {
      try { localStorage.removeItem(`${CACHE_PREFIX}${entries[i][0]}`); } catch {}
      delete idx[entries[i][0]];
    }
  }
  saveIndex(idx);
  try { localStorage.setItem(`${CACHE_PREFIX}${statusId}_${assetVersion}`, JSON.stringify(data)); } catch {}
}

export function isCacheValid(entry) {
  if (!entry) return false;
  if (!entry.expiresAt) return true;
  return Date.now() < entry.expiresAt;
}

export function clearStatusCache(statusId) {
  const idx = loadIndex();
  for (const k of Object.keys(idx)) {
    if (k.startsWith(`${statusId}_`)) {
      try { localStorage.removeItem(`${CACHE_PREFIX}${k}`); } catch {}
      delete idx[k];
    }
  }
  saveIndex(idx);
}

// Signed URL helper: uses Supabase createSignedUrl with TTL capped to expiry
export async function getSignedUrlForPath(path, expiresAt) {
  if (!path) return null;
  const { supabase } = await import("../supabase/config.js");
  const now = Date.now();
  const expMs = expiresAt?.toMillis?.() || (expiresAt ? new Date(expiresAt).getTime() : now + 3600 * 1000);
  const ttlSec = Math.max(60, Math.min(3600, Math.floor((expMs - now) / 1000)));
  if (ttlSec <= 0) return null;
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(path, ttlSec);
  if (error) return null;
  return data.signedUrl;
}
