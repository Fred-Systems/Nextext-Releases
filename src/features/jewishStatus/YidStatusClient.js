// Provider adapter for YidStatus (yidstatus.com).
// Real public API protocol, reverse-engineered from the Zemer app reference docs
// (docs/status/yidstatus-api.md) and verified live 2026-09-04.
//
// The only read path for statuses is POST /functions/v1/feed, which REQUIRES the
// header `Origin: https://yidstatus.com`. A browser/WebView `fetch` cannot set
// the Origin header (it is a forbidden header), so we route through our own
// Cloudflare Worker (worker.js → /api/yidstatus-feed) which adds the header
// server-side. The anon JWT below is the public, RLS-scoped, read-only key shipped
// in the YidStatus web bundle (not a secret). Fail-soft on any failure.

import {
  makeCreator,
  makePost,
  mapCategory,
  STATUS_SOURCES,
} from "./normalize";

const WORKER_FEED = "https://nextext.nextext-app.workers.dev/api/yidstatus-feed";

export async function fetchYidStatusFeed(signal) {
  try {
    const res = await fetch(WORKER_FEED, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 1, since: null }),
      signal,
    });
    if (!res.ok) throw new Error("worker " + res.status);
    const data = await res.json();

    const influencers = Array.isArray(data.influencers) ? data.influencers : [];
    const statuses = Array.isArray(data.statuses) ? data.statuses : [];

    // Index creators, dropping paused/unlisted/review_hidden.
    const byId = {};
    for (const inf of influencers) {
      if (inf.paused || inf.unlisted || inf.review_hidden) continue;
      byId[inf.id] = inf;
    }

    const creatorsMap = {};
    const posts = [];
    for (const s of statuses) {
      const inf = byId[s.influencer_id];
      if (!inf) continue;
      if (s.is_ad) continue; // exclude ads / story ads
      const type = String(s.type || "").toLowerCase();
      if (type === "audio") continue; // viewer renders video/image/text
      const cat = mapCategory(
        [inf.primary_category, inf.category].concat(inf.categories || []).filter(Boolean).join(" ")
      );
      const key = `${inf.slug || ""}:${inf.id}`;
      let c = creatorsMap[key];
      if (!c) {
        c = makeCreator({
          source: STATUS_SOURCES.YID_STATUS,
          providerCreatorId: inf.id,
          name: inf.name,
          handle: inf.slug,
          avatarUrl: inf.avatar_url || null,
          category: cat,
        });
        creatorsMap[key] = c;
      }
      const kindOut = type === "text" ? "text" : type === "video" ? "video" : "image";
      const post = makePost({
        source: STATUS_SOURCES.YID_STATUS,
        providerStatusId: s.id,
        creatorKey: c.key,
        providerCreatorId: inf.id,
        kind: kindOut,
        mediaUrl: s.media_url || null,
        // YidStatus returns a null poster for images — fall back to the media URL.
        thumbnailUrl: s.poster_url || (type === "image" ? s.media_url : null),
        text: type === "text" ? s.caption || "" : null,
        caption: s.caption,
        createdAt: s.timestamp,
        durationMs: s.duration_seconds ? s.duration_seconds * 1000 : null,
        category: cat,
      });
      c.posts.push(post);
      posts.push(post);
    }
    return { posts, creators: creatorsMap };
  } catch (e) {
    console.warn("[YidStatusClient] feed failed:", e?.message || e);
    return { posts: [], creators: {} };
  }
}

export { STATUS_SOURCES };
