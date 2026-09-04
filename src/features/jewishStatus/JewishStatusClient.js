// Provider adapter for JewishStatus (jewishstatus.com).
// Real public API protocol, reverse-engineered from the Zemer app reference docs
// (docs/status/jewishstatus-api.md) and verified live 2026-09-04.
//
// Base: Supabase PostgREST. Auth: publishable anon key as `apikey` + Bearer.
// Media: Cloudflare R2 (relative paths -> CDN prefix). No Origin header needed.
// Fail-soft: any failure returns an empty feed instead of throwing.

import {
  makeCreator,
  makePost,
  mapCategory,
  STATUS_SOURCES,
} from "./normalize";

const REST = "https://raiodurvjneoehnphkrs.supabase.co/rest/v1";
const KEY = "sb_publishable_Pj9SDOxf5Xxw9LavwAl5yw_5ldleSyD";
const CDN = "https://pub-0dd407ad34e240909673d1619658d5c2.r2.dev";

// Known public category UUIDs (music-focused platform). A broad (null-category)
// browse is also fetched to maximize category coverage.
const CATEGORY_UUIDS = [
  "dc207cab-3514-4ae8-a5c1-8a69fb27ced3", // Jewish Music
  "02ed4e29-d461-43f4-9aab-e16d05d3f795", // Music industry
  "5a08c0ba-400a-4576-aa33-97fa9ec38d0e", // Concerts
];

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
};

// Bounded concurrency pool to keep request volume reasonable.
async function pool(items, worker, size = 6) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const settled = await Promise.allSettled(slice.map(worker));
    for (const x of settled) if (x.status === "fulfilled" && x.value) out.push(x.value);
  }
  return out;
}

function dedupeCreators(list) {
  const map = {};
  for (const c of list) if (c && c.id) map[c.id] = c;
  return Object.values(map);
}

async function browseCreators(category) {
  const body = {
    p_section: "all",
    p_search: null,
    p_limit: 100,
    p_offset: 0,
    p_category: category || null,
    p_location: null,
    p_sort: "recent",
  };
  const res = await fetch(`${REST}/rpc/browse_creators_sorted`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("browse " + res.status);
  return res.json();
}

async function fetchPosts(creatorId) {
  const url =
    `${REST}/public_posts` +
    `?creator_id=eq.${creatorId}` +
    `&select=id,kind,media_path,thumb_path,caption,text_body,text_bg_color,link_url,duration_seconds,posted_at` +
    `&order=posted_at.desc&limit=20`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error("posts " + res.status);
  return res.json();
}

export async function fetchJewishStatusFeed() {
  try {
    // Broad + per-category concurrent browse, then dedupe.
    const settled = await Promise.allSettled([
      ...CATEGORY_UUIDS.map((c) => browseCreators(c)),
      browseCreators(null),
    ]);
    let creators = [];
    for (const r of settled) if (r.status === "fulfilled" && Array.isArray(r.value)) creators = creators.concat(r.value);
    creators = dedupeCreators(creators).slice(0, 60);

    const fetched = await pool(creators, async (c) => {
      try {
        const posts = await fetchPosts(c.id);
        return { creator: c, posts };
      } catch {
        return null;
      }
    });

    const creatorsMap = {};
    const posts = [];
    for (const { creator, posts: rawPosts } of fetched) {
      const cat = mapCategory([].concat(creator.category_names || [], creator.category || []).join(" "));
      const c = makeCreator({
        source: STATUS_SOURCES.JEWISH_STATUS,
        providerCreatorId: creator.id,
        name: creator.display_name || creator.name,
        handle: creator.slug,
        avatarUrl: creator.avatar_path ? `${CDN}/avatars/${creator.avatar_path}` : null,
        category: cat,
      });
      for (const p of rawPosts || []) {
        const kind = String(p.kind || "").toLowerCase();
        if (kind === "audio") continue;
        const kindOut = kind === "text" ? "text" : kind === "video" ? "video" : "image";
        const post = makePost({
          source: STATUS_SOURCES.JEWISH_STATUS,
          providerStatusId: p.id,
          creatorKey: c.key,
          providerCreatorId: creator.id,
          kind: kindOut,
          mediaUrl: p.media_path ? `${CDN}/status-media/${p.media_path}` : null,
          thumbnailUrl: p.thumb_path ? `${CDN}/status-media/${p.thumb_path}` : null,
          text: kind === "text" ? (p.text_body || p.caption || "") : null,
          caption: p.caption,
          createdAt: p.posted_at,
          durationMs: p.duration_seconds ? p.duration_seconds * 1000 : null,
          category: cat,
        });
        c.posts.push(post);
        posts.push(post);
      }
      if (c.posts.length) creatorsMap[c.key] = c;
    }
    return { posts, creators: creatorsMap };
  } catch (e) {
    console.warn("[JewishStatusClient] feed failed:", e?.message || e);
    return { posts: [], creators: {} };
  }
}

export { STATUS_SOURCES };
