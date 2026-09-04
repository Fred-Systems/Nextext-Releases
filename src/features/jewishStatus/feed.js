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

  const filtered = {};
  for (const c of Object.values(merged.creators || {})) {
    if (blockedCreators.has(c.key)) continue;
    const visiblePosts = c.posts.filter((p) => {
      if (blockedStatuses.has(p.id)) return false;
      const cat = p.category || "other";
      if (categories[cat] === false) return false;
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

// Fresh fetch from enabled providers, merge, cache, and return sorted array.
export async function refreshFeed(config) {
  const cfg = config?.jewishStatuses || {};
  const enabled = PROVIDERS.filter((p) => p.isEnabled(cfg));
  const settled = await Promise.allSettled(enabled.map((p) => p.fetch()));
  const results = settled.map((r) =>
    r.status === "fulfilled" ? r.value : { posts: [], creators: {} }
  );
  const merged = mergeFeeds(results);
  saveCache({ savedAt: Date.now(), merged });
  return toSortedArray(applyFilters(merged, config));
}

// Cached-first read. Returns { creators, fromCache, needsRefresh }.
//   - If a fresh cache exists: returns it, needsRefresh=false.
//   - If a stale cache exists: returns it immediately AND signals needsRefresh
//     so the caller can background-refresh.
//   - If no cache: performs a fresh fetch.
export async function buildFeed(config, { allowCache = true } = {}) {
  const cached = allowCache ? loadCache() : null;
  if (cached && cached.merged) {
    const creators = toSortedArray(applyFilters(cached.merged, config));
    if (!isStale(cached.savedAt)) {
      return { creators, fromCache: true, needsRefresh: false };
    }
    return { creators, fromCache: true, needsRefresh: true };
  }
  const creators = await refreshFeed(config);
  return { creators, fromCache: false, needsRefresh: false };
}
