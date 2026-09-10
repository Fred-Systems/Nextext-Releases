import { supabase, MEDIA_BUCKET } from "./config";
import { uploadMediaFile } from "../services/mediaUpload";

// Unified media abstraction.
//
// App-owned media is stored in Cloudinary ONLY. This module is a thin facade over
// src/services/mediaUpload.js (Cloudinary-only) so the call sites
// (GlobalCamera, CameraCapture, StatusScreen, AIChatScreen, App, ContactProfile,
// NewGroup, etc.) keep working unchanged. There is NO Supabase Storage media
// fallback — a Cloudinary failure surfaces a real error rather than silently
// writing app-owned bytes into a Supabase bucket.
//
// Return shape is intentionally compatible with the old contract so callers that
// read `result.url` / `result.path` keep working:
//   { url, path, sizeBytes, fileName, blurData }
// `path` is prefixed with "cloudinary:" so delete/resolution helpers route
// correctly. Third-party provider media (Jewish/YidStatus) is NEVER routed
// through here — those keep their own provider URLs.

export async function uploadChatFile(chatId, senderUid, file, { compress = false } = {}) {
  if (!chatId || !senderUid) throw new Error("uploadChatFile: missing chatId or senderUid");
  // NexText-owned media is stored in Cloudinary ONLY. There is intentionally NO
  // Supabase Storage fallback — if the Cloudinary upload fails we surface the real
  // error rather than silently writing app-owned media into a Supabase bucket.
  return uploadMediaFile(chatId, senderUid, file, { compress });
}

// Legacy Supabase-only upload — REMOVED. NexText-owned media is Cloudinary-only;
// there is intentionally no Supabase Storage media fallback. Kept out of the code
// path so a Cloudinary failure can never silently write app-owned bytes into a
// Supabase bucket. (Legacy `supabase:` media already stored historically is still
// read/cleaned up via getSignedUrl/deleteChatFile below for backward compat only.)

export async function deleteChatFile(spec) {
  // `spec` may be a plain path (legacy Supabase) or "<provider>:<id>".
  let provider = "supabase";
  let path = spec;
  if (typeof spec === "object" && spec) {
    provider = spec.provider || "supabase";
    path = spec.path;
  } else if (typeof spec === "string" && spec.includes(":")) {
    const idx = spec.indexOf(":");
    provider = spec.slice(0, idx);
    path = spec.slice(idx + 1);
  }
  if (provider === "cloudinary") {
    // Cloudinary unsigned (client-side) uploads cannot be deleted without the
    // account API secret, which is never shipped to the client. The Firestore
    // document is still removed by the caller; the orphaned asset is eventually
    // cleaned up server-side. We intentionally do NOT throw here.
    console.debug("[deleteChatFile] Cloudinary asset deletion requires server-side API; skipping client delete for", path);
    return;
  }
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  if (error) throw error;
}

// Resolve a media path to a downloadable URL.
//  - Already a full http(s) URL (Cloudinary delivery URL stored directly) -> return as-is.
//  - "cloudinary:<public_id>" -> cannot reconstruct a signed URL client-side;
//    callers should have stored the full URL instead, so return null.
//  - "supabase:<path>" or legacy bare path -> mint a short-lived signed URL.
export async function getSignedUrl(path, expiresAt) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  let provider = "supabase";
  let raw = path;
  if (path.includes(":")) {
    const idx = path.indexOf(":");
    provider = path.slice(0, idx);
    raw = path.slice(idx + 1);
  }
  if (provider === "cloudinary") return null;
  const now = Date.now();
  const expMs = expiresAt?.toMillis?.() ? expiresAt.toMillis() : (expiresAt ? new Date(expiresAt).getTime() : now + 3600 * 1000);
  const ttl = Math.max(60, Math.min(3600, Math.floor((expMs - now) / 1000)));
  if (ttl <= 0) return null;
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(raw, ttl);
  if (error) return null;
  return data.signedUrl;
}
