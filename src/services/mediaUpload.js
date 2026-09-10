import { CLOUDINARY_BASE_URL, CLOUDINARY_UPLOAD_PRESET, CLOUDINARY_CLOUD_NAME } from "../supabase/config";
import { compressImage as _compressImage, assertUnderSizeLimit, FileTooLargeError, generateBlurData } from "../media/mediaCompression";

// ─────────────────────────────────────────────────────────────────────────────
// Global media optimization & routing pipeline.
//
// Every media upload in the app (chat media, status updates, group photos,
// avatars) goes through uploadMediaFile(). It:
//   1. Blocks any raw file over the active provider's limit BEFORE compression
//      (100MB on Cloudinary, 50MB on Supabase) — user-facing alert via
//      RawFileTooLargeError. Videos are allowed up to the provider limit (no
//      aggressive pre-compression gate).
//   2. Compresses images to ~70% JPEG quality, capped at 1920px.
//   3. Extracts a static .jpg thumbnail from the FIRST FRAME of any video.
//   4. Uploads to Cloudinary ONLY — the single storage backend for all
//      NexText-owned media (unsigned upload via cloud name 'lsfhbqod',
//      preset 'app_unsigned_preset'). Supabase Storage / Firebase Storage are
//      NOT used for NexText-owned media bytes.
//   5. Returns { url, thumbnailURL, path, sizeBytes, ... } to save into the
//      messages / statuses tables.
// ─────────────────────────────────────────────────────────────────────────────

// Raw pre-compression gate. The cap depends on the ACTIVE storage provider:
//   - cloudinary : 100MB (Cloudinary free-tier per-file limit)
//   - supabase   : 50MB  (Supabase free-tier per-file limit)
// Read live from system_settings so flipping the provider in admin instantly
// changes the enforced limit (no app update needed). The same values are also
// applied consistently to chat media, status media, voice notes, and generated
// app-owned media uploads (all route through assertRawUnderLimit / here).
const RAW_CLOUDINARY_LIMIT = 100 * 1024 * 1024;
const RAW_SUPABASE_LIMIT = 50 * 1024 * 1024;
// Belt-and-braces ceiling: never block higher than the largest provider allows.
export const RAW_UPLOAD_LIMIT = RAW_CLOUDINARY_LIMIT;

const MAX_IMAGE_DIMENSION = 1200;
const IMAGE_QUALITY = 0.7;
const THUMB_WIDTH = 480;

// Resolve the raw upload byte limit for the currently active provider.
export async function getRawUploadLimitBytes() {
  let provider = cachedProvider;
  if (!provider) provider = await getActiveStorageProvider();
  return provider === "cloudinary" ? RAW_CLOUDINARY_LIMIT : RAW_SUPABASE_LIMIT;
}

// NexText-owned media is stored in Cloudinary ONLY. Supabase Storage / Firebase
// Storage MUST NOT contain any NexText-owned media bytes (status photos/videos,
// chat photos/videos, voice notes, generated images, builder output, etc.).
// Supabase is still used for NON-MEDIA data (system settings, analytics,
// engagement metadata). The active-provider toggle therefore no longer routes
// media; this always resolves to "cloudinary" so uploads can never silently fall
// back into a Supabase bucket.
let cachedProvider = "cloudinary";
export function getActiveStorageProvider() {
  return Promise.resolve("cloudinary");
}

export function setActiveStorageProviderCache(provider) {
  cachedProvider = provider === "cloudinary" ? "cloudinary" : "supabase";
}

// Invalidate the cached provider so the next upload re-reads the DB.
export function invalidateStorageProviderCache() {
  cachedProvider = null;
  providerCheckPromise = null;
}

// ── Client-side compression & guards ─────────────────────────────────────────
export class RawFileTooLargeError extends Error {
  constructor(sizeBytes, limitBytes) {
    const mb = Math.round(limitBytes / (1024 * 1024));
    super(`This file is over ${mb}MB before compression and can't be uploaded. Please pick a smaller file.`);
    this.name = "RawFileTooLargeError";
    this.sizeBytes = sizeBytes;
  }
}

// Strict guard: a raw file over the ACTIVE provider's limit is blocked
// immediately, before any compression/upload step. The limit is provider-aware
// (100MB on Cloudinary, 50MB on Supabase). Callers should catch
// RawFileTooLargeError (its message already states the real MB limit) and alert.
export async function assertRawUnderLimit(file) {
  const limit = await getRawUploadLimitBytes();
  if (file.size > limit) {
    throw new RawFileTooLargeError(file.size, limit);
  }
}

