// Voice-note completion chimes, generated with the Web Audio API so no audio
// assets ship with the app. "warm" is the three-note default.

export const PING_SOUNDS = [
  { id: "classic", label: "Classic chime" },
  { id: "crystal", label: "Crystal bell" },
  { id: "soft", label: "Soft pop" },
  { id: "retro", label: "Retro beep" },
  { id: "bubble", label: "Bubble" },
  { id: "ding", label: "Ding" },
  { id: "triple", label: "Triple tone" },
  { id: "warm", label: "Warm chime" },
  { id: "sparkle", label: "Sparkle" },
  { id: "celesta", label: "Celesta" },
  { id: "marimba", label: "Marimba" },
  { id: "harp", label: "Harp sweep" },
];

const PATTERNS = {
  classic: [[880, 0, 0.13, 0.14], [1318.5, 0.1, 0.2, 0.14]],
  crystal: [[1046.5, 0, 0.18, 0.11], [1568, 0.12, 0.32, 0.09]],
  soft: [[523.25, 0, 0.16, 0.07]],
  retro: [[440, 0, 0.1, 0.13], [440, 0.12, 0.1, 0.13]],
  bubble: [[659.25, 0, 0.09, 0.12], [987.77, 0.09, 0.16, 0.11]],
  ding: [[1174.66, 0, 0.45, 0.09]],
  triple: [[784, 0, 0.08, 0.1], [1046.5, 0.09, 0.08, 0.1], [1318.5, 0.18, 0.22, 0.1]],
  warm: [[392, 0, 0.12, 0.11], [587.33, 0.08, 0.2, 0.12], [784, 0.18, 0.28, 0.1]],
  sparkle: [[1318.5, 0, 0.09, 0.08], [1568, 0.06, 0.09, 0.08], [2093, 0.14, 0.22, 0.09]],
  celesta: [[1318.5, 0, 0.18, 0.12], [1760, 0.06, 0.32, 0.1]],
  marimba: [[784, 0, 0.1, 0.13], [988, 0.08, 0.14, 0.12], [1318.5, 0.16, 0.22, 0.12]],
  harp: [[523.25, 0, 0.08, 0.09], [659.25, 0.05, 0.08, 0.09], [784, 0.1, 0.08, 0.09], [1046.5, 0.15, 0.28, 0.1]],
};

let pingCtx = null;

export function getPingSoundId() {
  try { return localStorage.getItem("nextext_voice_ping_sound") || "warm"; } catch { return "warm"; }
}

function tone(ac, freq, start, dur, gain) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.025);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

export function playVoicePing() {
  try {
    pingCtx = pingCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (pingCtx.state === "suspended") pingCtx.resume().catch(() => {});
    const now = pingCtx.currentTime;
    const id = getPingSoundId();
    (PATTERNS[id] || PATTERNS.classic).forEach(([freq, offset, dur, gain]) => tone(pingCtx, freq, now + offset, dur, gain));
  } catch { /* ping is best-effort */ }
}

// End-of-burst chime: a distinct, brighter completion sound played once when a
// RUN of consecutive voice notes (2+) finishes — on top of the regular per-note
// ping. The master chime toggle is `nextext_voice_end_chime`. The SEPARATE
// "2+ streak" toggle is `nextext_voice_streak_chime`: when that one is OFF,
// the regular per-note chime still plays but the brighter burst-complete
// arpeggio is suppressed (so streaks end silently after the last note).
export function playVoiceEndChime() {
  try {
    if (localStorage.getItem("nextext_voice_end_chime") === "off") return;
    // The 2+ streak special chime is a separate, user-facing toggle.
    if (localStorage.getItem("nextext_voice_streak_chime") === "off") return;
    pingCtx = pingCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (pingCtx.state === "suspended") pingCtx.resume().catch(() => {});
    const ac = pingCtx;
    const now = ac.currentTime;
    // Ascending major arpeggio (C5-E5-G5-C6) — reads clearly as "burst complete"
    // and is distinct from every per-note ping pattern.
    [[523.25, 0, 0.14], [659.25, 0.09, 0.16], [783.99, 0.18, 0.2], [1046.5, 0.28, 0.34]]
      .forEach(([freq, offset, dur]) => tone(ac, freq, now + offset, dur, 0.1));
  } catch { /* chime is best-effort */ }
}
