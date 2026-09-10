// Local-device-only media download. Nothing is uploaded anywhere and nothing is
// proxied through our servers — bytes go provider → device.
//
// - Native app (Capacitor): fetch → write via Filesystem to Documents/NexText,
//   VERIFY with stat (only then report success), then open the system share
//   sheet so the user can place the file in Gallery/Photos/Files with one tap.
//   (Android WebViews ignore blob-URL `<a download>` clicks, which is why the
//   old approach "succeeded" without any file appearing.)
// - Web browser: fetch → blob-URL anchor download (works in real browsers).
//
// Resolves { ok, location }. Throws with a human message on failure — callers
// must NOT claim success when this throws. Handles expired URLs (HTTP error),
// empty bodies, CORS failures, and write/verify failures.
function isNativeApp() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) return true;
    return !!window.Capacitor?.Plugins?.Filesystem;
  } catch { return false; }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(String(r.result).split(",")[1]); }
      catch (e) { reject(e); }
    };
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

function extFromMimeType(mime) {
  const m = String(mime || "").toLowerCase();
  if (!m) return "";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("x-m4a")) return "m4a";
  if (m.includes("wav") || m.includes("wave")) return "wav";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("aac")) return "aac";
  return "";
}

async function saveBlobToDevice(blob, filename) {
  if (!blob || !blob.size) throw new Error("The file came back empty.");
  const name = filename || `nextext-${Date.now()}`;

  if (isNativeApp()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const b64 = await blobToBase64(blob);
    const path = `NexText/${name}`;
    await Filesystem.writeFile({ path, data: b64, directory: Directory.Documents, recursive: true });
    const stat = await Filesystem.stat({ path, directory: Directory.Documents }).catch(() => null);
    if (!stat || !stat.size) throw new Error("Couldn't save the file on this device.");
    let uri = null;
    try {
      const u = await Filesystem.getUri({ path, directory: Directory.Documents });
      uri = u?.uri || null;
    } catch { /* share without uri */ }
    if (uri) {
      try { await Share.share({ files: [uri], dialogTitle: "Save to device" }); }
      catch { /* dismissed — the file is still saved below */ }
    }
    return { ok: true, location: `Files › Documents › NexText › ${name}` };
  }

  // Web browser path.
  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); } catch { /* noop */ } }, 1000);
  } finally {
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  }
  return { ok: true, location: "Downloads folder" };
}

export async function downloadMediaToDevice(url, filename, onProgress) {
  if (!url) throw new Error("Media is unavailable.");
  // Indeterminate-first: callers show "Downloading…" until real byte info
  // arrives. We never fabricate a percentage (§19).
  try { onProgress?.({ indeterminate: true }); } catch { /* noop */ }
  let res;
  try {
    res = await fetch(url, { mode: "cors" });
  } catch (e) {
    // CORS/network refusal: the LAST resort is a plain browser download of the
    // original URL (Content-Disposition or browser save) — we do NOT open a
    // viewing tab and call it a download.
    const dl = document.createElement("a");
    dl.href = url;
    dl.download = filename || "";
    dl.rel = "noopener noreferrer";
    dl.style.display = "none";
    document.body.appendChild(dl);
    dl.click();
    setTimeout(() => { try { dl.remove(); } catch { /* noop */ } }, 1000);
    throw new Error(
      "The source blocked an in-app copy (cross-origin restriction). A direct download was triggered instead — check your browser's Downloads. If nothing appeared, the provider is blocking downloads from this device."
    );
  }
  if (!res.ok) throw new Error(`Media is unavailable (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (res.body && res.body.getReader && total > 0) {
    const reader = res.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      try { onProgress?.({ loaded, total }); } catch { /* noop */ }
    }
    const blob = new Blob(parts, { type: res.headers.get("content-type") || "application/octet-stream" });
    if (!blob.size) throw new Error("The file came back empty.");
    return saveBlobToDevice(blob, filename);
  }
  let blob;
  try {
    blob = await res.blob();
  } catch {
    throw new Error("Download was interrupted.");
  }
  if (!blob.size) throw new Error("The file came back empty.");
  try { onProgress?.({ loaded: blob.size, total: blob.size }); } catch { /* noop */ }
  return saveBlobToDevice(blob, filename);
}

// Blob-input variant: saves an already-in-memory Blob (e.g. generated audio)
// through the exact same verified native/web paths as downloadMediaToDevice.
// The extension is derived from the blob's REAL MIME type (blob.type, falling
// back to mimeHint) — never by renaming. Throws on failure like the URL path.
export async function downloadBlobToDevice(blob, filename, mimeHint) {
  if (!blob || !blob.size) throw new Error("There's no audio to save yet.");
  let name = filename || `nextext-${Date.now()}`;
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    const ext = extFromMimeType(blob.type || mimeHint || "");
    if (ext) name = `${name}.${ext}`;
  }
  return saveBlobToDevice(blob, name);
}

export function extFromType(url, kind) {
  const m = String(url || "").match(/\.(mp4|mov|m4a|mp3|aac|ogg|wav|jpg|jpeg|png|webp|gif)(\?|$)/i);
  if (m) return m[1].toLowerCase();
  if (kind === "video") return "mp4";
  if (kind === "audio") return "m4a";
  return "jpg";
}
