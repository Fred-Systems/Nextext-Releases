// Internal: programmatically click an anchor to start a download.
function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch {} }, 2000);
}

// Trigger a browser/WebView download of a media URL to the device.
// Works for both blob: URLs (already-local audio) and remote https URLs.
// For remote URLs we fetch into a blob first so the `download` attribute is
// honored even on cross-origin resources; if that fails we fall back to opening
// the URL in a new tab.
export async function downloadMedia(url, filename) {
  if (!url) return false;
  try {
    if (url.startsWith("blob:")) {
      triggerDownload(url, filename);
      return true;
    }
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    triggerDownload(objUrl, filename);
    setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch {} }, 2000);
    return true;
  } catch {
    try { window.open(url, "_blank", "noopener"); } catch {}
    return false;
  }
}

// Robust image download. Many image hosts (e.g. Pollinations) send
// Access-Control-Allow-Origin, so we render the image to a canvas with
// crossOrigin and export a PNG — this works even when a plain <a download>
// would be blocked by the browser for cross-origin resources. Falls back to the
// generic blob-fetch downloader if the canvas is tainted or export fails.
export async function downloadImage(url, filename) {
  if (!url) return false;
  if (url.startsWith("blob:")) return downloadMedia(url, filename);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("img load failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("toBlob failed");
    const objUrl = URL.createObjectURL(blob);
    triggerDownload(objUrl, filename || `nextext-image-${Date.now()}.png`);
    setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch {} }, 2500);
    return true;
  } catch {
    return downloadMedia(url, filename);
  }
}
