import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://hkpfojusvnnifvwkjbol.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xWb4cwhKwWkV2fdBnpMfvQ_bacRB1Cy";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export const MEDIA_BUCKET = "chat-media";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB -- Supabase free-tier per-file cap

// Cloudinary configuration
export const CLOUDINARY_CLOUD_NAME = "lsfhbqod";
export const CLOUDINARY_UPLOAD_PRESET = "app_unsigned_preset";
export const CLOUDINARY_BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}`;

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
export const SUPPORTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"];
export const SUPPORTED_AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav"];
export const SUPPORTED_FILE_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "application/zip", "application/x-rar-compressed"];

export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB for videos
export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB for images
export const MAX_AUDIO_SIZE_BYTES = 20 * 1024 * 1024; // 20MB for audio
export const MAX_OTHER_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB for other files

export const VIDEO_COMPRESSION_OPTIONS = {
    maxWidth: 1280,
    maxHeight: 720,
    quality: 0.7,
    mimeType: "video/mp4",
};

export const IMAGE_COMPRESSION_OPTIONS = {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 0.7,
    mimeType: "image/jpeg",
};

export const THUMBNAIL_OPTIONS = {
    maxWidth: 480,
    maxHeight: 480,
    quality: 0.8,
    mimeType: "image/jpeg",
};
