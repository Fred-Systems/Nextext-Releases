import { Capacitor } from "@capacitor/core";

// Safe limit well below Cloudinary's 100MB hard limit (95MB)
export const SAFE_CLOUDINARY_LIMIT = 95 * 1024 * 1024;

// Verify each blob is under limit before upload
export function verifyPartsSize(parts, limit = SAFE_CLOUDINARY_LIMIT) {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].size > limit) {
      const err = new Error(`Part ${i + 1} is ${(parts[i].size / (1024 * 1024)).toFixed(1)} MB — exceeds ${Math.round(limit / (1024 * 1024))} MB limit. Try a shorter video or fewer parts.`);
      err.code = "PART_TOO_LARGE";
      throw err;
    }
  }
}

// Pre-upload gate: returns null if file is safe to upload directly, or throws if > limit but cannot be split
export function checkFileSizeBeforeUpload(file, limit = SAFE_CLOUDINARY_LIMIT) {
  if (!file) return null;
  if (file.size <= limit) return null;
  // File exceeds safe limit — must be split BEFORE any upload
  return { needsSplit: true, estimatedParts: Math.ceil(file.size / limit) };
}

// Attempt local split before upload. Returns array of File objects (valid playable segments) or throws.
// On Android with native plugin, uses MediaExtractor/MediaMuxer. On web, currently shows clear error (BLOCKED).
export async function splitVideoBeforeUpload(file, onProgress) {
  const check = checkFileSizeBeforeUpload(file);
  if (!check?.needsSplit) return [file]; // already safe

  const maxBytes = SAFE_CLOUDINARY_LIMIT;

  // Try native Android splitting if available
  if (Capacitor.isNativePlatform()) {
    try {
      const { NextextNative } = window.Capacitor?.Plugins || {};
      if (NextextNative && NextextNative.splitVideo) {
        onProgress?.("Preparing video…");
        // For native, we need to get a file path. The File is in JS memory; we write it to cache via base64
        // For large files, this is heavy but necessary until we have a direct native file picker path.
        // As a fallback, we try the native method with a temporary file.
        const arrayBuf = await file.arrayBuffer();
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.readAsDataURL(new Blob([arrayBuf]));
        });
        const res = await NextextNative.splitVideo({ base64, fileName: file.name, mimeType: file.type, maxBytes, fileSize: file.size });
        if (res?.parts && Array.isArray(res.parts)) {
          const files = res.parts.map((p, i) => {
            const blob = base64ToBlob(p.base64, file.type);
            verifyPartsSize([blob], maxBytes);
            return new File([blob], `part-${i + 1}-${file.name}`, { type: file.type });
          });
          verifyPartsSize(files, maxBytes);
          return files;
        }
      }
    } catch (e) {
      console.warn("[videoSplitter] native split failed:", e);
      // Fall through to error
    }
  }

  // Web: no reliable client-side transcoding without ffmpeg.wasm or native.
  // We must not upload the original, so we throw a clear error and mark as BLOCKED.
  const err = new Error(
    `This video is ${(file.size / (1024 * 1024)).toFixed(1)} MB — too large for direct upload. ` +
    `On Android, the app will split it automatically (native). On web, large video splitting requires additional transcoding support (ffmpeg.wasm) which is not yet bundled. ` +
    `Please use the Android app or choose a smaller video. The original file was not uploaded.`
  );
  err.code = "NEEDS_NATIVE_SPLIT";
  err.needsNative = true;
  throw err;
}

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "video/mp4" });
}
