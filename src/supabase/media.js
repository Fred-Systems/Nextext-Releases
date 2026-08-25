import { supabase, MEDIA_BUCKET, MAX_UPLOAD_BYTES } from "./config";
import { compressImage, assertUnderSizeLimit, FileTooLargeError, generateBlurData } from "../media/mediaCompression";

// Uploads a file into a chat's folder in the shared bucket. Path structure
// is {chatId}/{uploaderUid}/{timestamp}-{filename} -- the uploaderUid
// segment is what lets the Supabase RLS delete policy verify "only the
// person who uploaded this can delete it" (see SUPABASE_SETUP.md).
export async function uploadChatFile(chatId, senderUid, file, { compress = false } = {}) {
  if (!chatId || !senderUid) throw new Error("uploadChatFile: missing chatId or senderUid");
  assertUnderSizeLimit(file); // throws FileTooLargeError if over 50MB, caught by caller for the toast

  let toUpload = file;
  if (compress && file.type.startsWith("image/")) {
    toUpload = await compressImage(file);
  }

  // Keep each path segment clean so the bucket folder is unambiguous:
  //   chat-media/{chatId}/{senderUid}/{timestamp}-{name}
  // (For 1:1 chats chatId is already "uidA_uidB" by design — that's the
  // conversation id, not a duplicated uid. The senderUid subfolder is what the
  // Supabase RLS delete policy keys on.)
  const safeSegment = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${safeSegment(chatId)}/${safeSegment(senderUid)}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, toUpload, {
    cacheControl: "3600",
    upsert: false,
    contentType: toUpload.type || "application/octet-stream",
  });
  if (uploadError) throw uploadError;

  let blurData = null;
  if (toUpload.type.startsWith("image/")) {
    blurData = await generateBlurData(toUpload);
  }

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, sizeBytes: toUpload.size, fileName: file.name, blurData };
}

export async function deleteChatFile(path) {
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  if (error) throw error;
}

export { FileTooLargeError, MAX_UPLOAD_BYTES };
