import React from "react";

// Animated sound-wave shown while a voice message is speaking. Bars pulse only
// when `playing` is true; otherwise they rest at a low static height. Uses the
// existing `nextext-voice-bar` keyframe from index.css (Chrome 83 safe — height
// animation only, no flex gap / aspect-ratio).
export default function VoiceWaveform({ playing = false, bars = 9, color = "#ffffff", size = 22 }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2, height: size, flex: "0 0 auto" }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: 3,
            borderRadius: 2,
            background: color,
            height: playing ? 6 : 6,
            animation: playing
              ? `nextext-voice-bar 0.55s ease-in-out ${(i * 0.06).toFixed(2)}s infinite alternate`
              : "none",
          }}
        />
      ))}
    </div>
  );
}
