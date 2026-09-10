// Music provider architecture for the Status Builder "Background Music" feature.
//
// Design (per spec):
//   Status Builder ──▶ MusicService (this file) ──▶ [ AppleProvider | ZemerProvider | DisabledProvider ]
//
// - Only ONE provider is active globally (admin setting `music.provider`).
// - Each provider exposes the same interface: search, getPreviewUrl, canPreview,
//   canDownload, getProviderName. The UI never talks to Apple/Zemer directly.
// - Playback streams FROM THE PROVIDER'S LEGITIMATE SOURCE on the device:
//     • Apple  → 30s AAC preview (iTunes Search `previewUrl`). Apple's terms do
//                NOT permit downloading/caching/synchronizing the preview, so we
//                stream it only and label it a preview (never a "song").
//     • Zemer  → YouTube (every Zemer track carries a YouTube `videoId`; Zemer's
//                own player uses YouTube). We play it via the YouTube IFrame API
//                (legitimate embed) — we do NOT extract audio or bypass YouTube.
// - Storage is METADATA ONLY. No audio blob is ever written to Firebase/Supabase/
//   Cloudinary. The status doc stores provider + stable id + title/artist/album +
//   artwork + playback reference + start/volume/mute.
// - Downloads are gated by a separate admin permission, but only enabled when the
//   provider legitimately permits it. Neither provider permits downloading, so the
//   UI shows WHY rather than offering a non-functional button.

import { searchMusic as appleSearch, getTrackPreviewUrl as applePreviewUrl } from "./musicCatalog";

// ── Zemer provider (real endpoint: https://search.zemer.io/search) ──
// Verified live 2026-09-04: GET /search?q=...&allowFemale=0|1&blockVideos=0|1&kidZone=0|1&k=<cap>
// returns { q, count, categories:{ songs:[{videoId,title,artist,thumbnail,album,durationSec,...}], ... } }.
// Playback source is YouTube (videoId). No preview/audio extraction.
const ZEMER_SEARCH = "https://search.zemer.io/search";

const searchCache = new Map(); // `${provider}:${query}:${k}` -> {ts, tracks}
const CACHE_TTL = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.tracks;
  return null;
}
function cacheSet(key, tracks) {
  searchCache.set(key, { ts: Date.now(), tracks });
}

function normalizeZemerTrack(t) {
  if (!t || !t.videoId) return null;
  return {
    trackId: t.videoId,
    videoId: t.videoId,
    title: t.title || "Unknown",
    artist: t.artist || "Unknown",
    album: t.album?.name || "",
    artwork: t.thumbnail || null,
    previewUrl: null, // no native preview; played via YouTube
    durationSec: t.durationSec || null,
    source: "zemer",
    canPreview: true, // via YouTube IFrame
    canDownload: false, // YouTube ToS — no download
  };
}

async function zemerSearch(query, { limit = 20 } = {}) {
  const q = (query || "").trim();
  if (!q) return [];
  const key = `zemer:${q}:${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const url =
    `${ZEMER_SEARCH}?q=${encodeURIComponent(q)}&allowFemale=0&blockVideos=0&kidZone=0&k=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Zemer music search is temporarily unavailable.");
  const data = await res.json();
  const songs = (data?.categories?.songs || []).map(normalizeZemerTrack).filter(Boolean);
  cacheSet(key, songs);
  return songs;
}

// ── Apple provider (iTunes Search) ──
async function appleSearchWrapped(query, { limit = 20 } = {}) {
  const raw = await appleSearch(query, { limit });
  return raw.map((t) => ({
    ...t,
    // Normalize to the canonical provider id. The raw iTunes catalog uses
    // source:"itunes" — everything downstream (getPreviewUrl, the viewer,
    // the builder chips) keys off source/provider === "apple", so without
    // this every Apple result silently lost its preview URL and never played.
    source: "apple",
    videoId: null,
    canPreview: true, // 30s AAC preview
    canDownload: false, // Apple preview terms forbid download/caching
  }));
}

// ── Administration / resolution helpers ──
// Settings shape (globalSettings.music):
//   {
//     provider: "apple" | "zemer" | "disabled",
//     providers: { zemer: { enabled:true }, apple: { enabled:true } },
//     apple: { whitelist: { mode:"all"|"whitelist", rules:[{id,type,value,enabled}] } },
//     downloads: { enabled:false }
//   }
// Per-user override (userDoc.musicAccess = { zemer:"inherit"|"enabled"|"disabled", apple:... }).
// Downloads per-user override (userDoc.musicDownloadsOverride = "inherit"|"enabled"|"disabled").

export function getActiveProvider(globalSettings) {
  const p = globalSettings?.music?.provider;
  return p === "zemer" || p === "apple" || p === "disabled" ? p : "apple";
}