// Centralized, user-friendly mapping for media/status upload failures. Returns a
// plain-language message and NEVER echoes raw provider/Firebase error objects. We
// also avoid falsely labeling every failure as a "quota/limit" error — network,
// auth, and provider-rejection errors are reported as such, and only genuine
// size/limit conditions say "limit"/"too large".
export function describeUploadError(err, fallbackPrefix = "Upload failed") {
  if (!err) return `${fallbackPrefix}. Please try again.`;
  if (err instanceof RawFileTooLargeError || err instanceof FileTooLargeError) return err.message;
  const message = String(err?.message || err?.code || err || "");
  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network error") || lower.includes("couldn't reach") || lower.includes("offline")) {
    return "We couldn't reach the server. Check your internet connection and try again.";
  }
  if (lower.includes("cloudinary network error")) {
    return "We couldn't reach the media server (Cloudinary). Check your connection and try again.";
  }
  if (lower.includes("cloudinary rejected")) {
    if (lower.includes("too large") || lower.includes("file size") || lower.includes("exceed")) {
      return "That file is too large for the media service to accept. Try a smaller file.";
    }
    if (lower.includes("format") || lower.includes("type") || lower.includes("invalid")) {
      return "The media service rejected this file (unsupported format or type). Try a different file.";
    }
    return "The media service rejected the upload. Please try again.";
  }
  if (lower.includes("payload too large") || lower.includes("too large") || lower.includes("entity too large")) {
    return "That file is too large to upload. Try a smaller file.";
  }
  if (lower.includes("storage") || lower.includes("bucket") || lower.includes("row level") || lower.includes("unauthorized") || lower.includes("permission")) {
    return "The media service blocked this upload (permission or storage error). Please try again.";
  }
  if (lower.includes("quota") || lower.includes("limit reached") || lower.includes("resource-exhausted") || lower.includes("rate limit")) {
    return "You've hit a temporary limit. Please wait a moment and try again.";
  }
  if (lower.includes("cancel") || lower.includes("aborted")) {
    return "Upload was cancelled.";
  }
  return `${fallbackPrefix}. Please try again.`;
}

// Compress an image to JPEG ~70% quality, capped at 1920px longest side.
// Uses an offscreen canvas so it works on old WebViews too.
export async function compressImage(file) {
  if (!file.type.startsWith("image/")) return { file, wasCompressed: false, thumbDataUrl: null };
  // GIFs: keep as-is (animation would be lost by compression).
  if (file.type === "image/gif") return { file, wasCompressed: false, thumbDataUrl: null };
  try {
    let bitmap;
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
    } else {
      const url = URL.createObjectURL(file);
      try {
        bitmap = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      } finally { URL.revokeObjectURL(url); }
    }
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();

    // Produce the compressed file + a small thumbnail dataURL in one pass.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY));
    const thumb = await new Promise((resolve) => {
      const tc = document.createElement("canvas");
      const s = Math.min(1, THUMB_WIDTH / canvas.width);
      tc.width = Math.max(1, Math.round(canvas.width * s));
      tc.height = Math.max(1, Math.round(canvas.height * s));
      tc.getContext("2d").drawImage(canvas, 0, 0, tc.width, tc.height);
      tc.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.8);
    });

    const compressedFile = new File([blob], (file.name || "image").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    return { file: compressedFile, wasCompressed: true, thumbDataUrl: thumb };
  } catch {
    // Fall back to original file if canvas decoding fails (very old WebView).
    return { file, wasCompressed: false, thumbDataUrl: null };
  }
}

// Extract a static .jpg thumbnail from the first frame of a video, client-side.
// Returns a Blob (or null if the browser can't decode the video).
export function extractVideoThumbnail(videoFile) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    let done = false;
    const finish = (blob) => { if (!done) { done = true; URL.revokeObjectURL(url); resolve(blob); } };
    video.onloadeddata = () => { try { video.currentTime = Math.min(0.1, (video.duration || 0.5) / 2); } catch {} };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, THUMB_WIDTH / Math.max(video.videoWidth, 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b), "image/jpeg", 0.8);
      } catch { finish(null); }
    };
    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 12000); // hard timeout
    video.src = url;
  });
}

// ── Provider uploader ─────────────────────────────────────────────────────────
// NexText-owned media is uploaded to Cloudinary ONLY. (The legacy Supabase
// uploader was removed: Supabase Storage must not hold NexText media.)

