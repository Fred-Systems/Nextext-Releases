import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Play, Pause, SkipForward, Download, RefreshCw, Eye, EyeOff } from "lucide-react";
import { useGlobalSettings, resolveJewishStatusDownloadAllowed } from "../../firebase/config-settings";
import { useAuth } from "../../firebase/useAuth";
import { downloadBlobToDevice, extFromType } from "../../media/deviceDownload";
import { useTheme } from "../../theme/ThemeContext";
import { canExtendStatus, extendStatus } from "../../firebase/status";
import { useRemoteConfig, getFeatureFlag } from "../../firebase/remoteConfig";
import { getSignedUrl } from "../../supabase/media";

const DEFAULT_DURATION_MS = 5000;
const HOLD_MS = 180;

function kindDurationMs(post) {
  if (!post) return DEFAULT_DURATION_MS;
  if (post.kind === "video" || post.kind === "audio") return 0; // driven by media element
  if (post.durationMs && post.durationMs > 0) return post.durationMs;
  return DEFAULT_DURATION_MS;
}

function renderKind(post) {
  if (!post) return "unknown";
  if (post.kind === "video") return "video";
  if (post.kind === "audio") return "audio";
  if (post.kind === "image") return "image";
  if (post.kind === "text") return "text";
  // Unknown: fall back to media presence.
  return post.mediaUrl ? "image" : "text";
}

