import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useTheme } from "../../theme/ThemeContext";

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

  const rafRef = useRef(0);
  const startRef = useRef(null);
  const heldRef = useRef(false);
  const holdTimer = useRef(null);
  const pressStart = useRef({ x: 0, y: 0 });

  const creator = creators[ci];
  const posts = creator ? creator.posts : [];
  const post = posts[pi];

  // Reset per-slide state.
  useEffect(() => {
    setProgress(0);
    setMediaError(false);
    setPaused(false);
    startRef.current = null;
  }, [ci, pi]);

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
  const onPointerDown = useCallback(
    (e) => {
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
      if (heldRef.current) {
        setPaused(false);
        heldRef.current = false;
        return;
      }
      const dx = e.clientX - pressStart.current.x;
      const dy = e.clientY - pressStart.current.y;
      if (Math.abs(dx) > 60 || Math.abs(dy) > 60) return; // ignore drags
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

  const player = useStoryPlayer(creators, initialCreatorIndex, {
    onFinish: onClose,
    onAdvanceCreator: (key) => onViewCreator?.(key),
  });

  // Mark the starting creator as viewed.
  useEffect(() => {
    const c = creators[initialCreatorIndex];
    if (c) onViewCreator?.(c.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const videoRef = useRef(null);
  const audioRef = useRef(null);

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
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
      onPointerDown={player.onPointerDown}
      onPointerUp={player.onPointerUp}
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
            {creator.sources.length > 1 ? " · multi-source" : ""}
          </div>
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
            Media unavailable
          </div>
        ) : kind === "video" ? (
          <video
            key={post.id}
            ref={videoRef}
            src={post.mediaUrl}
            poster={post.thumbnailUrl || undefined}
            autoPlay
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onTimeUpdate={player.onVideoTimeUpdate}
            onEnded={() => player.handleMediaEnded()}
            onError={() => player.setMediaError(true)}
          />
        ) : kind === "image" ? (
          <img
            src={post.mediaUrl}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            onError={() => player.setMediaError(true)}
          />
        ) : kind === "audio" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, color: "#fff" }}>
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
            style={{
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
            }}
          >
            {post.text || post.caption || "No text"}
          </div>
        )}

        {caption && kind !== "text" && (
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 12,
              right: 12,
              background: "rgba(0,0,0,0.6)",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            {caption}
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
    </div>,
    document.body
  );
}
