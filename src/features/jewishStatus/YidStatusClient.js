// Provider adapter for YidStatus. Fetches the public feed and normalizes it.
// GUESSED ENDPOINT: https://api.yidstatus.com/v1/statuses  (verify before prod)
// Fail-soft: any error (403/429/5xx/timeout/malformed) returns an empty feed.

import { fetchJson, normalizeYidStatus, STATUS_SOURCES } from "./normalize";

const BASE_URL = "https://api.yidstatus.com/v1"; // GUESSED — verify
const FEED_PATH = "/statuses"; // GUESSED — verify

export async function fetchYidStatusFeed() {
  try {
    const raw = await fetchJson(`${BASE_URL}${FEED_PATH}`, { timeoutMs: 8000 });
    return normalizeYidStatus(raw);
  } catch (e) {
    console.warn("[YidStatusClient] feed failed:", e?.message || e);
    return { posts: [], creators: {} };
  }
}

export { STATUS_SOURCES };
