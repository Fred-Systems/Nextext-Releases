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

export async function downloadMediaToDevice(url, filename) {
  if (!url) throw new Error("Media is unavailable.");
  let res;
  try {
    res = await fetch(url, { mode: "cors" });
  } catch {
    throw new Error("Couldn't reach the source (offline or expired link).");
  }
  if (!res.ok) throw new Error("Media is unavailable (expired or removed).");
  let blob;
  try {
    blob = await res.blob();
  } catch {
    throw new Error("Download was interrupted.");
  }
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

export function extFromType(url, kind) {
  const m = String(url || "").match(/\.(mp4|mov|m4a|mp3|aac|ogg|wav|jpg|jpeg|png|webp|gif)(\?|$)/i);
  if (m) return m[1].toLowerCase();
  if (kind === "video") return "mp4";
  if (kind === "audio") return "m4a";
  return "jpg";
}
