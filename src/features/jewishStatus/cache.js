// Device-side cache for Jewish Statuses METADATA ONLY (no media is ever stored).
// Caches the merged raw feed so the tab can render instantly on open and refresh
// in the background only when stale.

const CACHE_KEY = "nextext_jewish_statuses_cache_v1";
const STALE_MS = 15 * 60 * 1000; // 15 minutes

export function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function isStale(savedAt, now = Date.now()) {
  return now - (savedAt || 0) > STALE_MS;
}
