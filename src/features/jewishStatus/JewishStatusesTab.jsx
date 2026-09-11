import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { useTheme } from "../../theme/ThemeContext";
import { useGlobalSettings } from "../../firebase/config-settings";
import { resolveJewishStatusAttribution } from "../../firebase/config-settings";
import { useAuth } from "../../firebase/useAuth";
import { buildFeed, refreshJewishFeed } from "./feed";
import StoryViewer from "./StoryViewer";
import { loadCache } from "./cache";
import { applyFilters } from "./feed";
import { recordJewishStatusClick, recordJewishUserClick, startJewishPageTimer, pauseJewishPageTimer, resumeJewishPageTimer, stopJewishPageTimer, setActiveJewishUid, getPopularStatuses } from "../../firebase/jewishAnalytics";

const VIEWED_KEY = "nextext_jewish_statuses_viewed_v1";
const LAYOUT_KEY = "nextext_jewish_layout";
const LIKED_KEY = "nextext_jewish_liked_creators_v1";
const LAYOUTS = ["stories", "grid", "list", "cards"];
const SHOW_ALL_KEY = "nextext_jewish_show_all";

// Liked Creators — a user-curated list persisted locally (no server dependency).
function loadLiked() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIKED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveLiked(set) {
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify([...set]));
  } catch {
    /* non-fatal */
  }
}

function loadViewed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveViewed(set) {
  try {
    localStorage.setItem(VIEWED_KEY, JSON.stringify([...set]));
  } catch {
    /* non-fatal */
  }
}

function loadLayout() {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return LAYOUTS.includes(v) ? v : "stories";
  } catch {
    return "stories";
  }
}

