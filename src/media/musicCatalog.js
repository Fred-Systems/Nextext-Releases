// Music search + preview source for the Status Builder "Background Music" feature.
//
// This project does NOT contain the Zemer music client (that lives in a separate
// Kotlin app). To honor the "reuse a legitimate source / don't invent a
// YouTube extractor / don't store audio files" constraints, we integrate Apple's
// public iTunes Search API — free, key-less, and legally intended for preview
// playback. It returns 30-second AAC preview clips (previewUrl) which we stream
// for status background music. Full-song streaming/permanent download is NOT
// offered by this source, so we only ever store compact track metadata.
//
// Everything downstream stores metadata only:
//   trackId, title, artist, album, artwork, previewUrl, source.
// No audio blob is uploaded to Firebase/Supabase/Cloudinary; when a user is
// permitted to download, we save the (licensed) preview clip locally on-device.

const ITUNES_SEARCH = "https://itunes.apple.com/search";

/**
 * Search songs by query. Returns normalized track objects.
 * @param {string} query
 * @param {{limit?: number}} opts
 * @returns {Promise<Array<{trackId,title,artist,album,artwork,previewUrl,source}>>}
 */
export async function searchMusic(query, { limit = 20 } = {}) {
  const q = (query || "").trim();
  if (!q) return [];
  const url =
    `${ITUNES_SEARCH}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .filter((r) => r.trackId && r.previewUrl)
      .map((r) => ({
        trackId: String(r.trackId),
        title: r.trackName || "Unknown",
        artist: r.artistName || "Unknown",
        album: r.collectionName || "",
        artwork: r.artworkUrl100
          ? r.artworkUrl100.replace(/100x100/, "300x300")
          : null,
        previewUrl: r.previewUrl,
        source: "itunes",
      }));
  } catch {
    return [];
  }
}

// The playback URL for a stored/selected track (used by the status viewer).
export function getTrackPreviewUrl(track) {
  if (!track) return null;
  return track.previewUrl || null;
}

// Fetch the (licensed) preview clip as a blob — used only for the admin-gated
// local "download" action. Full songs are not available from this source.
export async function fetchTrackBlob(track) {
  const url = getTrackPreviewUrl(track);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}
