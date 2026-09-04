import React, { useState, useEffect, useCallback } from "react";
import { useTheme } from "../../theme/ThemeContext";
import { useGlobalSettings } from "../../firebase/config-settings";
import { useAuth } from "../../firebase/useAuth";
import { buildFeed, refreshFeed } from "./feed";
import StoryViewer from "./StoryViewer";

const VIEWED_KEY = "nextext_jewish_statuses_viewed_v1";

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

export default function JewishStatusesTab() {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const { userDoc } = useAuth();

  const js = globalSettings?.jewishStatuses || {};
  const override = userDoc?.jewishStatusesOverride || "inherit";
  const globalEnabled = js.enabled !== false;

  // Visibility rule from the spec:
  //   featureEnabledForUser = override==="enabled" || (override!=="disabled" && globalEnabled)
  const visible = override === "enabled" || (override !== "disabled" && globalEnabled);

  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [viewed, setViewed] = useState(loadViewed());

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

  // Not visible → render nothing at all.
  if (!visible) return null;

  const openCreator = (index) => setViewerIndex(index);
  const closeViewer = () => setViewerIndex(null);

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

  return (
    <div style={containerStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.textMuted, marginBottom: 10, letterSpacing: 0.3 }}>
        JEWISH STATUSES
      </div>

      {loading ? (
        emptyState("Loading…")
      ) : offline ? (
        emptyState("Couldn't load statuses right now. Check back later.")
      ) : creators.length === 0 ? (
        emptyState("No statuses available.")
      ) : (
        <div
          style={{
            display: "flex",
            gap: 14,
            overflowX: "auto",
            paddingBottom: 6,
            scrollbarWidth: "none",
          }}
        >
          {creators.map((c, i) => {
            const seen = viewed.has(c.key);
            return (
              <div
                key={c.key}
                onClick={() => openCreator(i)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0, width: 64 }}
              >
                <div
                  style={{
                    width: 62,
                    height: 62,
                    borderRadius: "50%",
                    padding: 3,
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
                          fontSize: 22,
                        }}
                      >
                        {(c.name || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: t.text,
                    maxWidth: 64,
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
