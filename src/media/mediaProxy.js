import { CLOUDINARY_CLOUD_NAME } from "../supabase/config";

// ─────────────────────────────────────────────────────────────────────────────
// Cloudinary Fetch API media proxy.
//
// Media is always stored in Supabase (never permanently in Cloudinary). When the
// "Cloudinary Media Optimization Proxy" feature flag is ON, display URLs are
// rewritten on the fly through Cloudinary's fetch endpoint so images/videos are
// optimized (f_auto, q_auto) and served from Cloudinary's CDN without us ever
// saving the asset there. When OFF, the raw Supabase URL is used.
// ─────────────────────────────────────────────────────────────────────────────

let proxyEnabled = false;

// Set from the global settings doc (App.jsx subscribes and calls this).
export function setCloudinaryProxyEnabled(value) {
  proxyEnabled = !!value;
}

export function isCloudinaryProxyEnabled() {
  return proxyEnabled;
}

// Rewrite a media URL through Cloudinary's fetch API when the proxy is enabled.
// type: "image" | "video" | anything else (treated as image).
export function getProxyMediaUrl(url, type = "image") {
  if (!url || typeof url !== "string") return url;
  if (!proxyEnabled) return url;
  // Already a Cloudinary URL — don't double-proxy.
  if (url.includes("res.cloudinary.com") || url.includes("/image/fetch/") || url.includes("/video/fetch/")) {
    return url;
  }
  const resource = type === "video" ? "video" : "image";
  const base = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${resource}/fetch/f_auto,q_auto/`;
  // Encode the whole source URL so query strings / special chars survive.
  return base + encodeURIComponent(url);
}

// Derive a Cloudinary first-frame JPEG poster from an ALREADY-Cloudinary video
// URL (e.g. https://res.cloudinary.com/<cloud>/video/upload/v123/abc.mp4 ->
// .../video/upload/so_0,f_jpg,w_480/v123/abc.jpg).
function cloudinaryVideoPoster(url) {
  return url.replace(/(\/video\/upload\/)(.*?\/)?([^/]+)\.(mp4|webm|ogg|mov|mkv|avi)$/i, "$1so_0,f_jpg,w_480/$2$3.jpg");
}

// Generate a still-frame poster for a video through Cloudinary. Works for both
// Cloudinary-hosted videos (transform injection) and external URLs (fetch proxy),
// so chat + status video previews never render blank.
export function getVideoPosterUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.includes("res.cloudinary.com")) return cloudinaryVideoPoster(url);
  const base = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/so_0,f_jpg,w_480,q_auto/`;
  return base + encodeURIComponent(url);
}
