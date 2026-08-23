import imageCompression from "browser-image-compression";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB hard limit -- matches Supabase's free-tier per-file cap

export class FileTooLargeError extends Error {
  constructor(sizeBytes) {
    super("Files must be under 50MB.");
    this.name = "FileTooLargeError";
    this.sizeBytes = sizeBytes;
  }
}

// Call this before ANY upload (image, video, voice note, file) — throws
// FileTooLargeError if over the hard cap, so callers can catch it and show
// a friendly toast. This is the frontend half of the limit; the Storage
// security rules enforce the same 100MB cap server-side as the real,
// unbypassable backstop (see storage.rules).
export function assertUnderSizeLimit(file) {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(file.size);
  }
}

// Compresses an image to a max of 1080p on its longest side, JPEG, ~80%
// quality — runs entirely in the browser (Web Worker under the hood via
// browser-image-compression), no server round-trip needed.
export async function compressImage(file) {
  assertUnderSizeLimit(file);
  const options = {
    maxWidthOrHeight: 1080,
    initialQuality: 0.8,
    fileType: "image/jpeg",
    useWebWorker: true,
  };
  return imageCompression(file, options);
}

// Video handling: real client-side transcoding (resizing to 720p, hitting a
// target bitrate) requires a heavy library like ffmpeg.wasm, which is large
// (25MB+) and slow in-browser. For the web build, this function currently
// enforces the size limit and quality-mode selection WITHOUT re-encoding —
// videos upload at their original resolution/bitrate as long as they're
// under 100MB. Once this is packaged as a native Android app (Capacitor),
// swap this for a native video-compression plugin, which is fast and
// reliable at the OS level — the call site (below) is already structured
// so that swap doesn't require touching any UI code.
export async function processVideo(file, quality = "standard") {
  assertUnderSizeLimit(file);
  return {
    file,
    note:
      quality === "standard"
        ? "Uploaded at original quality (browser video compression not yet active — will be added in the native Android build)."
        : "HD upload — original file, size-limited to 100MB.",
  };
}

// Generates a tiny 16x16 JPEG data URL from an image file. Used as a
// lightweight color-blur placeholder so recipients see a blurred preview
// before the (auto-deleting) full media is downloaded. Returns null for
// non-images or if the browser can't decode the file.
export async function generateBlurData(file, size = 16) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
    return null;
  }
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
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, size, size);
    if (bitmap.close) bitmap.close();

    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

// Single entry point used by the attach-media UI — picks the right handler
// by file type and returns a consistent shape: { file, wasCompressed, note }
export async function prepareMediaForUpload(file, { hdVideo = false } = {}) {
  assertUnderSizeLimit(file);

  if (file.type.startsWith("image/")) {
    const compressed = await compressImage(file);
    return { file: compressed, wasCompressed: true, note: null };
  }

  if (file.type.startsWith("video/")) {
    const result = await processVideo(file, hdVideo ? "hd" : "standard");
    return { file: result.file, wasCompressed: false, note: result.note };
  }

  // Voice notes, PDFs, docs, APKs, etc. — no compression, just the size gate.
  return { file, wasCompressed: false, note: null };
}
