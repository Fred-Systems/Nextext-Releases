// Reads the real playback duration (in whole seconds) of an audio Blob/Media
// without playing it, using a throwaway <audio> element. Returns 0 on failure.
export async function getAudioDuration(blob) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      a.preload = "metadata";
      const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
      a.onloadedmetadata = () => {
        const d = a.duration;
        cleanup();
        resolve(isFinite(d) && d > 0 ? Math.round(d) : 0);
      };
      a.onerror = () => { cleanup(); resolve(0); };
      a.src = url;
    } catch {
      resolve(0);
    }
  });
}
