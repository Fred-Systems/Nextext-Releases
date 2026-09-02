// Trigger a browser/WebView download of a media URL to the device.
// Works for both blob: URLs (already-local audio) and remote https URLs.
// For remote URLs we fetch into a blob first so the `download` attribute is
// honored even on cross-origin resources; if that fails we fall back to opening
// the URL in a new tab.
export async function downloadMedia(url, filename) {
  if (!url) return false;
  try {
    if (url.startsWith("blob:")) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { document.body.removeChild(a); } catch {} }, 1500);
      return true;
    }
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(objUrl); } catch {} }, 2000);
    return true;
  } catch {
    try { window.open(url, "_blank", "noopener"); } catch {}
    return false;
  }
}
