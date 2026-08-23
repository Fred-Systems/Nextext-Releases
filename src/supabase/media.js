import { supabase, MEDIA_BUCKET, MAX_UPLOAD_BYTES } from "./config";
import { compressImage, assertUnderSizeLimit, FileTooLargeError, generateBlurData } from "../media/mediaCompression";

// Uploads a file into a chat's folder in the shared bucket. Path structure
// is {chatId}/{uploaderUid}/{timestamp}-{filename} -- the uploaderUid
// segment is what lets the Supabase RLS delete policy verify "only the
// person who uploaded this can delete it" (see SUPABASE_SETUP.md).
export async function uploadChatFile(chatId, senderUid, file, { compress = false } = {}) {
  assertUnderSizeLimit(file); // throws FileTooLargeError if over 50MB, caught by caller for the toast

  let toUpload = file;
  if (compress && file.type.startsWith("image/")) {
    toUpload = await compressImage(file);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${chatId}/${senderUid}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, toUpload, {
    cacheControl: "3600",
    upsert: false,
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
