import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "../../theme/ThemeContext";
import { useGlobalSettings } from "../../firebase/config-settings";
import { resolveJewishStatusAttribution } from "../../firebase/config-settings";
import { useAuth } from "../../firebase/useAuth";
import { buildFeed, refreshFeed } from "./feed";
import StoryViewer from "./StoryViewer";

const VIEWED_KEY = "nextext_jewish_statuses_viewed_v1";
const LAYOUT_KEY = "nextext_jewish_layout";
const LAYOUTS = ["stories", "grid", "list", "cards"];

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

export default function JewishStatusesTab({ onStoryViewerChange }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const { userDoc } = useAuth();

  const js = globalSettings?.jewishStatuses || {};
  // Admin-controllable attribution (show/hide + custom text/links; defaults SHOW).
  const attribution = resolveJewishStatusAttribution(globalSettings);
  const override = userDoc?.jewishStatusesOverride || "inherit";
  const globalEnabled = js.enabled === true;

  // Visibility rule from the spec:
  //   featureEnabledForUser = override==="enabled" || (override!=="disabled" && globalEnabled)
  const visible = override === "enabled" || (override !== "disabled" && globalEnabled);

  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [viewed, setViewed] = useState(loadViewed());
  const [layout, setLayout] = useState(loadLayout);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [disabledCategories, setDisabledCategories] = useState(() => new Set());

  const markViewed = useCallback((key) => {
    setViewed((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      saveViewed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    setLoading(true);
    setOffline(false);
    buildFeed(globalSettings)
      .then((res) => {
        if (cancelled) return;
        setCreators(res.creators);
        setLoading(false);
        setOffline(res.creators.length === 0);
        if (res.needsRefresh) {
          refreshFeed(globalSettings)
            .then((fresh) => {
              if (cancelled) return;
              setCreators(fresh);
              setOffline(fresh.length === 0);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, globalSettings]);

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
    return [...set].sort();
  }, [creators]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return creators
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => {
        const cat = c.category || "";
        if (cat && disabledCategories.has(cat)) return false;
        if (!q) return true;
        if ((c.name || "").toLowerCase().includes(q)) return true;
        if (cat.toLowerCase().includes(q)) return true;
        if ((c.posts || []).some((p) => ((p.caption || p.text || "").toLowerCase().includes(q)))) return true;
        return false;
      });
  }, [creators, query, disabledCategories]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const names = [...new Set(creators.map((c) => c.name).filter(Boolean))];
    const opts = [...names, ...allCategories];
    return [...new Set(opts)]
      .filter((o) => o.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, creators, allCategories]);

  // Not visible → render nothing at all.
  if (!visible) return null;

  const openCreator = (index) => setViewerIndex(index);
  const closeViewer = () => setViewerIndex(null);

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

  const emptyState = (msg) => (
    <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, padding: "28px 12px" }}>
      {msg}
    </div>
  );

  const renderLayout = () => {
    if (filteredItems.length === 0) {
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
          {filteredItems.map(({ c, index }) => {
            const seen = viewed.has(c.key);
            return (
              <div
                key={c.key}
                onClick={() => openCreator(index)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <Avatar c={c} t={t} seen={seen} size={64} />
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
          {filteredItems.map(({ c, index }) => {
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
                <Avatar c={c} t={t} seen={seen} size={44} />
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
          {filteredItems.map(({ c, index }) => {
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
                {!isText && (
                  <img
                    src={media}
                    alt=""
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
        {filteredItems.map(({ c, index }) => {
          const seen = viewed.has(c.key);
          return (
            <div
              key={c.key}
              onClick={() => openCreator(index)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0, width: 70 }}
            >
              <Avatar c={c} t={t} seen={seen} size={68} />
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
        JEWISH STATUSES
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

      {/* Category filter chips */}
      {allCategories.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {allCategories.map((cat) => {
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

      {loading ? (
        emptyState("Loading…")
      ) : offline ? (
        emptyState("Couldn't load statuses right now. Check back later.")
      ) : (
        renderLayout()
      )}

      {/* Attribution footer (admin-controllable: show/hide, custom text + links) */}
      {attribution.show && (
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
          onViewCreator={markViewed}
        />
      )}
    </div>
  );
}