// When true, the Add Music UI lets the user pick between the available providers
// (Zemer / Apple) instead of forcing the admin's active provider.
export function resolveAllowUserProviderChoice(globalSettings) {
  return globalSettings?.music?.allowUserProviderChoice === true;
}

// Providers the user is allowed to pick from in the Add Music UI: the admin's
// active provider (unless "disabled"), plus any other enabled providers when the
// admin has enabled per-user provider choice.
export function resolveSelectableProviders(globalSettings, userDoc) {
  const active = getActiveProvider(globalSettings);
  if (active === "disabled") return [];
  const list = [active];
  if (resolveAllowUserProviderChoice(globalSettings)) {
    for (const p of ["zemer", "apple"]) {
      if (p !== active && resolveProviderAccess(globalSettings, userDoc, p)) {
        if (!list.includes(p)) list.push(p);
      }
    }
  }
  return list;
}

function resolveOverride(globalEnabled, override) {
  if (override === "enabled") return true;
  if (override === "disabled") return false;
  return !!globalEnabled;
}

// Whether the given user may use the currently-active music provider at all.
export function resolveMusicAccess(globalSettings, userDoc) {
  const provider = getActiveProvider(globalSettings);
  if (provider === "disabled") return false;
  const globalEnabled = globalSettings?.music?.providers?.[provider]?.enabled !== false;
  const override = userDoc?.musicAccess?.[provider] || "inherit";
  return resolveOverride(globalEnabled, override);
}

export function isProviderEnabled(globalSettings, provider) {
  if (provider === "disabled") return false;
  return globalSettings?.music?.providers?.[provider]?.enabled !== false;
}

// Generic per-provider access (allows Zemer=ENABLED / Apple=DISABLED independently).
export function resolveProviderAccess(globalSettings, userDoc, provider) {
  if (provider === "disabled") return false;
  const globalEnabled = isProviderEnabled(globalSettings, provider);
  const override = userDoc?.musicAccess?.[provider] || "inherit";
  return resolveOverride(globalEnabled, override);
}

// Unified search-result policy (service-layer, BEFORE display):
//   1. Per-user exemption  → userDoc.musicPolicyExemption === true bypasses
//      whitelist AND blacklist entirely (only the provider being enabled and
//      the user's provider access still apply).
//   2. Blacklist           → any matching rule REMOVES the track, everywhere.
//   3. Whitelist           → when apple.whitelist.mode === "whitelist", only
//      matching tracks remain (no enabled rules ⇒ nothing matches).
//   4. Default policy      → no blacklist/whitelist config ⇒ results pass.
// Rules support artist/album/track/genre/keyword/trackId/artistId (whatever the
// provider actually exposes) and per-rule enabled flags. Deterministic:
// blacklist always beats whitelist, and exemption beats both.
export function applyMusicPolicy(tracks, { globalSettings, provider }) {
  const cfg = globalSettings?.music || {};
  if (provider !== "apple" && provider !== "zemer") return tracks;
  const bl = (cfg.blacklist?.rules || []).filter((r) => r && r.enabled !== false);
  const wl = cfg.apple?.whitelist;
  const wlMode = wl?.mode === "whitelist";
  const wlRules = wlMode ? (wl.rules || []).filter((r) => r && r.enabled !== false) : [];
  const trackApplies = (t, providerOfTrack) => {
    // Apple rules apply only to Apple results; Zemer rules only to Zemer.
    return providerOfTrack === "all" || providerOfTrack === provider;
  };
  const matchRule = (t, r) => {
    if (!trackApplies(t, r.provider || provider)) return false;
    const v = String(r.value || "").toLowerCase();
    switch (r.type) {
      case "artist": return (t.artist || "").toLowerCase().includes(v);
      case "album": return (t.album || "").toLowerCase().includes(v);
      case "track": return (t.title || "").toLowerCase().includes(v);
      case "trackId": return String(t.trackId) === String(r.value);
      case "artistId": return String(t.artistId || "") === String(r.value);
      case "genre": return (t.genre || "").toLowerCase().includes(v);
      case "keyword": return (
        (t.title || "").toLowerCase().includes(v) ||
        (t.artist || "").toLowerCase().includes(v) ||
        (t.album || "").toLowerCase().includes(v)
      );
      default: return false;
    }
  };
  if (bl.length) tracks = tracks.filter((t) => !bl.some((r) => matchRule(t, r)));
  if (wlMode) {
    if (!wlRules.length) return []; // whitelist on but no rules → nothing matches
    tracks = tracks.filter((t) => wlRules.some((r) => matchRule(t, r)));
  }
  return tracks;
}

