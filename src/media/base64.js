// Decode a base64 data string (from the native voice recorder) into a Blob.
// The native Android recorder returns audio as base64 (no accessible file URL),
// so every consumer (voice notes, status voice, speech-to-text) must decode it
// this way rather than fetch()'ing a path.
export function base64ToBlob(b64, mimeType) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "audio/mp4" });
}
