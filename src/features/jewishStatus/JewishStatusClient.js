// Provider adapter for JewishStatus. Fetches the public feed and normalizes it.
// GUESSED ENDPOINT: https://api.jewishstatus.com/v1/feed  (verify before prod)
// Fail-soft: any error (403/429/5xx/timeout/malformed) returns an empty feed.

import { fetchJson, normalizeJewishStatus, STATUS_SOURCES } from "./normalize";

const BASE_URL = "https://api.jewishstatus.com/v1"; // GUESSED — verify
const FEED_PATH = "/feed"; // GUESSED — verify

export async function fetchJewishStatusFeed() {
  try {
    const raw = await fetchJson(`${BASE_URL}${FEED_PATH}`, { timeoutMs: 8000 });
    return normalizeJewishStatus(raw);
  } catch (e) {
    console.warn("[JewishStatusClient] feed failed:", e?.message || e);
    return { posts: [], creators: {} };
  }
}

export { STATUS_SOURCES };
