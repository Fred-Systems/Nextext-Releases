// Provider-independent models + per-provider normalizers for the Jewish Statuses
// feature. Also exports a small fetchJson helper shared by the provider clients.
//
// NOTE ON ENDPOINTS: The Zemer repo (https://github.com/ZemerTeam/zemer-app) is a
// YouTube Music client and contains NO references to "jewishstatus" or
// "yidstatus". The base URLs below are reasoned GUESSES (marked GUESSED) and MUST
// be verified against the real provider APIs before production use. Every fetch
// degrades gracefully: a failure returns an empty feed instead of throwing.

export const STATUS_SOURCES = {
  JEWISH_STATUS: "jewishStatus",
  YID_STATUS: "yidStatus",
};

export const STATUS_KINDS = {
  VIDEO: "video",
  IMAGE: "image",
  TEXT: "text",
  AUDIO: "audio",
  UNKNOWN: "unknown",
};

// Categories supported by the feature. Must match the keys used in
// globalSettings.jewishStatuses.categories (set by AdminDashboard).
export const ALL_CATEGORIES = [
  "music",
  "news",
  "entertainment",
  "business",
  "community",
  "events",
  "influencers",
  "organizations",
  "other",
];

// ── fetch helper (timeout + graceful failure) ──
export async function fetchJson(url, { timeoutMs = 8000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", ...headers },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Map a provider's free-form category string(s) onto the admin-controlled
// category keys used in globalSettings.jewishStatuses.categories
// (music|news|entertainment|business|community|events|influencers|organizations|other).
// We keep ALL categories (no music-only filter) — admins decide what to hide.
export function mapCategory(raw) {
  if (!raw) return "other";
  const s = String(raw).toLowerCase();
  const rules = [
    ["music", "music"], ["kumzits", "music"], ["simcha", "music"], ["concert", "music"],
    ["singer", "music"], ["band", "music"], ["chassidic", "music"], ["nigun", "music"],
    ["news", "news"],
    ["entertainment", "entertainment"], ["comedy", "entertainment"], ["media", "entertainment"],
    ["business", "business"], ["service", "business"], ["jobs", "business"], ["real estate", "business"],
    ["community", "community"],
    ["organization", "organizations"], ["org", "organizations"], ["shul", "organizations"],
    ["event", "events"], ["travel", "other"],
  ];
  for (const [needle, cat] of rules) if (s.includes(needle)) return cat;
  return "other";
}

function toMs(v) {
  if (v == null) return Date.now();
  if (typeof v === "number") {
    // Heuristic: seconds (10-digit) vs milliseconds (13-digit).
    return v < 1e12 ? v * 1000 : v;
  }
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

// Normalize a creator into a stable, provider-independent dedup key.
// Same creator across providers (e.g. the same musician) collapses to one key.
export function computeCreatorKey(raw) {
  const base = String(
    raw?.handle || raw?.username || raw?.user_name || raw?.name || raw?.id || "unknown"
  )
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return base || "unknown";
}

export function makeCreator({ source, providerCreatorId, name, handle, avatarUrl, category }) {
  const key = computeCreatorKey({ handle, username: handle, name, id: providerCreatorId });
  return {
    key,
    name: name || handle || "Unknown",
    handle: handle || null,
    avatarUrl: avatarUrl || null,
    category: (category || "other").toLowerCase(),
    sources: [source],
    providerCreatorIds: { [source]: providerCreatorId || null },
    posts: [],
  };
}

export function makePost({
  source,
  providerStatusId,
  creatorKey,
  providerCreatorId,
  kind,
  mediaUrl,
  thumbnailUrl,
  text,
  caption,
  createdAt,
  durationMs,
  category,
}) {
  return {
    id: `${source}:${providerStatusId}`,
    source,
    providerStatusId: String(providerStatusId),
    creatorKey,
    creatorId: providerCreatorId || null,
    kind,
    mediaUrl: mediaUrl || null,
    thumbnailUrl: thumbnailUrl || null,
    text: text || null,
    caption: caption || null,
    createdAt: toMs(createdAt),
    durationMs: durationMs || null,
    category: (category || "other").toLowerCase(),
  };
}

function detectKind(raw) {
  const type = String(raw?.type || raw?.media_type || raw?.kind || "").toLowerCase();
  if (type.includes("video")) return STATUS_KINDS.VIDEO;
  if (type.includes("audio")) return STATUS_KINDS.AUDIO;
  if (type.includes("text")) return STATUS_KINDS.TEXT;
  if (type.includes("image")) return STATUS_KINDS.IMAGE;
  const url = raw?.url || raw?.media_url || raw?.src || raw?.thumbnail || "";
  if (/\.(mp4|webm|mov|m4v|m3u8)$/i.test(url)) return STATUS_KINDS.VIDEO;
  if (/\.(mp3|wav|ogg|m4a)$/i.test(url)) return STATUS_KINDS.AUDIO;
  if (/\.(jpg|jpeg|png|gif|webp|avif)$/i.test(url)) return STATUS_KINDS.IMAGE;
  if (raw?.text || raw?.caption) return STATUS_KINDS.TEXT;
  return STATUS_KINDS.UNKNOWN;
}

function pickMedia(raw) {
  return (
    raw?.url ||
    raw?.media_url ||
    raw?.src ||
    raw?.mediaUrl ||
    raw?.video_url ||
    raw?.image_url ||
    null
  );
}

// ── JewishStatus normalizer (GUESSED response shape) ──
// Expected (best guess): { creators: [ { id, name, username, avatar, category,
//   statuses: [ { id, type, url, thumbnail, caption, text, created_at, duration } ] } ] }
// Also tolerates a flat { posts: [ { id, creator:{...}, type, url, ... } ] } shape.
export function normalizeJewishStatus(raw) {
  const out = { posts: [], creators: {} };
  if (!raw) return out;

  const creatorList = raw.creators || raw.data?.creators || [];
  const flat = raw.posts || raw.data?.posts || raw.statuses || raw.data?.statuses || null;

  try {
    if (creatorList.length) {
      for (const c of creatorList) {
        const creator = makeCreator({
          source: STATUS_SOURCES.JEWISH_STATUS,
          providerCreatorId: c.id,
          name: c.name || c.display_name,
          handle: c.username || c.handle || c.user_name,
          avatarUrl: c.avatar || c.avatar_url || c.profile_image || c.photo,
          category: c.category,
        });
        const statuses = c.statuses || c.posts || c.status_list || [];
        for (const s of statuses) {
          const kind = detectKind(s);
          const post = makePost({
            source: STATUS_SOURCES.JEWISH_STATUS,
            providerStatusId: s.id ?? s.status_id ?? s.uid,
            creatorKey: creator.key,
            providerCreatorId: c.id,
            kind,
            mediaUrl: pickMedia(s),
            thumbnailUrl: s.thumbnail || s.poster || s.thumbnail_url,
            text: s.text || s.body,
            caption: s.caption,
            createdAt: s.created_at || s.timestamp || s.createdAt || s.published_at,
            durationMs: s.duration ? s.duration * 1000 : s.duration_ms || null,
            category: c.category || s.category,
          });
          creator.posts.push(post);
          out.posts.push(post);
        }
        if (creator.posts.length) out.creators[creator.key] = creator;
      }
    } else if (flat) {
      for (const s of flat) {
        const c = s.creator || s.user || s.owner || {};
        const creatorKey = computeCreatorKey(c);
        let creator = out.creators[creatorKey];
        if (!creator) {
          creator = makeCreator({
            source: STATUS_SOURCES.JEWISH_STATUS,
            providerCreatorId: c.id,
            name: c.name || c.display_name,
            handle: c.username || c.handle,
            avatarUrl: c.avatar || c.avatar_url || c.photo,
            category: c.category,
          });
          out.creators[creatorKey] = creator;
        }
        const kind = detectKind(s);
        const post = makePost({
          source: STATUS_SOURCES.JEWISH_STATUS,
          providerStatusId: s.id ?? s.status_id ?? s.uid,
          creatorKey,
          providerCreatorId: c.id,
          kind,
          mediaUrl: pickMedia(s),
          thumbnailUrl: s.thumbnail || s.poster,
          text: s.text || s.body,
          caption: s.caption,
          createdAt: s.created_at || s.timestamp,
          durationMs: s.duration ? s.duration * 1000 : s.duration_ms || null,
          category: c.category || s.category,
        });
        creator.posts.push(post);
        out.posts.push(post);
      }
    }
  } catch (e) {
    console.warn("[normalizeJewishStatus] malformed payload:", e?.message || e);
  }
  return out;
}

// ── YidStatus normalizer (GUESSED response shape) ──
// Expected (best guess): { data: [ { id, creator:{id,name,handle,avatar,category},
//   media_type, media_url, text, caption, createdAt, duration_seconds } ] }
export function normalizeYidStatus(raw) {
  const out = { posts: [], creators: {} };
  if (!raw) return out;

  const list = raw.data || raw.posts || raw.items || raw.statuses || raw.results || [];
  try {
    for (const s of list) {
      const c = s.creator || s.user || s.owner || s.account || {};
      const creatorKey = computeCreatorKey(c);
      let creator = out.creators[creatorKey];
      if (!creator) {
        creator = makeCreator({
          source: STATUS_SOURCES.YID_STATUS,
          providerCreatorId: c.id,
          name: c.name || c.display_name || c.title,
          handle: c.handle || c.username || c.user_name,
          avatarUrl: c.avatar || c.avatar_url || c.profile_image || c.photo,
          category: c.category,
        });
        out.creators[creatorKey] = creator;
      }
      const kind = detectKind(s);
      const post = makePost({
        source: STATUS_SOURCES.YID_STATUS,
        providerStatusId: s.id ?? s.status_id ?? s.uid ?? s._id,
        creatorKey,
        providerCreatorId: c.id,
        kind,
        mediaUrl: pickMedia(s),
        thumbnailUrl: s.thumbnail || s.poster || s.cover,
        text: s.text || s.body || s.message,
        caption: s.caption,
        createdAt: s.createdAt || s.created_at || s.timestamp || s.publishedAt,
        durationMs: s.duration_seconds ? s.duration_seconds * 1000 : s.duration_ms || null,
        category: c.category || s.category,
      });
      creator.posts.push(post);
      out.posts.push(post);
    }
  } catch (e) {
    console.warn("[normalizeYidStatus] malformed payload:", e?.message || e);
  }
  return out;
}
