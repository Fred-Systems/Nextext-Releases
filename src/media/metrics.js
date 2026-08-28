// Lightweight client metrics for Status video pipeline and message media.
// No PII, no private URLs.

export function logStatusUpload({ statusId, durationMs, sourceBytes, sourceW, sourceH, fps }) {
  try {
    console.log(JSON.stringify({ event: "status_upload", statusId, durationMs, sourceBytes, sourceW, sourceH, fps, ts: Date.now() }));
  } catch {}
}
export function logTranscode({ statusId, queueDelayMs, transcodeMs, renditions, sourceBytes, outputBytes }) {
  try {
    const ratio = sourceBytes ? (outputBytes / sourceBytes).toFixed(2) : null;
    console.log(JSON.stringify({ event: "status_transcode", statusId, queueDelayMs, transcodeMs, renditions, sourceBytes, outputBytes, ratio }));
  } catch {}
}
export function logPlayback({ statusId, timeToFirstFrameMs, rebufferCount, rebufferMs, renditionSwitches, completed }) {
  try {
    console.log(JSON.stringify({ event: "status_playback", statusId, timeToFirstFrameMs, rebufferCount, rebufferMs, renditionSwitches, completed }));
  } catch {}
}
export function logCardPreview({ statusId, bytes, cacheHit, started, completed, cancelled, wastedBytes }) {
  try {
    console.log(JSON.stringify({ event: "card_preview", statusId, bytes, cacheHit, started, completed, cancelled, wastedBytes }));
  } catch {}
}
export function logError({ statusId, code, where }) {
  try { console.log(JSON.stringify({ event: "error", statusId, code, where })); } catch {}
}
