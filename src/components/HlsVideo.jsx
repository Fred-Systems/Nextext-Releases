import React, { useEffect, useRef } from "react";

// Minimal HLS wrapper: uses native HLS where supported (iOS Safari), else hls.js
// No new player framework; reuses existing <video> element and respects mute/autoplay/battery/background.
export default function HlsVideo({ src, fallbackSrc, poster, onLoadedMetadata, onEnded, onTimeUpdate, videoRef: outerRef, ...props }) {
  const innerRef = useRef(null);
  const ref = outerRef || innerRef;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let hls = null;
    let cancelled = false;

    const canNativeHls = v.canPlayType("application/vnd.apple.mpegurl") !== "";

    const attachFallback = () => {
      if (fallbackSrc) {
        v.src = fallbackSrc;
        v.load();
      } else if (src) {
        // If HLS fails and no fallback, try master as progressive (may still fail)
        v.src = src;
        v.load();
      }
    };

    if (src && src.endsWith(".m3u8")) {
      if (canNativeHls) {
        v.src = src;
        v.load();
      } else {
        // Dynamic import hls.js only when needed to avoid bundling overhead for native HLS clients
        import("hls.js").then((mod) => {
          if (cancelled || !ref.current) return;
          const Hls = mod.default;
          if (Hls.isSupported()) {
            hls = new Hls({
              startLevel: 0, // conservative start
              capLevelToPlayerSize: true,
              maxBufferLength: 10, // ~5 segments (2s each) → 1-2 segments before playback via config below
              maxMaxBufferLength: 30,
              liveSyncDurationCount: 2,
              abrEwmaFastLive: 3,
              abrEwmaSlowLive: 9,
              abrBandWidthFactor: 0.8, // switch down early
              abrBandWidthUpFactor: 0.7,
            });
            hls.loadSource(src);
            hls.attachMedia(v);
            hls.on(mod.default.Events.ERROR, (evt, data) => {
              if (data.fatal) {
                // MANIFEST_LOAD_ERROR, NETWORK_ERROR, MEDIA_ERROR
                console.warn("[HlsVideo] fatal", data.type, data.details);
                // Try fallback
                hls.destroy();
                attachFallback();
              }
            });
          } else {
            attachFallback();
          }
        }).catch(() => attachFallback());
      }
    } else if (src) {
      v.src = src;
      v.load();
    } else if (fallbackSrc) {
      v.src = fallbackSrc;
      v.load();
    }

    return () => {
      cancelled = true;
      if (hls) { try { hls.destroy(); } catch {} }
    };
  }, [src, fallbackSrc]);

  return (
    <video
      ref={ref}
      poster={poster}
      playsInline
      preload="metadata"
      onLoadedMetadata={onLoadedMetadata}
      onEnded={onEnded}
      onTimeUpdate={onTimeUpdate}
      {...props}
    />
  );
}