export async function uploadToCloudinary(file, { resourceType = "auto", preset } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  // Use the per-type preset when supplied (chat_image / chat_video), otherwise
  // fall back to the generic unsigned preset.
  const resolvedPreset = preset || CLOUDINARY_UPLOAD_PRESET;
  formData.append("upload_preset", resolvedPreset);
  // resource_type must be "image", "video", "raw", or "auto" — NOT arbitrary strings.
  const safeResourceType = ["image", "video", "raw", "auto"].includes(resourceType) ? resourceType : "auto";
  formData.append("resource_type", safeResourceType);

  const endpoint = `${CLOUDINARY_BASE_URL}/${safeResourceType}/upload`;

  let res;
  try {
    res = await fetch(endpoint, { method: "POST", body: formData });
  } catch (fetchErr) {
    throw new Error(`Cloudinary network error: ${fetchErr.message || "fetch failed"}. Check your internet connection and Cloudinary configuration.`);
  }

  const json = await res.json().catch(() => null);

  if (!json || json.error) {
    const errMsg = json?.error?.message || json?.error?.reason || `HTTP ${res.status}`;
    console.error("[Cloudinary] Upload rejected:", errMsg, json);
    throw new Error(`Cloudinary rejected the upload: ${errMsg}`);
  }
  if (!json.secure_url) {
    console.error("[Cloudinary] Response missing secure_url:", json);
    throw new Error("Cloudinary upload succeeded but returned no URL. Check your upload preset.");
  }
  if (json.folder && json.folder.includes("upload_error")) {
    throw new Error("Cloudinary returned an upload_error folder. Check your preset configuration.");
  }

  return { url: json.secure_url, path: json.public_id, thumbnailURL: null, thumbnailPath: null, provider: "cloudinary" };
}

// ── Upload backend resolver (explicit allowlist) ────────────────────────────────
// NexText-owned MEDIA always goes to Cloudinary. Supabase Storage is ONLY permitted
// for an explicit allowlist of non-media file types that Cloudinary cannot/should
// not handle (e.g. application packages). There is NO "Cloudinary failed → Supabase"
// fallback: such a fallback would recreate the old architecture problem. If a file
// is neither known NexText media nor an allowlisted non-media type, resolution
// fails loudly rather than silently routing to Supabase.
//
// Categories:
//   - "cloudinary" : ordinary NexText media (image/video/audio/voice/avatar/etc.)
//   - "supabase"   : explicitly allowlisted non-media file (e.g. .apk, .zip)
//   - throws       : unsupported / unknown file
const SUPABASE_ALLOWLIST_MIME = new Set([
  "application/vnd.android.package-archive", // .apk
  "application/octet-stream", // generic binary (treated as non-media file)
]);
const SUPABASE_ALLOWLIST_EXT = new Set(["apk", "zip", "bin", "exe", "dmg", "tar", "gz", "7z"]);

export function resolveUploadBackend(file) {
  if (!file) throw new Error("resolveUploadBackend: no file");
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";

  // NexText media → Cloudinary (never Supabase).
  if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")) {
    return "cloudinary";
  }
  // Explicit non-media allowlist → Supabase (file attachment semantics, not media).
  if (SUPABASE_ALLOWLIST_MIME.has(type) || (ext && SUPABASE_ALLOWLIST_EXT.has(ext))) {
    return "supabase";
  }
  // Unknown: fail clearly. Do NOT default to Supabase.
  throw new Error(
    `Unsupported file type for upload: ${type || "unknown"}${ext ? " (." + ext + ")" : ""}. NexText media must be image/video/audio; other binary files are restricted.`
  );
}