// Per-user exemption check (server-side flag users/{uid}.musicPolicyExemption).
export function hasMusicPolicyExemption(userDoc) {
  return userDoc?.musicPolicyExemption === true;
}

// Normalize a search term for casing/spacing-insensitive matching and ranking.
export function normalizeMusicTerm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Deterministic, relevance-first ranking for search results. Exact/starts-with
// matches on artist/title sort first, then alphabetical by artist — so the same
// query always yields the same predictable order across devices.
function rankTracks(tracks, rawQuery) {
  const q = normalizeMusicTerm(rawQuery);
  if (!q) return tracks;
  const score = (t) => {
    const artist = normalizeMusicTerm(t.artist);
    const title = normalizeMusicTerm(t.title);
    if (artist === q || title === q) return 0;
    if (artist.startsWith(q) || title.startsWith(q)) return 1;
    if (artist.includes(q) || title.includes(q)) return 2;
    return 3;
  };
  return [...tracks].sort((a, b) => {
    const sa = score(a), sb = score(b);
    if (sa !== sb) return sa - sb;
    const aa = (a.artist || "").toLowerCase(), ab = (b.artist || "").toLowerCase();
    if (aa !== ab) return aa < ab ? -1 : 1;
    return (a.title || "").toLowerCase() < (b.title || "").toLowerCase() ? -1 : 1;
  });
}

// Resolve the providers a user is actually allowed to use (admin-enabled AND
// not disabled for them via per-user override). Used for combined "both" search.
export function resolveEnabledProviders(globalSettings, userDoc) {
  const out = [];
  for (const p of ["zemer", "apple"]) {
    if (resolveProviderAccess(globalSettings, userDoc, p)) out.push(p);
  }
  return out;
}

