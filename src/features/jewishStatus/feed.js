// Feed assembly: fetch from both providers, merge + dedupe creators across
// providers, apply admin filters, and cache metadata. Firebase is only read by
// the caller (useGlobalSettings + per-user override) — this module never touches
// Firestore. If one provider fails, the other is used; if both fail, an empty
// list is returned (never throws).

import { STATUS_SOURCES } from "./normalize";
import { fetchJewishStatusFeed } from "./JewishStatusClient";
import { fetchYidStatusFeed } from "./YidStatusClient";
import { loadCache, saveCache, isStale } from "./cache";

const PROVIDERS = [
  {
    key: STATUS_SOURCES.JEWISH_STATUS,
    fetch: fetchJewishStatusFeed,
    isEnabled: (cfg) => cfg?.sources?.jewishStatus?.enabled !== false,
  },
  {
    key: STATUS_SOURCES.YID_STATUS,
    fetch: fetchYidStatusFeed,
    isEnabled: (cfg) => cfg?.sources?.yidStatus?.enabled !== false,
  },
];

// Merge multiple provider results into one feed, deduplicating creators by their
// normalized key (so the same musician across both providers appears once, with
// all their posts combined).
export function mergeFeeds(results) {
  const creators = {};
  for (const r of results) {
    if (!r || !r.creators) continue;
    for (const c of Object.values(r.creators)) {
      const existing = creators[c.key];
      if (existing) {
        existing.posts.push(...c.posts);
        if (!existing.sources.includes(c.sources[0])) existing.sources.push(c.sources[0]);
        Object.assign(existing.providerCreatorIds, c.providerCreatorIds || {});
        if (!existing.avatarUrl && c.avatarUrl) existing.avatarUrl = c.avatarUrl;
      } else {
        creators[c.key] = { ...c };
      }
    }
  }
  // Newest post first within each creator.
  Object.values(creators).forEach((c) => c.posts.sort((a, b) => b.createdAt - a.createdAt));
  return { creators, posts: [] };
}

// Apply admin filtering: per-source enable, blocked creators, blocked statuses,
// and disabled categories. `config` is the globalSettings doc (uses .jewishStatuses).
export function applyFilters(merged, config) {
  const cfg = config?.jewishStatuses || {};
  const blockedCreators = new Set(cfg.blockedCreators || []);
  const blockedStatuses = new Set(cfg.blockedStatuses || []);
  const categories = cfg.categories || {};

  // Admin-controlled retention window (Batch 4 item H): statuses older than
  // retentionDays are hidden from normal browsing. We never delete the third-party
  // source data — only filter at the display layer.
  const retentionDays = (typeof cfg.retentionDays === "number" && cfg.retentionDays > 0)
    ? cfg.retentionDays
    : null;
  const cutoffMs = retentionDays ? Date.now() - retentionDays * 24 * 60 * 60 * 1000 : 0;

  const filtered = {};
  for (const c of Object.values(merged.creators || {})) {
    if (blockedCreators.has(c.key)) continue;
    const visiblePosts = c.posts.filter((p) => {
      if (blockedStatuses.has(p.id)) return false;
      const cat = p.category || "other";
      if (categories[cat] === false) return false;
      if (retentionDays && p.createdAt && p.createdAt < cutoffMs) return false;
      return true;
    });
    if (!visiblePosts.length) continue;
    filtered[c.key] = { ...c, posts: visiblePosts };
  }
  return filtered;
}

function toSortedArray(creatorsObj) {
  return Object.values(creatorsObj).sort(
    (a, b) => (b.posts[0]?.createdAt || 0) - (a.posts[0]?.createdAt || 0)
  );
}

// A single in-flight refresh is shared across every concurrent caller (multiple
// mount/unmount cycles, repeated tab visits) so we never fire duplicate fetch
// storms. Each visit reuses the same promise instead of spawning a new ~60-request
// burst on top of the previous one.
let inFlight = null;
// Last background-refreshed result, reused within a cooldown window so rapidly
// re-opening the page does not re-hit the network.
let lastBackground = null;
let lastBackgroundAt = 0;
const REFRESH_COOLDOWN_MS = 30000;

// In-memory (RAM) cache of the fully assembled feed. This is the authoritative
// short-TTL cache that survives tab navigation WITHIN a session: leaving and
// re-entering Jewish Status a dozen times in a row must NOT trigger a new
// ~65-request burst each time. The localStorage cache (cache.js) persists across
// reloads; this RAM cache keeps repeat visits instant without touching the
// network at all until it genuinely goes stale.
let ramCache = { savedAt: 0, creators: null };
const RAM_TTL_MS = 120000; // 2 minutes

