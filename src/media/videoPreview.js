// Client-side video preview clip generator.
//
// Creates a lightweight 2-3 second animated preview from the first frames of a
// video. Uses canvas + MediaRecorder (where supported) to produce a mini-MP4
// under 150KB. Falls back to a static poster JPEG when MediaRecorder is
// unavailable.

const PREVIEW_DURATION_SEC = 2.5;
const PREVIEW_FPS = 12;
const PREVIEW_WIDTH = 240;
const PREVIEW_QUALITY_MBPS = 0.15; // ~150 kbps target
const MAX_PREVIEW_BYTES = 150 * 1024; // 150 KB hard cap

/**
 * Generate a lightweight preview clip from a video File/Blob.
 * Returns { previewBlob: Blob|null, posterBlob: Blob|null }.
 *
 * - previewBlob: animated MP4/WebM clip (first ~2.5s, 240px wide, 12fps)
 * - posterBlob: static JPEG frame (first visually useful frame)
 *
 * Returns null for previewBlob when MediaRecorder is unavailable (caller
 * should use posterBlob as fallback).
 */
export async function generateStatusPreview(videoSource) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";

  const srcUrl = URL.createObjectURL(videoSource);
  video.src = srcUrl;

  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error("Could not decode video for preview"));
    setTimeout(() => reject(new Error("Timeout loading video metadata")), 10000);
  });

  const naturalW = video.videoWidth || 640;
  const naturalH = video.videoHeight || 360;
  const scale = PREVIEW_WIDTH / naturalW;
  const canvasW = PREVIEW_WIDTH;
  const canvasH = Math.round(naturalH * scale);

  // --- Poster: grab the first visually useful frame ---
  video.currentTime = Math.min(0.5, (video.duration || 1) / 4);
  await waitForSeek(video);
  const posterBlob = captureFrame(video, canvasW, canvasH, "image/jpeg", 0.85);

  // --- Animated preview clip via canvas + MediaRecorder ---
  let previewBlob = null;
  try {
    previewBlob = await renderClip(video, canvasW, canvasH, PREVIEW_DURATION_SEC, PREVIEW_FPS);
  } catch {
    // MediaRecorder not supported or encoding failed — poster-only is fine.
    previewBlob = null;
  }

  URL.revokeObjectURL(srcUrl);
  video.src = "";

  return { previewBlob, posterBlob };
}

// Render a short clip by playing the video into a canvas, capturing frames at
// PREVIEW_FPS, and piping them into a MediaRecorder producing WebM/MP4.
async function renderClip(video, w, h, durationSec, fps) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Seek to start of clip (skip first 0.1s to avoid blank frame).
  video.currentTime = Math.min(0.1, video.duration || 0.1);
  await waitForSeek(video);

  const stream = canvas.captureStream(0); // manual frame pushing
  // Prefer MP4, fall back to WebM.
  const mimeType = MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")
    ? "video/mp4;codecs=avc1"
    : (MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm");

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: PREVIEW_QUALITY_MBPS * 1_000_000,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      resolve(blob);
    };
    recorder.onerror = reject;
  });

  recorder.start();

  // Drive the clip by stepping video.currentTime at the target FPS.
  const frameInterval = 1000 / fps;
  const totalFrames = Math.ceil(durationSec * fps);
  video.playbackRate = 1;

  for (let i = 0; i < totalFrames; i++) {
    const targetTime = Math.min(video.currentTime + 1 / fps, video.duration || durationSec);
    video.currentTime = targetTime;
    await waitForSeek(video);
    ctx.drawImage(video, 0, 0, w, h);
    // Push the frame into the stream.
    stream.requestFrame();
    // Respect the 150 KB cap: stop early if we're already too large.
    if (chunks.length > 0 && i % 10 === 0) {
      const currentSize = chunks.reduce((s, c) => s + c.size, 0);
      if (currentSize > MAX_PREVIEW_BYTES * 0.8) break;
    }
  }

  recorder.stop();
  const blob = await done;

  // Enforce hard cap: if over 150 KB, return null (caller uses poster).
  if (blob.size > MAX_PREVIEW_BYTES) return null;
  return blob;
}

function captureFrame(video, w, h, type, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  // Synchronous toBlob callback; return via Promise.
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function waitForSeek(video) {
  return new Promise((resolve) => {
    if (video.seeked) { resolve(); return; }
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
    video.addEventListener("seeked", onSeeked);
    // Safety timeout.
    setTimeout(resolve, 3000);
  });
}