// Simultaneous multi-provider search (when the admin enabled both Zemer and Apple
// for the user). Issues BOTH searches in parallel, keeps the one(s) that succeed,
// tags each result with its source, dedupes obvious duplicates, and never lets one
// provider's failure break the other. Does NOT silently fall back to a single
// provider's results when both were requested — it always returns both when both work.
async function searchMusicAll(query, { globalSettings, userDoc, limit = 20 }) {
  const term = (query || "").trim();
  const providers = resolveEnabledProviders(globalSettings, userDoc);
  if (providers.length === 0) {
    const err = new Error("Music isn't available for your account.");
    err.code = "noaccess";
    throw err;
  }
  const settled = await Promise.allSettled(
    providers.map((p) => (p === "zemer" ? zemerSearch(term, { limit }) : appleSearchWrapped(term, { limit })))
  );
  let tracks = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      let t = r.value || [];
      if (!hasMusicPolicyExemption(userDoc)) {
        t = applyMusicPolicy(t, { globalSettings, provider: providers[i] });
      }
      tracks = tracks.concat(t);
    } else {
      failed.push(providers[i]);
    }
  });
  // Dedupe obvious duplicates (same source + id, or same title/artist).
  const seen = new Set();
  tracks = tracks.filter((tk) => {
    const key = `${tk.source}:${tk.trackId || tk.id || ""}:${(tk.title || "").toLowerCase()}::${(tk.artist || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  tracks = rankTracks(tracks, term);
  // If EVERY provider failed, surface the error rather than returning an empty list
  // that looks like "no results".
  if (tracks.length === 0 && failed.length === providers.length) {
    const err = new Error("Music search is temporarily unavailable. Please try again.");
    err.code = "unavailable";
    throw err;
  }
  return { provider: "both", tracks, providersTried: providers, failedProviders: failed };
}

// Top-level search used by the Status Builder. Honors active provider + per-user
// access + (Apple) whitelist. Throws a clear, provider-specific error if unavailable
// (never silently falls back to the other provider). `provider: "both"` runs a
// combined Zemer + Apple search (see searchMusicAll).
export async function searchMusic(query, { globalSettings, userDoc, limit = 20, provider: overrideProvider } = {}) {
  const provider = overrideProvider || getActiveProvider(globalSettings);
  if (provider === "both") {
    return searchMusicAll(query, { globalSettings, userDoc, limit });
  }
  if (provider === "disabled") {
    const err = new Error("Music is disabled.");
    err.code = "disabled";
    throw err;
  }
  const allowed = resolveMusicAccess(globalSettings, userDoc);
  if (!allowed) {
    const err = new Error("Music isn't available for your account.");
    err.code = "noaccess";
    throw err;
  }
  try {
    let tracks =
      provider === "zemer" ? await zemerSearch(query, { limit }) : await appleSearchWrapped(query, { limit });
    // Exempt users bypass blacklist/whitelist entirely (§13/§14 precedence).
    if (!hasMusicPolicyExemption(userDoc)) {
      tracks = applyMusicPolicy(tracks, { globalSettings, provider });
    }
    // Smart search: predictable, relevance-first ordering (whitelist/blacklist
    // filtering above is already applied to whatever the provider returned).
    tracks = rankTracks(tracks, query);
    return { provider, tracks };
  } catch (e) {
    if (e.code) throw e;
    const err = new Error(
      provider === "zemer"
        ? "Zemer music search is temporarily unavailable."
        : "Apple music search is temporarily unavailable."
    );
    err.code = "unavailable";
    throw err;
  }
}

export function getProviderName(provider) {
  return provider === "zemer" ? "Zemer" : provider === "apple" ? "Apple" : "Disabled";
}

export function getPreviewUrl(track) {
  if (!track) return null;
  if (track.source === "apple" || track.source === "itunes") return applePreviewUrl(track);
  // Zemer: no native preview; playback is via YouTube IFrame (videoId).
  return null;
}

export function getYoutubeVideoId(track) {
  if (!track) return null;
  if (track.videoId) return track.videoId;
  // Zemer tracks use the YouTube id as their stable trackId — accept it as a
  // fallback so a doc that only persisted trackId still resolves.
  if (track.source === "zemer" && track.trackId) return track.trackId;
  return null;
}

// Resolves whether a DOWNLOAD is legitimately possible for this track + user.
// Returns { allowed, reason }. Reason explains when permitted-but-blocked-by-provider.
export function resolveDownload(globalSettings, userDoc, track) {
  const globalEnabled = globalSettings?.music?.downloads?.enabled === true;
  const override = userDoc?.musicDownloadsOverride || "inherit";
  const permittedByAdmin = resolveOverride(globalEnabled, override);
  if (!permittedByAdmin) return { allowed: false, reason: "Downloads are disabled for your account." };
  if (track?.canDownload === false) {
    return {
      allowed: false,
      reason:
        track.source === "apple" || track.source === "itunes"
          ? "Apple preview terms do not permit downloading."
          : "This provider does not permit downloading.",
    };
  }
  return { allowed: true, reason: "" };
}

export function getAppleWhitelist(globalSettings) {
  return globalSettings?.music?.apple?.whitelist || { mode: "all", rules: [] };
}

// Shared constructor for the `backgroundMusic` status metadata, used by BOTH the
// original builder and the new WhatsApp-style builder so the shape, segment
// bounds, and provider rules are identical (viewer-compatible by construction).
// - Apple exposes only a 30s preview → segment clamped to [0, min(dur,30)].
// - Zemer maps to a full YouTube video → segment clamped to [0, dur||30].
// Metadata only — never an audio blob.
export function buildBgMusic(track, activeProvider, { originalVolume = 1 } = {}) {
  const provider = track?.source === "itunes" ? "apple" : (track?.source || activeProvider);
  const dur = track?.durationSec ? Math.round(track.durationSec) : (provider === "apple" ? 30 : 0);
  const maxSeg = provider === "apple" ? Math.min(dur || 30, 30) : (dur || 30);
  return {
    ...(track || {}),
    provider,
    videoId: track?.videoId || null,
    start: 0,
    end: maxSeg,
    durationSec: dur,
    volume: 1,
    originalVolume,
    muted: false,
  };
}

// Clamp a user-edited segment to the provider's legitimate playable range.
export function clampSegment(provider, start, end, durationSec) {
  const isApple = provider === "apple" || provider === "itunes";
  const maxSeg = isApple ? Math.min(durationSec || 30, 30) : Math.min(durationSec || 300, 600);
  const s = Math.max(0, Math.min(Number(start) || 0, maxSeg - 1));
  const e = Math.max(s + 1, Math.min(Number(end) || maxSeg, maxSeg));
  return { start: s, end: e, maxSeg };
}

// Capability map — the UI must only expose what each source genuinely supports.
// Apple: playback (30s preview) + seek within preview + segment within preview.
//        NO download (preview terms forbid it).
// Zemer: playback via YouTube embed + seek via YouTube controls + segment via
//        start/end enforcement. NO download (YouTube ToS).
export function getProviderCapabilities(provider) {
  if (provider === "apple" || provider === "itunes") {
    return { playback: true, seek: true, segment: true, download: false, seekLabel: "30-second preview range", downloadReason: "Apple preview terms do not permit downloading." };
  }
  if (provider === "zemer") {
    return { playback: true, seek: true, segment: true, download: false, seekLabel: "Full track via YouTube", downloadReason: "YouTube terms do not permit downloading." };
  }
  return { playback: false, seek: false, segment: false, download: false, seekLabel: "", downloadReason: "Music is disabled." };
}
