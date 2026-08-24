import React, { useState, useRef } from "react";

// Pinch-to-zoom + drag-to-pan media viewer. Works for images and videos and is
// reused by the in-chat fullscreen viewer and the status story viewer.
export default function ZoomableMedia({ src, type = "image", allowZoom = true, onTap, extraStyle, videoProps, mediaRef }) {
  const [tf, setTf] = useState({ scale: 1, x: 0, y: 0 });
  const pts = useRef(new Map());
  const start = useRef(null);
  const lastTap = useRef(0);

  const reset = () => setTf({ scale: 1, x: 0, y: 0 });

  const onPointerDown = (e) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const vals = [...pts.current.values()];
    if (pts.current.size === 1) {
      start.current = { ...tf, x0: e.clientX, y0: e.clientY };
    } else if (pts.current.size === 2) {
      const [a, b] = vals;
      start.current = { ...tf, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  };

  const onPointerMove = (e) => {
    if (!pts.current.has(e.pointerId) || !start.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current;
    if (pts.current.size === 1) {
      setTf({ scale: s.scale, x: s.x + (e.clientX - s.x0), y: s.y + (e.clientY - s.y0) });
    } else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const newScale = Math.min(6, Math.max(1, s.scale * (dist / s.dist)));
      const ratio = newScale / s.scale;
      const x = s.x + (cx - s.cx) * (ratio - 1) + (cx - window.innerWidth / 2) * (1 - ratio);
      const y = s.y + (cy - s.cy) * (ratio - 1) + (cy - window.innerHeight / 2) * (1 - ratio);
      setTf({ scale: newScale, x, y });
    }
  };

  const onPointerUp = (e) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) start.current = null;
    if (tf.scale <= 1.01) reset();
  };

  const onWheel = (e) => {
    if (!allowZoom) return;
    const delta = -e.deltaY * 0.0016;
    const newScale = Math.min(6, Math.max(1, tf.scale + delta * tf.scale));
    setTf({ scale: newScale, x: tf.x, y: tf.y });
    if (newScale <= 1.01) reset();
  };

  const onDouble = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setTf((p) => (p.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.4, x: 0, y: 0 }));
    }
    lastTap.current = now;
  };

  const mediaStyle = {
    maxWidth: "100%",
    maxHeight: "100%",
    width: "auto",
    height: "auto",
    objectFit: "contain",
    borderRadius: 8,
    transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`,
    transition: pts.current.size ? "none" : "transform 0.12s ease-out",
    touchAction: "none",
    userSelect: "none",
    pointerEvents: "auto",
    ...extraStyle,
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={onDouble}
      onClick={(e) => { e.stopPropagation(); onTap && onTap(); }}
      style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", overflow: "hidden" }}
    >
      {type === "video" ? (
        <video ref={mediaRef} src={src} playsInline controls={!allowZoom} style={mediaStyle} {...(videoProps || {})} />
      ) : (
        <img src={src} alt="" draggable={false} style={mediaStyle} />
      )}
    </div>
  );
}