// Timeline/state logic isolated from the UI. Drives progress for image/text
// posts via rAF and exposes hooks the component wires to media elements.
function useStoryPlayer(creators, initialIndex, { onFinish, onAdvanceCreator } = {}) {
  const [ci, setCi] = useState(() =>
    Math.max(0, Math.min(initialIndex || 0, Math.max(0, creators.length - 1)))
  );
  const [pi, setPi] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  // Resolved signed URL for pipeline video statuses where mediaUrl is null
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState(null);

  const rafRef = useRef(0);
  const startRef = useRef(null);
  const heldRef = useRef(false);
  const holdTimer = useRef(null);
  const pressStart = useRef({ x: 0, y: 0 });
  // Set while a two-finger pinch is in progress so the release of the primary
  // finger is swallowed (never pauses, advances, or closes the story).
  const pinchActive = useRef(false);
  // Double-tap is reserved for zoom reset — the second tap never navigates.
  const lastTap = useRef(0);

  const creator = creators[ci];
  const posts = creator ? creator.posts : [];
  const post = posts[pi];

  // Reset per-slide state.
  useEffect(() => {
    setProgress(0);
    setMediaError(false);
    setPaused(false);
    setResolvedVideoUrl(null);
    startRef.current = null;
  }, [ci, pi]);

  // Resolve signed URLs for pipeline video statuses where mediaUrl is null
  useEffect(() => {
    if (!post || post.mediaUrl || post.kind !== "video") { setResolvedVideoUrl(null); return; }
    let cancelled = false;
    (async () => {
      try {
        if (post.fallbackPath) {
          const u = await getSignedUrl(post.fallbackPath, post.expiresAt);
          if (!cancelled) setResolvedVideoUrl(u);
        } else if (post.hlsMasterPath) {
          const u = await getSignedUrl(post.hlsMasterPath, post.expiresAt);
          if (!cancelled) setResolvedVideoUrl(u);
        }
      } catch { if (!cancelled) setResolvedVideoUrl(null); }
    })();
    return () => { cancelled = true; };
  }, [post?.id, post?.mediaUrl, post?.kind, post?.fallbackPath, post?.hlsMasterPath, post?.expiresAt]);

  const advance = useCallback(() => {
    if (!creators.length) return;
    if (pi < posts.length - 1) {
      setPi(pi + 1);
      return;
    }
    if (ci < creators.length - 1) {
      const nextKey = creators[ci + 1]?.key;
      setCi(ci + 1);
      setPi(0);
      if (nextKey) onAdvanceCreator?.(nextKey);
      return;
    }
    onFinish?.();
  }, [ci, pi, posts.length, creators, onFinish, onAdvanceCreator]);

  const goBack = useCallback(() => {
    if (pi > 0) {
      setPi(pi - 1);
      return;
    }
    if (ci > 0) {
      const prev = creators[ci - 1];
      setCi(ci - 1);
      setPi(Math.max(0, (prev?.posts || []).length - 1));
      return;
    }
    startRef.current = null;
    setProgress(0);
  }, [ci, pi, creators]);

  // Drive progress for image/text/unknown (non-media) posts.
  useEffect(() => {
    if (!post) return;
    if (post.kind === "video" || post.kind === "audio") return;
    if (paused) return;
    const dur = kindDurationMs(post);
    let mounted = true;
    const tick = (ts) => {
      if (!mounted) return;
      if (startRef.current == null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const p = Math.min(1, elapsed / dur);
      setProgress(p);
      if (p >= 1) {
        advance();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [post, paused, advance]);

  // If media errors, advance after a short delay so the viewer never hangs.
  useEffect(() => {
    if (!mediaError) return undefined;
    const id = setTimeout(() => advance(), 2500);
    return () => clearTimeout(id);
  }, [mediaError, advance]);

  const onVideoTimeUpdate = useCallback((e) => {
    const v = e.currentTarget;
    const d = v.duration;
    if (d && isFinite(d) && d > 0) setProgress(Math.min(1, v.currentTime / d));
  }, []);

  const handleMediaEnded = useCallback(() => {
    const id = setTimeout(() => advance(), 300);
    return () => clearTimeout(id);
  }, [advance]);

  // Press-and-hold to pause; quick tap to navigate.
  // Pinch-zoom must never pause media: the second finger's pointerdown is
  // non-primary, so it cancels any pending hold-to-pause timer, resumes
  // playback, and marks the gesture — the primary finger's release below is
  // then swallowed instead of navigating.
  const onPointerDown = useCallback(
    (e) => {
      if (e?.isPrimary === false) {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        heldRef.current = false;
        pinchActive.current = true;
        setPaused(false);
        return;
      }
      pressStart.current = { x: e.clientX, y: e.clientY };
      heldRef.current = false;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        heldRef.current = true;
        setPaused(true);
      }, HOLD_MS);
    },
    []
  );

  const onPointerUp = useCallback(
    (e) => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      // Non-primary (second finger) release: part of a pinch, never navigate.
      if (e?.isPrimary === false) return;
      // Primary release ending a pinch: swallow so zooming never
      // pauses, advances, or closes the story.
      if (pinchActive.current) {
        pinchActive.current = false;
        heldRef.current = false;
        return;
      }
      if (heldRef.current) {
        setPaused(false);
        heldRef.current = false;
        return;
      }
      const dx = e.clientX - pressStart.current.x;
      const dy = e.clientY - pressStart.current.y;
      if (Math.abs(dx) > 60 || Math.abs(dy) > 60) return; // ignore drags
      // Double-tap is reserved for zoom reset — never navigate on it.
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      if (relX < rect.width * 0.33) goBack();
      else advance();
    },
    [advance, goBack]
  );

  return {
    ci,
    pi,
    paused,
    setPaused,
    progress,
    mediaError,
    setMediaError,
    post,
    creator,
    posts,
    advance,
    goBack,
    onVideoTimeUpdate,
    handleMediaEnded,
    onPointerDown,
    onPointerUp,
  };
}

export default function StoryViewer({ creators, initialCreatorIndex = 0, onClose, onViewCreator }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const { userDoc } = useAuth();
  const myUid = userDoc?.uid;
  const { config: remoteConfig } = useRemoteConfig();
  // Admin-controlled download permission (global OFF by default + per-user override).
  const canDownload = resolveJewishStatusDownloadAllowed(globalSettings, userDoc);

  const [extending, setExtending] = useState(false);
  const [extendedAt, setExtendedAt] = useState(0);
  const extendEnabled = getFeatureFlag(remoteConfig, "statusExtend", { uid: myUid });
  // `player` MUST be declared before `canExtend` below, otherwise `canExtend`
  // references `player` while it is still in the temporal dead zone (it throws
  // "Cannot access 'player' before initialization"). `creators` /
  // `initialCreatorIndex` are props and are available here.
  const player = useStoryPlayer(creators, initialCreatorIndex, {
    onFinish: onClose,
    onAdvanceCreator: (key) => onViewCreator?.(key),
  });
  const canExtend =
    extendEnabled && player.creator?.ownerId === myUid && canExtendStatus(player.post) && Date.now() - extendedAt > 1500;
  const handleExtend = async () => {
    if (!post?.id || extending) return;
    setExtending(true);
    try {
      await extendStatus(post.id);
      setExtendedAt(Date.now());
    } catch (e) {
      console.error("[StoryViewer] extend failed:", e);
    } finally {
      setExtending(false);
    }
  };

  // Mark the starting creator as viewed.
  useEffect(() => {
    const c = creators[initialCreatorIndex];
    if (c) onViewCreator?.(c.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [capExpanded, setCapExpanded] = useState(false);
  const [dlState, setDlState] = useState(""); // "" | "saving" | saved-location | "failed:reason"
  // Byte progress for the current download ({ loaded, total }; total is 0 when
  // the server omits Content-Length). Null when idle.
  const [dlProgress, setDlProgress] = useState(null);

  // Viewer controls state.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rate, setRate] = useState(1);
  const SPEEDS = [0.5, 1, 1.5, 2];
  // When true, the bottom viewer control bar is hidden (e.g. for an unobstructed
  // view). Tapping the screen restores it (see root pointer handlers below).
  const [hideControls, setHideControls] = useState(false);

  // Refs that always point at the latest player/gesture state so the
  // async helper functions below operate on current values.
  const playerRef = useRef(player);
  playerRef.current = player;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const pinchRef = useRef(null);
  const lastTapRef = useRef(0);

  // Apply playback rate to any active media element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, player.post]);

  const cycleRate = () => {
    setRate((r) => {
      const i = SPEEDS.indexOf(r);
      return SPEEDS[(i + 1) % SPEEDS.length];
    });
  };

  // Jump to the next creator's first post (not just the next post).
  const skipToNextCreator = () => {
    const startCi = playerRef.current.ci;
    const step = () => {
      const p = playerRef.current;
      if (p.ci !== startCi) return;
      if (p.ci >= creators.length - 1 && p.pi >= p.posts.length - 1) {
        p.advance();
        return;
      }
      p.advance();
      requestAnimationFrame(step);
    };
    step();
  };

  // Seek the media element by a relative number of seconds.
  const seekRelative = (delta) => {
    const el =
      playerRef.current.post?.kind === "audio" ? audioRef.current : videoRef.current;
    if (el && el.duration && isFinite(el.duration)) {
      el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + delta));
    }
  };

  // Pinch-to-zoom gesture handlers (two-finger distance).
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchRef.current = {
        startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        startZoom: zoomRef.current,
        startPan: { ...panRef.current },
        startMid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
      };
    }
  };

  const onTouchMove = (e) => {
    const p = pinchRef.current;
    if (!p || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const nz = Math.max(1, Math.min(4, p.startZoom * (dist / p.startDist)));
    setZoom(nz);
    const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    setPan({
      x: p.startPan.x + (mid.x - p.startMid.x),
      y: p.startPan.y + (mid.y - p.startMid.y),
    });
  };

  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinchRef.current = null;
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
    lastTapRef.current = now;
  };

  const mediaTouchProps = { onTouchStart, onTouchMove, onTouchEnd };
  const mediaTransform = `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`;
  const withZoom = (base) => ({
    ...base,
    transform: mediaTransform,
    transformOrigin: "center center",
    touchAction: "none",
  });

  // Pause/resume the media element to match the player's paused state.
  useEffect(() => {
    const v = videoRef.current;
    if (v && player.post?.kind === "video") {
      if (player.paused) v.pause();
      else v.play().catch(() => {});
    }
  }, [player.paused, player.post]);

  // Optional: prefetch the next image so it loads instantly on advance.
  useEffect(() => {
    const next =
      player.posts[player.pi + 1] || creators[player.ci + 1]?.posts?.[0];
    if (next?.mediaUrl && next.kind === "image") {
      const img = new Image();
      img.src = next.mediaUrl;
    }
  }, [player.ci, player.pi, player.posts, creators]);

  if (!player.creator || !player.post) return null;

  const { post, creator, progress, mediaError } = player;
  const kind = renderKind(post);
  // Use resolved signed URL for pipeline videos, fallback to direct mediaUrl
  const effectiveVideoSrc = post?.mediaUrl || resolvedVideoUrl || null;
  const bg = kind === "image" || kind === "video" ? "#000" : t.primary || "#111B21";
  const caption = post.caption || post.text;

  return createPortal(
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: bg,
        zIndex: 2147483641,
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
      onPointerDown={(e) => { if (hideControls) setHideControls(false); else player.onPointerDown(e); }}
      onPointerUp={(e) => { if (hideControls) setHideControls(false); else player.onPointerUp(e); }}
    >
      {/* Progress bars (one per post of the current creator) */}
      <div
        style={{
          display: "flex",
          gap: 3,
          padding: "10px 12px 0",
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
      >
        {player.posts.map((p, i) => (
          <div
            key={p.id}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 2,
                background: t.primary || "#00A884",
                width: i < player.pi ? "100%" : i === player.pi ? `${progress * 100}%` : "0%",
                transition: i === player.pi && !player.paused ? "none" : "width 120ms linear",
              }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "18px 14px 8px",
          position: "absolute",
          top: 6,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {creator.avatarUrl ? (
          <img
            src={creator.avatarUrl}
            alt=""
            style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            {(creator.name || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {creator.name}
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11.5 }}>
            {creator.category}
            {(creator.sources?.length || 0) > 1 ? " · multi-source" : ""}
          </div>
        </div>
        {canExtend && (
          <button
            onClick={(e) => { e.stopPropagation(); handleExtend(); }}
            disabled={extending}
            style={{
              border: "none",
              borderRadius: 14,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: "rgba(255,255,255,0.18)",
              cursor: extending ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            {extending ? "Extending…" : "+10h Extend"}
          </button>
        )}
        <div
          onClick={(e) => {
            e.stopPropagation();
            setHideControls((v) => !v);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          title={hideControls ? "Show controls" : "Hide controls"}
          style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
        >
          {hideControls ? <Eye size={18} color="#fff" /> : <EyeOff size={18} color="#fff" />}
        </div>
        <X
          size={22}
          color="#fff"
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />
      </div>

      {/* Media / content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 20px 40px",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {mediaError ? (
          <div style={{ color: "#fff", textAlign: "center", fontSize: 14 }}>
            {post?.state === "queued" || post?.state === "processing" ? "Video is still processing — try again shortly." : "Media unavailable"}
          </div>
        ) : kind === "video" ? (
          // NOTE: key/src intentionally depend ONLY on post.id/post.mediaUrl.
          // Zoom/pan only change style.transform below, so gestures never
          // remount this element and playback is never restarted by them.
          <video
            key={post.id}
            ref={videoRef}
            src={effectiveVideoSrc}
            poster={post.thumbnailUrl || post.posterURL || undefined}
            autoPlay
            playsInline
            style={withZoom({ width: "100%", height: "100%", objectFit: "contain" })}
            {...mediaTouchProps}
            onTimeUpdate={player.onVideoTimeUpdate}
            onEnded={() => player.handleMediaEnded()}
            onError={() => player.setMediaError(true)}
          />
        ) : kind === "image" ? (
          <img
            src={post.mediaUrl}
            alt=""
            style={withZoom({ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" })}
            {...mediaTouchProps}
            onError={() => player.setMediaError(true)}
          />
        ) : kind === "audio" ? (
          <div {...mediaTouchProps} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, color: "#fff" }}>
            <div style={{ fontSize: 40 }}>🎵</div>
            <audio
              key={post.id}
              ref={audioRef}
              src={post.mediaUrl}
              autoPlay
              controls
              onEnded={() => player.handleMediaEnded()}
              onError={() => player.setMediaError(true)}
              style={{ width: "82%", maxWidth: 340 }}
            />
          </div>
        ) : (
          <div
            {...mediaTouchProps}
            style={withZoom({
              color: "#fff",
              fontWeight: 700,
              textAlign: "center",
              lineHeight: 1.3,
              width: "100%",
              boxSizing: "border-box",
              wordBreak: "break-word",
              overflowY: "auto",
              maxHeight: "100%",
              fontSize: Math.max(28, Math.min(64, Math.round(200 / Math.max(1, (post.text || " ").length / 3)))),
            })}
          >
            {post.text || post.caption || "No text"}
          </div>
        )}

        {caption && kind !== "text" && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              bottom: 16,
              left: 12,
              right: 12,
              maxHeight: capExpanded ? "60%" : 84,
              overflowY: capExpanded ? "auto" : "hidden",
              background: "rgba(0,0,0,0.6)",
              borderRadius: 8,
              padding: "8px 10px",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              textAlign: "center",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div>{caption}</div>
            {caption.length > 90 && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setCapExpanded((v) => !v);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#9ad",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {capExpanded ? "Show less" : "Read more"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pause indicator */}
      {player.paused && kind !== "video" && kind !== "audio" && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 60,
            height: 60,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 15,
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ width: 8, height: 24, borderRadius: 2, background: "#fff" }} />
            <div style={{ width: 8, height: 24, borderRadius: 2, background: "#fff" }} />
          </div>
        </div>
      )}

      {/* Nav buttons */}
      {player.pi > 0 && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            player.goBack();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: 6,
            top: "50%",
            transform: "translateY(-50%)",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 12,
          }}
        >
          <ChevronLeft size={18} color="#fff" />
        </div>
      )}
      {!(player.ci >= creators.length - 1 && player.pi >= player.posts.length - 1) && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            player.advance();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 12,
          }}
        >
          <ChevronRight size={18} color="#fff" />
        </div>
      )}

      {/* Viewer control bar (bottom-center, above the caption). Hidden when the
          user toggles "hide controls" — restored by tapping the screen. */}
      {!hideControls && (() => {
        const ctrlBtn = {
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#fff",
          pointerEvents: "auto",
        };
        return (
          <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: caption ? 100 : 16,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 10,
          zIndex: 14,
          pointerEvents: "none",
        }}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            player.setPaused(!player.paused);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={ctrlBtn}
        >
          {player.paused ? <Play size={18} color="#fff" /> : <Pause size={18} color="#fff" />}
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            seekRelative(-10);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{ ...ctrlBtn, fontSize: 11, fontWeight: 700 }}
        >
          -10s
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            skipToNextCreator();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={ctrlBtn}
        >
          <SkipForward size={18} color="#fff" />
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            seekRelative(10);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{ ...ctrlBtn, fontSize: 11, fontWeight: 700 }}
        >
          +10s
        </div>
        {/* Download control exists ONLY when the resolver permits it —
            no greyed icon, tooltip, or placeholder is rendered otherwise. */}
        {canDownload ? (
        <div
          onClick={async (e) => {
            e.stopPropagation();
            if (dlState === "saving" || !post?.mediaUrl) return;
            // The REAL provider URL, byte-for-byte as assembled upstream:
            // JewishStatus → `${CDN}/status-media/${media_path}` (R2 public
            // CDN, https); YidStatus → media_url verbatim. Never rewritten,
            // never proxied, never mirrored into our storage.
            const srcUrl = post.mediaUrl;
            setDlState("saving");
            setDlProgress({ loaded: 0, total: 0 });
            // Only set for network-level (CORS/offline) failures, where we
            // offer the untouched original URL in a new tab as a fallback.
            let networkBlocked = false;
            try {
              // Plain GET with NO custom headers (avoids a CORS preflight).
              // Note: <video>/<img> tags render cross-origin media fine
              // because they skip CORS — but reading the same bytes via
              // fetch() requires the provider to send
              // Access-Control-Allow-Origin. When it doesn't, fetch throws a
              // TypeError while the story still plays: that is a provider
              // CORS block, not an expired link, and is reported as such.
              let res;
              try {
                res = await fetch(srcUrl);
              } catch (fetchErr) {
                networkBlocked = true;
                const detail = fetchErr?.message ? ` (${fetchErr.message})` : "";
                throw new Error(
                  `Couldn't reach the source${detail}. The provider may block cross-origin reads (CORS) or you may be offline.`
                );
              }
              if (!res.ok) {
                throw new Error(
                  `Media is unavailable (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}). The provider removed or expired this file.`
                );
              }
              const total = Number(res.headers.get("content-length")) || 0;
              const reader = res.body?.getReader?.();
              let blob;
              if (!reader) {
                blob = await res.blob();
                setDlProgress({ loaded: blob.size, total: total || blob.size });
              } else {
                const chunks = [];
                let loaded = 0;
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (value) {
                    chunks.push(value);
                    loaded += value.byteLength || value.length || 0;
                    setDlProgress({ loaded, total });
                  }
                }
                blob = new Blob(chunks, { type: res.headers.get("content-type") || undefined });
              }
              if (!blob || !blob.size) throw new Error("The file came back empty (0 bytes).");
              setDlProgress({ loaded: blob.size, total: total || blob.size });
              // Verified device path only (Filesystem write + stat check on
              // native, anchor download on web). It throws on failure, so
              // success below is only claimed after a verified save.
              const r = await downloadBlobToDevice(blob, `jewishstatus-${Date.now()}.${extFromType(post.mediaUrl, post.kind)}`);
              setDlState(`saved:${r.location}`);
              setTimeout(() => { setDlState(""); setDlProgress(null); }, 4000);
            } catch (err) {
              if (networkBlocked) {
                // CORS-blocked bytes can still be opened at the untouched
                // original URL in a new tab for a manual save — nothing is
                // copied through our servers.
                try {
                  const a = document.createElement("a");
                  a.href = srcUrl;
                  a.target = "_blank";
                  a.rel = "noopener noreferrer";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                } catch { /* fallback is best-effort */ }
              }
              setDlState(`failed:${err?.message || "Download failed"}${networkBlocked ? " (opened the original in a new tab — save it manually)" : ""}`);
              setDlProgress(null);
              setTimeout(() => setDlState(""), 6000);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          title="Download to device (from the original source)"
          style={ctrlBtn}
        >
          {dlState === "saving" ? <RefreshCw size={16} color="#fff" style={{ animation: "nextext-spin 1s linear infinite" }} /> : <Download size={18} color="#fff" />}
        </div>
        ) : null}
        <div
          onClick={(e) => {
            e.stopPropagation();
            cycleRate();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{ ...ctrlBtn, fontSize: 12, fontWeight: 700 }}
        >
          {rate}x
        </div>
      </div>
        );
      })()}
      {/* Download feedback toast — success only on verified save, with location.
          While downloading, shows REAL byte progress instead of a silent wait. */}
      {!!dlState && (
        <div style={{ position: "absolute", bottom: caption ? 60 : 0, left: 0, right: 0, textAlign: "center", fontSize: 11.5, fontWeight: 600, color: dlState.indexOf("saved:") === 0 ? "#34C759" : dlState === "saving" ? "#4FC3E8" : "#FF3B30", zIndex: 15, textShadow: "0 1px 3px rgba(0,0,0,0.8)", padding: "0 16px" }}>
          {dlState === "saving"
            ? (dlProgress && dlProgress.total > 0
              ? `Downloading… ${Math.min(99, Math.round((dlProgress.loaded / dlProgress.total) * 100))}%`
              : `Downloading…${dlProgress && dlProgress.loaded > 0 ? ` ${(dlProgress.loaded / 1048576).toFixed(1)} MB` : ""}`)
            : dlState.indexOf("saved:") === 0 ? `Saved ✓ — ${dlState.slice(6)}` : dlState.slice(7)}
          {dlState === "saving" && dlProgress && dlProgress.total > 0 && (
            <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.25)", overflow: "hidden", marginTop: 4, maxWidth: 220, marginLeft: "auto", marginRight: "auto" }}>
              <div style={{ height: "100%", borderRadius: 2, background: "#4FC3E8", width: `${Math.min(100, (dlProgress.loaded / dlProgress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