function Avatar({ c, t, seen, size }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        padding: 3,
        boxSizing: "border-box",
        background: seen
          ? "rgba(255,255,255,0.18)"
          : `linear-gradient(135deg, ${t.primary}, ${t.accent || t.primary})`,
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", background: t.surface }}>
        {c.avatarUrl ? (
          <img
            src={c.avatarUrl}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: t.textMuted,
              fontWeight: 700,
              fontSize: size * 0.36,
            }}
          >
            {(c.name || "?").charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

export default function JewishStatusesTab({ onStoryViewerChange, externalItems = null, headerTitle = "JEWISH STATUSES" }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const { user, userDoc } = useAuth();

  const js = globalSettings?.jewishStatuses || {};
  // Admin-controllable attribution (show/hide + custom text/links; defaults SHOW).
  const attribution = resolveJewishStatusAttribution(globalSettings);
  const override = userDoc?.jewishStatusesOverride || "inherit";
  const globalEnabled = js.enabled === true;

  // Visibility rule from the spec:
  //   featureEnabledForUser = override==="enabled" || (override!=="disabled" && globalEnabled)
  const visible = override === "enabled" || (override !== "disabled" && globalEnabled);

  // `builtCreators` is fed by the Jewish feed when this tab is in its native mode.
  // When an external source (e.g. Updates/Public in Jewish-style mode) supplies
  // `externalItems`, those are used directly instead of building the Jewish feed.
  const getInitialCreators = () => {
    try {
      const cached = loadCache();
      if (cached && cached.merged) {
        const arr = Object.values(applyFilters(cached.merged, globalSettings) || {});
        arr.sort((a,b) => (b.posts[0]?.createdAt||0)-(a.posts[0]?.createdAt||0));
        return arr.slice(0, 60);
      }
    } catch {}
    return [];
  };
  const initialCreators = getInitialCreators();
  const [builtCreators, setBuiltCreators] = useState(initialCreators);
  const creators = externalItems || builtCreators;
  const [loading, setLoading] = useState(!externalItems && initialCreators.length === 0);
  const [offline, setOffline] = useState(false);
  const abortRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(18);
  const [activeCategory, setActiveCategory] = useState("all");
  const [popularMap, setPopularMap] = useState({});
  const [viewerIndex, setViewerIndex] = useState(null);
  const [viewed, setViewed] = useState(loadViewed());
  const [layout, setLayout] = useState(loadLayout);
  const [liked, setLiked] = useState(loadLiked);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [disabledCategories, setDisabledCategories] = useState(() => new Set());
  const [showAll, setShowAll] = useState(() => { try { return localStorage.getItem(SHOW_ALL_KEY) === "1"; } catch { return false; } });

  const toggleShowAll = useCallback(() => {
    setShowAll((prev) => {
      const next = !prev;
      try { localStorage.setItem(SHOW_ALL_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const markViewed = useCallback((key) => {
    setViewed((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      saveViewed(next);
      return next;
    });
  }, []);

  const toggleLike = useCallback((key) => {
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveLiked(next);
      return next;
    });
  }, []);

  const LikeButton = ({ c, size = 20 }) => {
    const isLiked = liked.has(c.key);
    return (
      <div
        onClick={(e) => { e.stopPropagation(); toggleLike(c.key); }}
        title={isLiked ? "Remove from Liked Creators" : "Add to Liked Creators"}
        style={{
          position: "absolute", top: 2, right: 2, zIndex: 5,
          width: size, height: size, borderRadius: "50%",
          background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <span style={{ color: isLiked ? "#FF3B30" : "#fff", fontSize: size * 0.62, lineHeight: 1 }}>{isLiked ? "♥" : "♡"}</span>
      </div>
    );
  };

  // Liked creators, in first-seen order, intersected with the current feed.
  const likedCreators = useMemo(
    () => creators.filter((c) => liked.has(c.key)),
    [creators, liked]
  );

  // Staged loading: show cached shell immediately, preload avatars bounded, progressive fetch with abort
  useEffect(() => {
    if (externalItems) { setLoading(false); setOffline(false); return undefined; }
    if (!visible) return undefined;
    let cancelled = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // If we already have cached creators, don't show loading spinner - fetch in background
    const hasCache = builtCreators.length > 0;
    if (!hasCache) setLoading(true);
    setOffline(false);
    // Bounded avatar preload for first visible screen (8-12 avatars max)
    if (hasCache) {
      const avatarUrls = builtCreators.slice(0, 12).map(c=>c.avatarUrl).filter(Boolean);
      const seen = new Set();
      avatarUrls.forEach(u=>{ if(seen.has(u))return; seen.add(u); try{ const img=new Image(); img.decoding="async"; img.src=u; }catch{} });
    }
    buildFeed(globalSettings, { signal: ctrl.signal })
      .then((res) => {
        if (cancelled || ctrl.signal.aborted) return;
        setBuiltCreators(res.creators);
        setLoading(false);
        setOffline(false);
        // Preload avatars for first visible after fresh fetch
        const avs = res.creators.slice(0, 12).map(c=>c.avatarUrl).filter(Boolean);
        const seen2=new Set();
        avs.forEach(u=>{ if(seen2.has(u))return; seen2.add(u); try{ const img=new Image(); img.decoding="async"; img.src=u; }catch{} });
      })
      .catch(() => {
        if (cancelled || ctrl.signal.aborted) return;
        setLoading(false);
        if (builtCreators.length===0) setOffline(true);
      });
    return () => {
      cancelled = true;
      try{ ctrl.abort(); }catch{}
    };
  }, [visible, globalSettings]);

  // Manual Refresh: invalidate the RAM cache and force a fresh fetch, showing a
  // clear loading state only for the explicit refresh (not for cached returns).
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (refreshing || externalItems) return;
    setRefreshing(true);
    setOffline(false);
    try {
      const res = await refreshJewishFeed(globalSettings, null);
      setBuiltCreators(res);
    } catch {
      // A failed refresh should not blank the page — keep the last good feed.
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, externalItems, globalSettings]);

  // Bounded prefetch: preload next creators' first media so advancing feels instant. Deduplicated, bounded to 6.
  useEffect(() => {
    if (!creators || creators.length === 0) return;
    const urls = [];
    const seen=new Set();
    for (let i = 0; i < Math.min(creators.length, 8); i++) {
      const posts = creators[i]?.posts || [];
      for (let j = 0; j < Math.min(posts.length, 2); j++) {
        const u = posts[j]?.thumbnailUrl || posts[j]?.mediaUrl;
        if (u && !seen.has(u)) { seen.add(u); urls.push(u); }
        if (urls.length >= 6) break;
      }
      if (urls.length >= 6) break;
    }
    urls.forEach((u) => {
      try { const img = new Image(); img.decoding="async"; img.src = u; } catch {}
    });
  }, [creators]);

  // Page time tracking: start when visible and active, pause when leaving/background
  useEffect(() => {
    if (!visible || externalItems) return;
    if (!user?.uid) return;
    setActiveJewishUid(user.uid);
    startJewishPageTimer(user.uid);
    const onVis=()=>{ if(document.visibilityState==="hidden") pauseJewishPageTimer(); else resumeJewishPageTimer(); };
    document.addEventListener("visibilitychange", onVis);
    return ()=>{ document.removeEventListener("visibilitychange", onVis); pauseJewishPageTimer(); stopJewishPageTimer(); };
  }, [visible, externalItems, user?.uid]);

  // Popular ranking fetch (real engagement) - lightweight, limited to top 30
  useEffect(() => {
    let alive=true;
    getPopularStatuses(30).then(list=>{
      if(!alive) return;
      const m={};
      list.forEach(r=>{ m[r.id]=r.clickCount||0; });
      setPopularMap(m);
    }).catch(()=>{});
    return ()=>{ alive=false; };
  }, [creators.length]);


  // Notify parent (e.g. hide bottom nav) whenever the viewer opens/closes.
  useEffect(() => {
    onStoryViewerChange?.(viewerIndex != null);
  }, [viewerIndex, onStoryViewerChange]);

  const allCategories = useMemo(() => {
    const set = new Set();
    creators.forEach((c) => {
      if (c.category) set.add(c.category);
      (c.posts || []).forEach((p) => {
        if (p.category) set.add(p.category);
      });
    });
    const arr=[...set].sort();
    // Inject Popular as first synthetic category
    return ["Popular", ...arr];
  }, [creators]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = creators
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => {
        const cat = c.category || "";
        if (cat && disabledCategories.has(cat)) return false;
        if (activeCategory === "Popular") {
          // Only include creators that have at least one status with known clicks
          const hasPopular = (c.posts||[]).some(p=> (popularMap[p.id]||0)>0);
          if (!hasPopular) return false;
        }
        if (!q) return true;
        if ((c.name || "").toLowerCase().includes(q)) return true;
        if (cat.toLowerCase().includes(q)) return true;
        if ((c.posts || []).some((p) => ((p.caption || p.text || "").toLowerCase().includes(q)))) return true;
        return false;
      });
    if (activeCategory==="Popular") {
      // Rank by max post clicks (sensible: one click doesn't dominate forever because ranking is by count, not recency boost)
      list = list.sort((a,b)=>{
        const aMax = Math.max(0, ...a.c.posts.map(p=>popularMap[p.id]||0));
        const bMax = Math.max(0, ...b.c.posts.map(p=>popularMap[p.id]||0));
        if (bMax!==aMax) return bMax-aMax;
        return (b.c.posts[0]?.createdAt||0)-(a.c.posts[0]?.createdAt||0);
      });
    }
    return list;
  }, [creators, query, disabledCategories, activeCategory, popularMap]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const names = [...new Set(creators.map((c) => c.name).filter(Boolean))];
    const opts = [...names, ...allCategories];
    return [...new Set(opts)]
      .filter((o) => o.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, creators, allCategories]);

  // Not visible → render nothing at all (unless an external source is driving it,
  // e.g. Updates/Public in Jewish-style mode, which is always "visible").
  if (!externalItems && !visible) return null;

  const openCreator = (index) => {
    setViewerIndex(index);
    // Analytics: count intentional open, not render/preload. Record first post of creator as viewed status.
    try {
      const creator = creators[index];
      const post = creator?.posts?.[0];
      if (post?.id) {
        recordJewishStatusClick({ statusId: post.id, creatorKey: creator.key, creatorName: creator.name, title: post.caption || post.text || creator.name });
        if (user?.uid) recordJewishUserClick(user.uid);
      }
    } catch {}
  };
  const closeViewer = () => setViewerIndex(null);
  const handleViewerAdvance = (creatorKey) => {
    try {
      const c = creators.find(x=>x.key===creatorKey);
      const post = c?.posts?.[0];
      if (post?.id) {
        recordJewishStatusClick({ statusId: post.id, creatorKey: c.key, creatorName: c.name, title: post.caption||post.text||c.name });
        if (user?.uid) recordJewishUserClick(user.uid);
      }
    } catch {}
  };

  const changeLayout = (l) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* non-fatal */
    }
  };

  const toggleCategory = (cat) => {
    setDisabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const containerStyle = {
    maxWidth: 390,
    margin: "0 auto",
    padding: "12px 12px 16px",
    boxSizing: "border-box",
    color: t.text,
  };
  const visibleItems = showAll ? filteredItems : filteredItems.slice(0, visibleCount);

  const emptyState = (msg) => (
    <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, padding: "28px 12px" }}>
      {msg}
    </div>
  );

  const renderLayout = () => {
    const items = visibleItems;
    if (items.length === 0) {
      return emptyState(
        creators.length === 0 ? "No statuses available." : "No statuses match your filters."
      );
    }

    if (layout === "grid") {
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            paddingBottom: 6,
          }}
        >
          {items.map(({ c, index }) => {
            const seen = viewed.has(c.key);
            return (
              <div
                key={c.key}
                onClick={() => openCreator(index)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <div style={{ position: "relative" }}>
                <Avatar c={c} t={t} seen={seen} size={64} />
                <LikeButton c={c} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.text,
                    maxWidth: 72,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "center",
                  }}
                >
                  {c.name}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (layout === "list") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 6 }}>
          {items.map(({ c, index }) => {
            const seen = viewed.has(c.key);
            return (
              <div
                key={c.key}
                onClick={() => openCreator(index)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 6px",
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                <div style={{ position: "relative" }}>
                <Avatar c={c} t={t} seen={seen} size={44} />
                <LikeButton c={c} size={18} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: t.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.category || ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (layout === "cards") {
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, paddingBottom: 6 }}>
          {items.map(({ c, index }) => {
            const seen = viewed.has(c.key);
            const first = (c.posts || [])[0];
            const media = first ? first.thumbnailUrl || first.mediaUrl : null;
            const isText = !first || first.kind === "text" || (!media);
            return (
              <div
                key={c.key}
                onClick={() => openCreator(index)}
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 12,
                  overflow: "hidden",
                  cursor: "pointer",
                  background: isText ? (t.primary || "#111B21") : "#000",
                  border: seen ? "2px solid rgba(255,255,255,0.18)" : `2px solid ${t.primary}`,
                  boxSizing: "border-box",
                }}
              >
                <LikeButton c={c} size={22} />
                {!isText && (
                  <img
                    src={media}
                    alt=""
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                {isText && (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 18,
                      padding: 10,
                      textAlign: "center",
                      boxSizing: "border-box",
                    }}
                  >
                    {c.name}
                  </div>
                )}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: "16px 8px 8px",
                    background: "linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))",
                    color: "#fff",
                    fontSize: 12.5,
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.name}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // "stories" (default) — horizontal rail, slightly taller.
    return (
      <div
        className="noPagerSwipe"
        style={{
          display: "flex",
          gap: 14,
          overflowX: "auto",
          paddingBottom: 6,
          scrollbarWidth: "none",
        }}
      >
        {items.map(({ c, index }) => {
          const seen = viewed.has(c.key);
          return (
            <div
              key={c.key}
              onClick={() => openCreator(index)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0, width: 70 }}
            >
              <div style={{ position: "relative" }}>
              <Avatar c={c} t={t} seen={seen} size={68} />
              <LikeButton c={c} />
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: t.text,
                  maxWidth: 70,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "center",
                }}
              >
                {c.name}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={containerStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.textMuted, marginBottom: 10, letterSpacing: 0.3 }}>
          {headerTitle}
        </div>

      {/* Layout picker */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => changeLayout(l)}
            style={{
              flex: 1,
              minWidth: 64,
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: layout === l ? t.primary : "rgba(255,255,255,0.18)",
              background: layout === l ? t.primary : "transparent",
              color: layout === l ? "#fff" : t.text,
              fontSize: 12,
              fontWeight: 600,
              textTransform: "capitalize",
              cursor: "pointer",
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Manual Refresh: invalidates the short-TTL RAM cache and forces a fresh
          fetch. Repeat visits otherwise render the cached feed instantly. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 9,
            border: `1.5px solid ${t.border}`, background: "transparent",
            color: t.primary, fontSize: 12.5, fontWeight: 700, cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} className={refreshing ? "nx-spin" : undefined} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Search with autocomplete */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <input
          type="text"
          value={query}
          placeholder="Search names or categories…"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.18)",
            background: t.surface,
            color: t.text,
            fontSize: 13,
            outline: "none",
          }}
        />
        {focused && suggestions.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 4,
              background: t.surface,
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 10,
              overflow: "hidden",
              zIndex: 20,
            }}
          >
            {suggestions.map((s) => (
              <div
                key={s}
                onMouseDown={() => setQuery(s)}
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  color: t.text,
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All / Current toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button
          onClick={() => { if (showAll) toggleShowAll(); }}
          style={{
            padding: "5px 14px", borderRadius: 999, border: "1px solid",
            borderColor: !showAll ? t.primary : "rgba(255,255,255,0.18)",
            background: !showAll ? t.primary : "transparent",
            color: !showAll ? "#fff" : t.textMuted,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          LOAD
        </button>
        <button
          onClick={() => { if (!showAll) toggleShowAll(); }}
          style={{
            padding: "5px 14px", borderRadius: 999, border: "1px solid",
            borderColor: showAll ? t.primary : "rgba(255,255,255,0.18)",
            background: showAll ? t.primary : "transparent",
            color: showAll ? "#fff" : t.textMuted,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          All
        </button>
      </div>

      {/* Category filter chips - Popular is single-select active category */}
      {allCategories.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {allCategories.map((cat) => {
            if (cat==="Popular") {
              const active = activeCategory==="Popular";
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(active ? "all" : "Popular")}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: active ? t.primary : "rgba(255,255,255,0.18)",
                    background: active ? t.primary : "transparent",
                    color: active ? "#fff" : t.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ★ Popular
                </button>
              );
            }
            const off = disabledCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: "1px solid",
                  borderColor: off ? "rgba(255,255,255,0.18)" : t.primary,
                  background: off ? "transparent" : t.primary,
                  color: off ? t.textMuted : "#fff",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}
      {activeCategory==="Popular" && filteredItems.length===0 && !loading && (
        <div style={{ textAlign:"center", color:t.textMuted, fontSize:12.5, padding:"12px 0" }}>
          No popular statuses yet — engagement data is still building. Check back soon!
        </div>
      )}

      {/* Liked Creators — persisted locally; tap to open, heart to remove */}
      {likedCreators.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted, marginBottom: 8 }}>♥ Liked Creators</div>
          <div className="noPagerSwipe" style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
            {likedCreators.map((c) => {
              const idx = creators.findIndex((x) => x.key === c.key);
              return (
                <div key={c.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0, width: 64, position: "relative" }} onClick={() => idx >= 0 && openCreator(idx)}>
                  <Avatar c={c} t={t} seen={viewed.has(c.key)} size={56} />
                  <div style={{ fontSize: 11, color: t.text, maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{c.name}</div>
                  <div onClick={(e) => { e.stopPropagation(); toggleLike(c.key); }} title="Remove from Liked Creators" style={{ position: "absolute", top: 0, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <span style={{ color: "#FF3B30", fontSize: 12, lineHeight: 1 }}>♥</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && builtCreators.length===0 ? (
        emptyState("Loading…")
      ) : offline && builtCreators.length===0 ? (
        emptyState("Couldn't load statuses right now. Check back later.")
      ) : filteredItems.length===0 && activeCategory!=="Popular" ? (
        emptyState(creators.length===0 ? "No statuses available." : "No statuses match your filters.")
      ) : (
        <>
          {renderLayout()}
          {!showAll && visibleItems.length < filteredItems.length && (
            <div style={{ display:"flex", justifyContent:"center", marginTop:12 }}>
              <button onClick={()=>setVisibleCount(v=>v+18)} style={{ padding:"8px 16px", borderRadius:9, border:`1px solid ${t.border}`, background:"transparent", color:t.primary, fontWeight:700, fontSize:13, cursor:"pointer" }}>Load more</button>
            </div>
          )}
        </>
      )}

      {/* Attribution footer (admin-controllable: show/hide, custom text + links).
          Only shown in the native Jewish Statuses mode. */}
      {!externalItems && attribution && attribution.show && (
      <div
        style={{
          fontSize: 11,
          color: t.textMuted,
          textAlign: "center",
          paddingTop: 14,
          maxWidth: 320,
          margin: "0 auto",
          lineHeight: 1.4,
        }}
      >
        {attribution.text}
        <br />
        Visit{" "}
        <a href={attribution.jewishStatusLink} target="_blank" rel="noopener noreferrer" style={{ color: t.textMuted, textDecoration: "underline" }}>
          JewishStatus
        </a>{" "}
        · Visit{" "}
        <a href={attribution.yidStatusLink} target="_blank" rel="noopener noreferrer" style={{ color: t.textMuted, textDecoration: "underline" }}>
          YidStatus
        </a>
      </div>
      )}

      {viewerIndex != null && creators[viewerIndex] && (
        <StoryViewer
          creators={creators}
          initialCreatorIndex={viewerIndex}
          onClose={closeViewer}
          onViewCreator={(key)=>{ markViewed(key); handleViewerAdvance(key); }}
        />
      )}
    </div>
  );
}
