import { supabase, MEDIA_BUCKET, CLOUDINARY_BASE_URL, CLOUDINARY_UPLOAD_PRESET } from "../supabase/config";
import { compressImage as _compressImage, assertUnderSizeLimit, FileTooLargeError, generateBlurData } from "../media/mediaCompression";

// ─────────────────────────────────────────────────────────────────────────────
// Global media optimization & routing pipeline.
//
// Every media upload in the app (chat media, status updates, group photos,
// avatars) goes through uploadMediaFile(). It:
//   1. Blocks any raw file over 50MB BEFORE compression (user-facing alert).
//      Videos are allowed up to 50MB (no aggressive pre-compression gate).
//   2. Compresses images to ~70% JPEG quality, capped at 1920px.
//   3. Extracts a static .jpg thumbnail from the FIRST FRAME of any video.
//   4. Routes to the active storage provider (supabase | cloudinary) read from
//      the Supabase `system_settings` table (active_storage_provider).
//      - cloudinary : ONLY used for image/video media (unsigned upload via
//                     cloud name 'lsfhbqod', preset 'app_unsigned_preset').
//                     Non-media files (documents, audio, etc.) are never sent
//                     to Cloudinary — they always go to Supabase regardless of
//                     the active provider, because the unsigned preset can't
//                     handle them and they shouldn't live on a CDN.
//      - supabase   : uploads to chat-media bucket with cacheControl: 31536000
//   5. Returns { url, thumbnailURL, path, sizeBytes, ... } to save into the
//      messages / statuses tables.
// ─────────────────────────────────────────────────────────────────────────────

// Raw pre-compression gate. Videos and images may be up to 50MB (videos are
// NOT re-encoded client-side, so the 50MB raw limit is the real upload cap).
// Other file types also get 50MB but are never routed to Cloudinary.
const RAW_IMAGE_LIMIT = 50 * 1024 * 1024;
const RAW_VIDEO_LIMIT = 50 * 1024 * 1024;
const RAW_OTHER_LIMIT = 50 * 1024 * 1024;

const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_QUALITY = 0.7;
const THUMB_WIDTH = 480;

export const RAW_UPLOAD_LIMIT = RAW_VIDEO_LIMIT;

// Read the active storage provider with 3-tier fallback:
// 1. localStorage cache (instant, set by the admin toggle)
// 2. Firestore globalSettings (primary source, same doc the admin panel reads)
// 3. Supabase system_settings (legacy fallback)
let cachedProvider = null;
let providerCheckPromise = null;
export function getActiveStorageProvider() {
  if (cachedProvider) return Promise.resolve(cachedProvider);
  if (providerCheckPromise) return providerCheckPromise;
  providerCheckPromise = (async () => {
    // Tier 1: localStorage cache (set by the admin toggle)
    try {
      const lsVal = localStorage.getItem("nextext_active_storage_provider");
      if (lsVal === "cloudinary" || lsVal === "supabase") {
        cachedProvider = lsVal;
        return cachedProvider;
      }
    } catch {}

    // Tier 2: Firestore globalSettings
    try {
      const { getSnapshot } = await import("../firebase/config-settings.js");
      const gs = getSnapshot?.();
      if (gs?.active_storage_provider) {
        cachedProvider = gs.active_storage_provider;
        try { localStorage.setItem("nextext_active_storage_provider", cachedProvider); } catch {}
        return cachedProvider;
      }
    } catch {}

    // Tier 3: Supabase system_settings
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "active_storage_provider")
        .maybeSingle();
      if (error) throw error;
      cachedProvider = data?.value === "cloudinary" ? "cloudinary" : "supabase";
      try { localStorage.setItem("nextext_active_storage_provider", cachedProvider); } catch {}
    } catch {
      cachedProvider = "supabase";
    }
    return cachedProvider;
  })().finally(() => { providerCheckPromise = null; });
  return providerCheckPromise;
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

// Strict guard: a raw file over the type-specific limit is blocked immediately,
// before any compression step. Callers should catch RawFileTooLargeError and alert.
// Videos and images are allowed up to 50MB; other files up to 50MB as well.
export function assertRawUnderLimit(file) {
  let limit = RAW_OTHER_LIMIT;
  if (file.type.startsWith("video/")) limit = RAW_VIDEO_LIMIT;
  else if (file.type.startsWith("image/")) limit = RAW_IMAGE_LIMIT;
  if (file.size > limit) {
    throw new RawFileTooLargeError(file.size, limit);
  }
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

// ── Provider uploaders ───────────────────────────────────────────────────────

async function uploadToSupabase(chatId, senderUid, file, { thumbnailBlob = null } = {}) {
  const safeSegment = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const base = `${safeSegment(chatId)}/${safeSegment(senderUid)}/${Date.now()}`;
  const mediaPath = `${base}-${safeName}`;

  const { error: mediaErr } = await supabase.storage.from(MEDIA_BUCKET).upload(mediaPath, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (mediaErr) throw mediaErr;

  let thumbnailPath = null;
  let thumbnailURL = null;
  if (thumbnailBlob) {
    thumbnailPath = `${base}-thumb.jpg`;
    const { error: thumbErr } = await supabase.storage.from(MEDIA_BUCKET).upload(thumbnailPath, thumbnailBlob, {
      cacheControl: "31536000",
      upsert: false,
      contentType: "image/jpeg",
    });
    if (!thumbErr) {
      const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(thumbnailPath);
      thumbnailURL = data.publicUrl;
    }
  }

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(mediaPath);
  return { url: data.publicUrl, path: mediaPath, thumbnailURL, thumbnailPath, provider: "supabase" };
}

async function uploadToCloudinary(file, { resourceType = "auto" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
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

// ── Central router ───────────────────────────────────────────────────────────
// options:
//   { thumbnailBlob? }  - pre-supplied video thumbnail (skips extraction)
//   { provider? }       - override the active provider ("supabase" | "cloudinary")
//   { resourceType? }   - cloudinary resource type (default "auto")
//   { skipThumbnail? }  - true to never generate a video thumbnail
export async function uploadMediaFile(chatId, senderUid, file, options = {}) {
  if (!chatId || !senderUid) throw new Error("uploadMediaFile: missing chatId or senderUid");
  // 1. Hard 15MB pre-compression gate.
  assertRawUnderLimit(file);
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

  // 4. Route by active provider. Cloudinary is ONLY used for image/video media.
  //    Documents, audio, and any other non-media file always go to Supabase
  //    (the unsigned preset can't handle them and they shouldn't be CDN-served).
  const provider = options.provider || (await getActiveStorageProvider());
  const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");
  let result;
  if (provider === "cloudinary" && isMedia) {
    result = await uploadToCloudinary(uploadFile, { resourceType: options.resourceType || "auto" });
  } else {
    result = await uploadToSupabase(chatId, senderUid, uploadFile, { thumbnailBlob });
  }

  // 5. Small blur placeholder for images (used by chat media blur previews).
  let blurData = null;
  if (uploadFile.type.startsWith("image/")) {
    blurData = await generateBlurData(uploadFile);
  }

  return {
    ...result,
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

export { FileTooLargeError };
