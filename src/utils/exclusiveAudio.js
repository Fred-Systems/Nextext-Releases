// Global "one voice note at a time" manager. When a new audio element starts
// playing we pause whatever was playing before, so two AI voice replies (or any
// registered players) never overlap.
let current = null;

export function registerAudioPlay(el) {
  if (!el) return;
  if (current && current !== el && !current.paused) {
    try { current.pause(); } catch {}
  }
  current = el;
}

export function unregisterAudioPlay(el) {
  if (current === el) current = null;
}