// ── Cloudinary server-side video segmenting (real trim / split) ────────────────
// Produces an ACTUAL trimmed copy of a video as a brand-new Cloudinary asset.
// This is NOT playback metadata — Cloudinary evaluates the `so_` (start offset,
// seconds) and `eo_` (end offset, seconds) transformation when it fetches the
// source and stores the result as a separate asset with its own URL. The posted
// status therefore references genuinely trimmed bytes.
//
// publicId is the asset id WITHOUT the "cloudinary:" prefix.
export async function createCloudinarySegment(publicId, startSec, endSec) {
  if (!publicId) throw new Error("createCloudinarySegment: missing publicId");
  // Delivery (fetch) URL carrying the trim transformation. Cloudinary trims on the
  // server when it ingests this transformed source.
  const delivery = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_${startSec},eo_${endSec}/${publicId}`;
  const formData = new FormData();
  formData.append("file", delivery);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("resource_type", "video");
  const endpoint = `${CLOUDINARY_BASE_URL}/video/upload`;
  let res;
  try {
    res = await fetch(endpoint, { method: "POST", body: formData });
  } catch (fetchErr) {
    throw new Error(`Cloudinary segment network error: ${fetchErr.message || "fetch failed"}`);
  }
  const json = await res.json().catch(() => null);
  if (!json || json.error || !json.secure_url) {
    const errMsg = json?.error?.message || json?.error?.reason || `HTTP ${res?.status}`;
    throw new Error(`Cloudinary segment failed: ${errMsg}`);
  }
  return { url: json.secure_url, path: `cloudinary:${json.public_id}`, publicId: json.public_id };
}

// Split one original video into N evenly-duration parts, each a real, separate,
// trimmed Cloudinary asset. Returns ordered segments [{ url, path, publicId }].
// Every resulting piece is independently derived from the original by byte range
// (Cloudinary trims server-side), so each piece is its own file. Order is
// preserved (index 0 = first part).
export async function splitCloudinaryVideo(publicId, durationSec, parts) {
  const n = Math.max(1, Math.min(5, Math.floor(parts) || 1));
  const seg = durationSec / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = Math.round(i * seg * 100) / 100;
    const end = i === n - 1 ? Math.round(durationSec * 100) / 100 : Math.round((i + 1) * seg * 100) / 100;
    // eslint-disable-next-line no-await-in-loop
    out.push(await createCloudinarySegment(publicId, start, end));
  }
  return out;
}

// ── Central router ───────────────────────────────────────────────────────────
// options:
//   { thumbnailBlob? }  - pre-supplied video thumbnail (skips extraction)
//   { provider? }       - override the active provider ("supabase" | "cloudinary")
//   { resourceType? }   - cloudinary resource type (default "auto")
//   { skipThumbnail? }  - true to never generate a video thumbnail
export async function uploadMediaFile(chatId, senderUid, file, options = {}) {
  if (!chatId || !senderUid) throw new Error("uploadMediaFile: missing chatId or senderUid");
  // 1. Hard pre-compression gate — provider-aware (100MB Cloudinary / 50MB Supabase).
  await assertRawUnderLimit(file);
  // 2. Also respect the existing 50MB hard cap (belt-and-braces).
  assertUnderSizeLimit(file);

  let uploadFile = file;
  let thumbnailBlob = options.thumbnailBlob || null;

  // 3. Client-side compression + video thumbnail.
  if (file.type.startsWith("image/")) {
    const { file: comp, wasCompressed } = await compressImage(file);
    if (wasCompressed) uploadFile = comp;
  } else if (file.type.startsWith("video/") && !options.skipThumbnail && !thumbnailBlob) {
    thumbnailBlob = await extractVideoThumbnail(file);
  }

  // 4. Route to Cloudinary — the ONLY store for NexText-owned media.
  //    Direct UNSIGNED client-side upload; we receive the public delivery URL and
  //    only that string is persisted downstream (no Supabase Storage bucket is
  //    used for this pipeline). Posters/previews are derived on the fly via the
  //    Cloudinary Fetch proxy. (The legacy Supabase branch was removed: NexText
  //    media must never live in Supabase Storage.)
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  const isAudio = file.type.startsWith("audio/");
  // Cloudinary routes audio under the "video" resource type (it classifies
  // audio as a video-type delivery), so map audio there instead of "auto".
  const resourceType = isVideo || isAudio ? "video" : isImage ? "image" : "auto";
  const preset = isImage ? "chat_image" : isVideo || isAudio ? "chat_video" : undefined;
  const result = await uploadToCloudinary(uploadFile, { resourceType, preset });

  // 5. Small blur placeholder for images (used by chat media blur previews).
  let blurData = null;
  if (uploadFile.type.startsWith("image/")) {
    blurData = await generateBlurData(uploadFile);
  }

  return {
    ...result,
    // NexText-owned media lives in Cloudinary only. Prefix the path so downstream
    // delete/resolve helpers route correctly. Legacy media (no prefix) is assumed
    // to live in Supabase for backward compatibility.
    path: `cloudinary:${result.path}`,
    sizeBytes: uploadFile.size,
    fileName: file.name,
    blurData,
    wasCompressed: uploadFile !== file,
  };
}

// Convenience wrapper for videos that want thumbnail + media uploaded together.
export async function uploadVideoWithThumbnail(chatId, senderUid, videoFile, options = {}) {
  const thumb = options.thumbnailBlob || (await extractVideoThumbnail(videoFile));
  return uploadMediaFile(chatId, senderUid, videoFile, { ...options, thumbnailBlob: thumb });
}

// ── Single authoritative NexText-owned media upload ─────────────────────────────
// ALL NexText-owned media (status photo/video, edited/cropped status media, chat
// photo/video, voice notes, avatars, group media, generated builder output) must
// flow through this one function. It routes exclusively to Cloudinary — there is
// intentionally NO Supabase Storage fallback. Callers can retry on the returned
// error; they must never re-route media to Supabase.
export const uploadNexTextMedia = uploadMediaFile;

export { FileTooLargeError };