// Per-creator posts cache (module-level, short TTL). The dominant cost of the
// Jewish Status load is the ≤60 per-creator `public_posts` fetches; if the same
// creators are browsed again within the TTL we reuse the posts instead of
// re-fetching them, which keeps repeated visits responsive.
let postsCache = { savedAt: 0, byCreator: new Map() };
const POSTS_TTL_MS = 120000;

// Fresh fetch from enabled providers, merge, cache, and return sorted array.
// `signal` (optional AbortSignal) aborts the underlying requests when the page
// unmounts, so leaving Jewish Statuses truly stops pending network work.
export async function refreshFeed(config, signal) {
  if (inFlight) return inFlight;
  const task = (async () => {
    const cfg = config?.jewishStatuses || {};
    const enabled = PROVIDERS.filter((p) => p.isEnabled(cfg));
    const settled = await Promise.allSettled(enabled.map((p) => p.fetch(signal)));
    const results = settled.map((r) =>
      r.status === "fulfilled" ? r.value : { posts: [], creators: {} }
    );
    const merged = mergeFeeds(results);
    saveCache({ savedAt: Date.now(), merged });
    const creators = toSortedArray(applyFilters(merged, config));
    // Populate the short-TTL RAM cache so repeat visits in the same session are
    // instant and never re-fire the provider burst.
    ramCache = { savedAt: Date.now(), creators };
    return creators;
  })();
  inFlight = task;
  task.finally(() => {
    if (inFlight === task) inFlight = null;
  });
  return task;
}

// Explicit manual refresh (Refresh button). Bypasses the RAM/background cooldown
// so the user always gets fresh data on demand, but still dedupes concurrent calls.
export async function refreshJewishFeed(config, signal) {
  return refreshFeed(config, signal);
}

// Clear all caches (RAM + localStorage + posts). Used by the Refresh button after
// a forced refresh completes so the next build is guaranteed fresh if needed.
export function clearJewishFeedCache() {
  ramCache = { savedAt: 0, creators: null };
  lastBackground = null;
  lastBackgroundAt = 0;
  try { saveCache({ savedAt: 0, merged: null }); } catch {}
}

// Cached-first read. Returns { creators, fromCache, needsRefresh }.
//   - If a fresh cache exists: returns it, needsRefresh=false.
//   - If a stale cache exists: returns it immediately. A single background
//     refresh is triggered (deduped + cooldown-bounded) so we never refetch on
//     every mount; needsRefresh stays false because the background job owns the
//     refresh.
//   - If no cache: performs a fresh fetch (shared/deduped via refreshFeed).
export async function buildFeed(config, { allowCache = true, signal, force = false } = {}) {
  // 1) RAM cache (within-session, fastest). Serves repeat visits instantly with
  //    zero network. This is the key fix for "visiting Jewish Status repeatedly
  //    makes the app slow" — the feed is assembled once and reused.
  if (!force && ramCache.creators && Date.now() - ramCache.savedAt < RAM_TTL_MS) {
    return { creators: ramCache.creators, fromCache: true, needsRefresh: false };
  }
  const cached = allowCache ? loadCache() : null;
  if (cached && cached.merged) {
    const creators = toSortedArray(applyFilters(cached.merged, config));
    if (!isStale(cached.savedAt)) {
      // Refresh the RAM cache from localStorage so subsequent visits are instant.
      ramCache = { savedAt: Date.now(), creators };
      return { creators, fromCache: true, needsRefresh: false };
    }
    // Stale: serve the cache now; kick a single background refresh only if no
    // other refresh is in flight and we're outside the cooldown.
    if (!inFlight && Date.now() - lastBackgroundAt > REFRESH_COOLDOWN_MS) {
      refreshFeed(config, signal)
        .then((fresh) => {
          lastBackground = fresh;
          lastBackgroundAt = Date.now();
        })
        .catch(() => {});
    }
    if (lastBackground && Date.now() - lastBackgroundAt < REFRESH_COOLDOWN_MS) {
      return { creators: lastBackground, fromCache: true, needsRefresh: false };
    }
    return { creators, fromCache: true, needsRefresh: false };
  }
  const creators = await refreshFeed(config, signal);
  return { creators, fromCache: false, needsRefresh: false };
}
