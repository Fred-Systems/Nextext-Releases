import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Play, Pause, Music, Download, Search } from "lucide-react";
import {
  getActiveProvider,
  resolveSelectableProviders,
  searchMusic,
  getPreviewUrl,
  resolveDownload,
} from "../media/musicService";
import { fetchTrackBlob } from "../media/musicCatalog";

// Shared music picker used by BOTH the original Status Builder and the new
// WhatsApp-style builder. Identical provider architecture, permissions,
// previews, seeking, and segment semantics — one component, no duplication.

// ── Music search modal (Status Builder "Add Music") ───────────────────────────
// Streams 30s preview clips from the iTunes Search API and stores metadata ONLY.
// No audio blob is ever uploaded; downloads (when permitted) save locally.
function fmtSecs(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}
export function MusicPickerModal({ onClose, onSelect, globalSettings, userDoc, t }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState(null);
  const [searchProvider, setSearchProvider] = useState(null);
  const [chosenProvider, setChosenProvider] = useState(getActiveProvider(globalSettings));
  const [previewPos, setPreviewPos] = useState(0);
  const [previewDur, setPreviewDur] = useState(0);
  const [zemerPreviewId, setZemerPreviewId] = useState(null);
  const previewRef = useRef(null);
  const debounceRef = useRef(null);

  // Which providers the user may pick between (admin's active + any other enabled
  // provider when per-user provider choice is enabled).
  const selectableProviders = resolveSelectableProviders(globalSettings, userDoc);

  const runSearch = async (query, providerOverride) => {
    const term = (query || "").trim();
    const provider = providerOverride || chosenProvider;
    if (!term) { setResults([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { provider: usedProvider, tracks } = await searchMusic(term, { globalSettings, userDoc, limit: 20, provider });
      setSearchProvider(usedProvider);
      setResults(tracks || []);
    } catch (e) {
      // Surface the provider-specific error message (disabled / no access / unavailable)
      // rather than silently substituting another source.
      setError(e?.message || "Search failed. Please try again.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const onChange = (e) => {
    const val = e.target.value;
    setQ(val);
    if (previewRef.current) { previewRef.current.pause(); setPlayingId(null); }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(val), 300);
  };

  const playPreview = (track) => {
    const a = previewRef.current;
    if (!a) return;
    // Zemer has no native preview URL; playback is via the YouTube embed below.
    const url = getPreviewUrl(track);
    if (!url && track.source !== "zemer") return;
    if (playingId === track.trackId) {
      // Toggle off. For Apple this pauses the shared <audio> element; for
      // Zemer it also closes the embed so nothing keeps playing hidden.
      if (track.source !== "zemer" && a) { a.pause(); setPreviewPos(0); }
      if (track.source === "zemer") setZemerPreviewId(null);
      setPlayingId(null);
      return;
    }
    if (track.source === "zemer") {
      // Open/close the legitimate YouTube embed preview for this Zemer track.
      setZemerPreviewId((cur) => (cur === track.videoId ? null : track.videoId));
      setPlayingId(playingId === track.trackId ? null : track.trackId);
      return;
    }
    setZemerPreviewId(null);
    a.src = url;
    a.currentTime = 0;
    a.volume = 1;
    setPreviewPos(0);
    a.play().then(() => setPlayingId(track.trackId)).catch(() => setPlayingId(null));
  };

  const handleDownload = async (track) => {
    // Gate every download through the service — it returns {allowed, reason}
    // honoring both the admin toggle and the provider's own terms. Never call
    // saveToNexTextFolder when the download isn't permitted.
    const res = resolveDownload(globalSettings, userDoc, track);
    if (!res.allowed) return;
    try {
      const blob = await fetchTrackBlob(track);
      if (!blob) return;
      await saveToNexTextFolder("music-" + track.trackId + ".m4a", blob, "audio/mp4");
    } catch { /* best effort */ }
  };

  return createPortal(
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 2147483200, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: t.surface, width: "100%", boxSizing: "border-box", borderRadius: "20px 20px 0 0", padding: "16px 20px 28px", maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Add Background Music</span>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, marginBottom: 10 }}>
          <Search size={16} color={t.textMuted} />
          <input autoFocus value={q} onChange={onChange} placeholder="Search songs, artists…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14, color: t.text }} />
        </div>
        {selectableProviders.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {selectableProviders.map((p) => (
              <div
                key={p}
                onClick={() => { setChosenProvider(p); if (q.trim()) runSearch(q, p); }}
                style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${chosenProvider === p ? t.primary : t.border}`, background: chosenProvider === p ? t.primaryLight : t.bg, color: chosenProvider === p ? t.primary : t.textMuted }}
              >
                {p === "apple" ? "🎵 Apple" : p === "zemer" ? "🎵 Zemer" : ""}
              </div>
            ))}
          </div>
        )}
        {searchProvider && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: t.primary, marginBottom: 8 }}>
            {searchProvider === "apple" ? "🎵 Apple Music" : searchProvider === "zemer" ? "🎵 Zemer" : ""}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loading && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>Searching…</div>}
          {!loading && error && <div style={{ color: "#FF3B30", fontSize: 13, textAlign: "center", padding: 20 }}>{error}</div>}
          {!loading && !error && q.trim() && results.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No results.</div>}
          {!loading && !q.trim() && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>Search for a song to add as background music. Previews stream from the source; only metadata is stored with your status.</div>}
          {results.map((track) => {
            const previewUrl = getPreviewUrl(track);
            // Zemer has no <audio> preview URL — its legitimate preview is the
            // YouTube embed below. Without this, every Zemer row rendered a
            // greyed-out button and the embed could never be opened.
            const canPreview = !!previewUrl || track.source === "zemer" || track.canPreview === true;
            const dl = resolveDownload(globalSettings, userDoc, track);
            return (
            <div key={track.trackId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderBottom: `1px solid ${t.border}` }}>
              {track.artwork ? (
                <img src={track.artwork} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: t.primaryLight }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 8, background: t.primaryLight, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: t.primary }}>{(track.title || "?")[0]}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }} onClick={() => canPreview && playPreview(track)}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
                <div style={{ fontSize: 12, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.artist}{track.album ? ` · ${track.album}` : ""}</div>
              </div>
              <div onClick={() => canPreview && playPreview(track)} title={canPreview ? "Preview" : "No preview"} style={{ width: 34, height: 34, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", opacity: canPreview ? 1 : 0.4, cursor: canPreview ? "pointer" : "default", flexShrink: 0 }}>
                {canPreview ? (playingId === track.trackId ? <Pause size={16} color={t.primary} /> : <Play size={16} color={t.primary} />) : <Music size={16} color={t.textMuted} />}
              </div>
              <div onClick={() => onSelect(track)} style={{ padding: "7px 12px", borderRadius: 8, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}>Add</div>
              {dl.allowed && (
                <div onClick={() => handleDownload(track)} title="Download preview to device" style={{ width: 34, height: 34, borderRadius: "50%", background: t.bg, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                  <Download size={16} color={t.primary} />
                </div>
              )}
            </div>
            );
          })}
        </div>
        {/* Apple preview: real seek bar bound to the ACTUAL preview duration (never
            presented as the full song). Zemer previews via the legitimate YouTube
            embed (Zemer's own playback source) with YouTube's native controls.
            NOTE: the seek bar keys off the provider that actually served these
            results (searchProvider), not the picker's tab state — the two can
            differ after a provider-override search. */}
        {playingId && (searchProvider || chosenProvider) === "apple" && (
          <div style={{ padding: "4px 2px 8px" }}>
            <input
              type="range"
              min="0"
              max={previewDur || 30}
              step="0.5"
              value={Math.min(previewPos, previewDur || 30)}
              onChange={(e) => { const v = Number(e.target.value); setPreviewPos(v); if (previewRef.current) { previewRef.current.currentTime = v; previewRef.current.play().catch(() => {}); } }}
              style={{ width: "100%", accentColor: t.primary, height: 24, minHeight: 24 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: t.textMuted }}>
              <span>{fmtSecs(previewPos)}</span>
              <span>{fmtSecs(previewDur || 30)} preview</span>
            </div>
          </div>
        )}
        {zemerPreviewId && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 12, overflow: "hidden", background: "#000" }}>
              <iframe
                key={zemerPreviewId}
                src={`https://www.youtube.com/embed/${zemerPreviewId}?rel=0&modestbranding=1&playsinline=1${(() => { try { return `&origin=${encodeURIComponent(window.location.origin)}`; } catch { return ""; } })()}`}
                title="Zemer preview"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
              />
            </div>
            <div style={{ fontSize: 10.5, color: t.textMuted, marginTop: 4 }}>
              Zemer plays through YouTube (its own playback source). Press play on the video above to preview — full track with YouTube's own seek. Nothing is downloaded or extracted.
            </div>
          </div>
        )}
        <audio
          ref={previewRef}
          style={{ display: "none" }}
          onEnded={() => { setPlayingId(null); setPreviewPos(0); }}
          onTimeUpdate={(e) => setPreviewPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setPreviewDur(e.currentTarget.duration || 0)}
        />
      </div>
    </div>,
    document.body
  );
}

async function saveToNexTextFolder(fileName, blob, mimeType) {
  const NextextNative = (typeof window !== "undefined" && window.Capacitor?.Plugins?.NextextNative) || null;
  const isNative = typeof window !== "undefined" && window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform();
  if (isNative && NextextNative && NextextNative.saveToDownloads) {
    try {
      const b64 = await blobToBase64(blob);
      await NextextNative.saveToDownloads({ data: b64, fileName, mimeType: mimeType || blob.type || "application/octet-stream" });
      return;
    } catch (e) {
      console.error("native save failed, falling back to web download", e);
    }
  }
  try {
    if (typeof window !== "undefined" && window.showDirectoryPicker && typeof Capacitor !== "undefined" && Capacitor.getPlatform() === "web") {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      const dir = await handle.getDirectoryHandle("NexText", { create: true });
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  } catch { /* best effort */ }
}