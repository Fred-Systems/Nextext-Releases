import React, { useState, useRef, useEffect } from "react";
import {
  ChevronLeft, Camera, Video, Type, Mic, X, Undo2, Redo2, Music, PenTool,
  Eraser, Check, Play, Pause, Smile, Trash2, Globe,
  Users, Download,   MessageCircle, Scissors, Volume2, VolumeX, Crop as CropIcon,
  Sparkles, Plus, Minus, Palette, RotateCw, EyeOff,
} from "lucide-react";
import { useTheme, FONTS } from "../theme/ThemeContext";
import Avatar from "../components/Avatar";
import { postStatus } from "../firebase/status";
import { checkStatusAllowed, recordStatusUsage } from "../firebase/limits";
import { useContacts } from "../firebase/contacts";
import { uploadMediaFile, describeUploadError, createCloudinarySegment, splitCloudinaryVideo } from "../services/mediaUpload";
import { runStatusJob } from "../services/statusUploadManager";
import { uploadChatFile } from "../supabase/media";
import { MusicPickerModal } from "../components/MusicPickerModal";
import {
  getActiveProvider, resolveMusicAccess, buildBgMusic, clampSegment,
  getProviderCapabilities, getPreviewUrl,
} from "../media/musicService";
import { getMicrophoneStream } from "../media/microphone";

// ── WhatsApp-style Status Builder (new) ──────────────────────────────────────
// Single-file builder: entry cards → full-screen editor → review → publish.
// Publishes ONLY via postStatus / uploadMediaFile / uploadChatFile /
// recordStatusUsage, mirroring StatusScreen.handlePost branches. Music is
// metadata-only (backgroundMusic). Photo edits + draw strokes are BAKED into
// the published image via canvas (the viewer cannot render strokes).

const STICKER_COLORS = ["#FFFFFF", "#000000", "#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#30B0C7", "#007AFF", "#AF52DE", "#FF2D55"];

// Highlight/background swatches for canvas text (incl. translucent + none).
const STICKER_BGS = [
  { id: "none", label: "None", css: "none" },
  { id: "dark", label: "Dark", css: "rgba(0,0,0,0.60)" },
  { id: "light", label: "Light", css: "rgba(255,255,255,0.85)" },
  { id: "green", label: "Green", css: "rgba(0,168,132,0.85)" },
  { id: "blue", label: "Blue", css: "rgba(76,141,255,0.85)" },
  { id: "purple", label: "Purple", css: "rgba(124,92,255,0.85)" },
  { id: "red", label: "Red", css: "rgba(255,59,48,0.85)" },
];

const TEXT_PRESETS = [
  { id: "classic", label: "Classic", size: 26, color: "#FFFFFF" },
  { id: "clean", label: "Clean", size: 20, color: "#FFFFFF" },
  { id: "bold", label: "Bold", size: 34, color: "#FFCC00" },
  { id: "typewriter", label: "Typewriter", size: 20, color: "#34C759" },
  { id: "elegant", label: "Elegant", size: 28, color: "#FFD9E8" },
  { id: "playful", label: "Playful", size: 30, color: "#30B0C7" },
];

const TEXT_BG_PRESETS = [
  "#00A884", "#1FA855", "#53BDEB", "#7C5CFF", "#D98A9A", "#FF6B5B",
  "#E8A33D", "#B784E0", "#4C8DFF", "#111B21",
  "linear-gradient(135deg,#7C5CFF,#00A884)", "linear-gradient(135deg,#FF6B5B,#E8A33D)",
  "linear-gradient(135deg,#0B141A,#4C8DFF)", "linear-gradient(135deg,#B784E0,#FF2D55)",
];

const PHOTO_FILTERS = [
  { id: "none", label: "None", css: "" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.05)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.85)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.8) contrast(1.1)" },
  { id: "warm", label: "Warm", css: "sepia(0.35) saturate(1.4) hue-rotate(-15deg)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.6) brightness(0.9)" },
  { id: "fade", label: "Fade", css: "contrast(0.85) brightness(1.1) sepia(0.2)" },
  { id: "pop", label: "Pop", css: "saturate(2) contrast(1.3)" },
];

const ASPECTS = [
  { id: "original", label: "Original", ratio: 0 },
  { id: "square", label: "1:1", ratio: 1 },
  { id: "portrait", label: "4:5", ratio: 4 / 5 },
  { id: "story", label: "9:16", ratio: 9 / 16 },
  { id: "freeform", label: "Free", ratio: 0 },
];

const EMOJI_GRID = ["😀", "😂", "😍", "🥳", "😎", "🤔", "😢", "😡", "👍", "👏", "🙏", "🔥", "❤️", "💯", "🎉", "⭐", "🌙", "☀️", "🌈", "🍕", "⚽", "🎵", "📸", "✈️", "🌹", "💡", "🐶", "🐱", "👋", "💪", "🎂", "🍀"];

const MUSIC_OVERLAY_STYLES = [
  { id: "compact", label: "Compact" },
  { id: "artwork", label: "Artwork" },
  { id: "minimal", label: "Minimal" },
];

function nid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => { try { URL.revokeObjectURL(v.src); } catch {} resolve(Math.ceil(v.duration * 1000)); };
      v.onerror = () => resolve(10000);
      v.src = URL.createObjectURL(file);
      setTimeout(() => resolve(10000), 8000);
    } catch { resolve(10000); }
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Bake rotation + crop (fixed-aspect OR freeform rectangle) + filter/adjust +
// draw strokes into a JPEG blob. `edits.cropRect` (when aspect === "freeform") is
// normalized 0..1 relative to the rotated image frame, letting the user pick an
// arbitrary crop region (not just a fixed aspect ratio).
async function bakePhoto(file, edits, strokes) {
  const img = await loadImageFromFile(file);
  const rot = ((edits.rotate || 0) % 360 + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const rw = swapped ? nh : nw;
  const rh = swapped ? nw : nh;
  // Scale the full rotated image so its longest side is <= 1920.
  const scale = Math.min(1, 1920 / Math.max(rw, rh));
  const bw = Math.max(1, Math.round(rw * scale));
  const bh = Math.max(1, Math.round(rh * scale));
  const base = document.createElement("canvas");
  base.width = bw; base.height = bh;
  const bctx = base.getContext("2d");
  const filt = PHOTO_FILTERS.find((f) => f.id === edits.filter)?.css || "";
  const adj = `brightness(${edits.bright ?? 1}) contrast(${edits.contrast ?? 1}) saturate(${edits.sat ?? 1})`;
  try { bctx.filter = [filt, adj].filter(Boolean).join(" "); } catch {}
  bctx.save();
  bctx.translate(bw / 2, bh / 2);
  bctx.rotate((rot * Math.PI) / 180);
  const dw = swapped ? bh : bw;
  const dh = swapped ? bw : bh;
  const srcScale = Math.min(dw / nw, dh / nh);
  const drawW = nw * srcScale, drawH = nh * srcScale;
  bctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  bctx.restore();
  try { bctx.filter = "none"; } catch {}
  // Draw strokes (normalized 0..1 coords relative to the rotated frame).
  for (const st of strokes || []) {
    if (!st.points || st.points.length === 0) continue;
    bctx.strokeStyle = st.eraser ? "#000000" : st.color;
    bctx.globalCompositeOperation = st.eraser ? "destination-out" : "source-over";
    bctx.lineWidth = Math.max(1, (st.size || 6) * (bw / 400));
    bctx.lineCap = "round";
    bctx.lineJoin = "round";
    bctx.beginPath();
    st.points.forEach((p, i) => {
      const x = p.x * bw, y = p.y * bh;
      if (i === 0) bctx.moveTo(x, y); else bctx.lineTo(x, y);
    });
    bctx.stroke();
  }
  bctx.globalCompositeOperation = "source-over";

  // Determine the crop region (normalized to the base canvas).
  let sx = 0, sy = 0, sw = bw, sh = bh;
  const aspect = ASPECTS.find((a) => a.id === edits.aspect) || ASPECTS[0];
  if (edits.aspect === "freeform" && edits.cropRect && edits.cropRect.w > 0.01 && edits.cropRect.h > 0.01) {
    sx = Math.round(edits.cropRect.x * bw);
    sy = Math.round(edits.cropRect.y * bh);
    sw = Math.round(edits.cropRect.w * bw);
    sh = Math.round(edits.cropRect.h * bh);
  } else if (aspect.ratio > 0) {
    const target = aspect.ratio;
    const cur = bw / bh;
    let cw = bw, ch = bh;
    if (cur > target) cw = Math.round(bh * target); else ch = Math.round(bw / target);
    sx = Math.round((bw - cw) / 2); sy = Math.round((bh - ch) / 2); sw = cw; sh = ch;
  }
  sx = Math.max(0, Math.min(bw - sw, sx));
  sy = Math.max(0, Math.min(bh - sh, sy));
  sw = Math.max(1, Math.min(bw - sx, sw));
  sh = Math.max(1, Math.min(bh - sy, sh));
  if (sw === bw && sh === bh) return new Promise((res) => base.toBlob(res, "image/jpeg", 0.85));
  const out = document.createElement("canvas");
  out.width = sw; out.height = sh;
  out.getContext("2d").drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((res) => out.toBlob(res, "image/jpeg", 0.85));
}

function defaultImgEdits() {
  return { filter: "none", bright: 1, contrast: 1, sat: 1, rotate: 0, aspect: "original", cropRect: null, strokes: [] };
}

// Interactive freeform crop rectangle overlay. Coordinates are normalized (0..1)
// to the rotated image frame so they map directly onto bakePhoto's base canvas.
function FreeformCropOverlay({ edits, onChange }) {
  const boxRef = useRef(null);
  const rect = edits.cropRect || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  const toNorm = (e) => {
    const el = boxRef.current?.parentElement;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const startDrag = (moveFn) => (e) => {
    e.stopPropagation();
    const start = toNorm(e);
    const orig = { ...rect };
    const move = (ev) => moveFn(toNorm(ev), start, orig);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onBackgroundDown = (e) => {
    if (e.target !== e.currentTarget) return;
    const p = toNorm(e);
    const move = (c) => onChange({ x: Math.min(p.x, c.x), y: Math.min(p.y, c.y), w: Math.abs(c.x - p.x), h: Math.abs(c.y - p.y) });
    startDrag(move)(e);
  };
  const onBoxDown = startDrag((c, start, orig) => {
    let x = Math.min(1 - orig.w, Math.max(0, orig.x + (c.x - start.x)));
    let y = Math.min(1 - orig.h, Math.max(0, orig.y + (c.y - start.y)));
    onChange({ ...orig, x, y });
  });
  const onHandleDown = startDrag((c, start, orig) => {
    onChange({ ...orig, w: Math.min(1 - orig.x, Math.max(0.05, c.x - orig.x)), h: Math.min(1 - orig.y, Math.max(0.05, c.y - orig.y)) });
  });
  return (
    <div onPointerDown={onBackgroundDown} style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none" }}>
      <div
        onPointerDown={onBoxDown}
        style={{ position: "absolute", left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, border: "2px solid #fff", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", boxSizing: "border-box", cursor: "move" }}
      >
        <div onPointerDown={onHandleDown} style={{ position: "absolute", right: -9, bottom: -9, width: 18, height: 18, borderRadius: "50%", background: "#fff", border: "2px solid #007aff", cursor: "nwse-resize" }} />
      </div>
    </div>
  );
}

export default function StatusBuilderNew(props) {
  const { myUid, userDoc, globalSettings, sysConfig, initialFile, initialFileType, initialText, onClose, onPosted } = props;
  const { t } = useTheme();

  // Height unit that respects the DYNAMIC viewport (avoids the classic mobile
  // bug where 100vh exceeds the visible area once the browser chrome shows,
  // which previously pushed the builder's bottom toolbar / Post button below
  // the fold and clipped them). Fall back to 100vh only where dvh is unsupported.
  const dvhSupported = typeof window !== "undefined" && window.CSS && typeof window.CSS.supports === "function" && window.CSS.supports("height", "100dvh");
  const vhUnit = dvhSupported ? "100dvh" : "100vh";

  // ── Flow state ──
  const seeded = useRef(false);
  const [step, setStep] = useState("entry"); // entry | edit | review
  const [mode, setMode] = useState(null); // photo | video | text | voice
  const [confirmLeave, setConfirmLeave] = useState(false);

  // ── Media state ──
  const [photos, setPhotos] = useState([]); // [{id, file, url}]
  const [activePhotoId, setActivePhotoId] = useState(null);
  const [imgEdits, setImgEdits] = useState({}); // {photoId: edits}
  const [videoFile, setVideoFile] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [videoDurSec, setVideoDurSec] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  // Number of evenly-duration parts to split the video into when posting (1 = single
  // trimmed clip; 2-5 = split into that many separate, genuinely-trimmed assets).
  const [splitParts, setSplitParts] = useState(1);
  const [videoVolume, setVideoVolume] = useState(100);
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [videoFilter, setVideoFilter] = useState("none");
  const [voiceBlob, setVoiceBlob] = useState(null);
  const [voiceURL, setVoiceURL] = useState(null);
  const [voiceDurMs, setVoiceDurMs] = useState(0);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);

  // ── Shared composer state ──
  const [caption, setCaption] = useState("");
  const [textStickers, setTextStickers] = useState([]); // {id,text,x,y,color,size,align?,preset?}
  const [activeStickerId, setActiveStickerId] = useState(null);
  const [history, setHistory] = useState([[]]);
  const [hIdx, setHIdx] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [waitForVideo, setWaitForVideo] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [commentsHidden, setCommentsHidden] = useState(false);
  // Per-status audience exclusion (specific contacts who must NOT see this status).
  // Merged with the owner's global privacy.statusExcluded at post time.
  const [excludedUids, setExcludedUids] = useState([]);
  const [showExcludeList, setShowExcludeList] = useState(false);
  const { contacts } = useContacts(myUid);
  const acceptedContactsForExclude = (contacts || []).filter((c) => c.status === "accepted");
  const [audience, setAudience] = useState("contacts");
  const [posting, setPosting] = useState(false);
  const [postProgress, setPostProgress] = useState("");
  const [postError, setPostError] = useState("");

  // ── Text-mode state ──
  const [textMode, setTextMode] = useState("");
  const [bgIdx, setBgIdx] = useState(0);
  const [fontIdx, setFontIdx] = useState(0);
  const [textAlign, setTextAlign] = useState("center");

  // ── Music / voiceover state ──
  const [bgMusic, setBgMusic] = useState(null);
  const [musicModalOpen, setMusicModalOpen] = useState(false);
  const [musicStyle, setMusicStyle] = useState("compact");
  const [musicPreviewOn, setMusicPreviewOn] = useState(false);
  const [bgAudioFile, setBgAudioFile] = useState(null);
  const [bgAudioVolume, setBgAudioVolume] = useState(70);
  // Voiceover in-builder recording (photo/video/text): records straight into
  // bgAudioFile without switching modes.
  const [isVoRecording, setIsVoRecording] = useState(false);
  const [voPreviewUrl, setVoPreviewUrl] = useState(null);
  const voRecorderRef = useRef(null);
  const voStreamRef = useRef(null);

  // ── Tool state ──
  const [tool, setTool] = useState(null); // text | emoji | draw | music | effects | crop | trim | audio | null
  const [presetId, setPresetId] = useState("classic");
  const [brushColor, setBrushColor] = useState("#FF3B30");
  const [brushSize, setBrushSize] = useState(6);
  const [eraserOn, setEraserOn] = useState(false);

  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const canvasRef = useRef(null);
  const drawBoxRef = useRef(null);
  const currentStrokeRef = useRef(null);
  // Redo stack for draw strokes, keyed by photo id (reset whenever a new
  // stroke is drawn, the drawing is cleared, or the active photo changes).
  const strokeRedoRef = useRef({});
  const [strokeRedoVer, setStrokeRedoVer] = useState(0);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const musicAudioRef = useRef(null);
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const videoRef = useRef(null);
  // Tracks whether this builder is still mounted so an in-flight post can avoid
  // writing state after unmount (e.g. the user left the Status page mid-upload).
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const urlsToRevoke = useRef([]);

  const musicProviderActive = getActiveProvider(globalSettings);
  const musicAccessAllowed = resolveMusicAccess(globalSettings, userDoc);
  const musicCaps = getProviderCapabilities(musicProviderActive);
  const showMusicTool = musicAccessAllowed && musicProviderActive !== "disabled";

  const activePhoto = photos.find((p) => p.id === activePhotoId) || photos[0] || null;
  const activeEdits = (activePhoto && imgEdits[activePhoto.id]) || defaultImgEdits();
  const activeSticker = textStickers.find((s) => s.id === activeStickerId) || null;
  // Baked preview: the SAME transformed asset (rotate + crop + filter + draw
  // strokes) that gets uploaded in handlePost, so the final preview matches the
  // posted result exactly. Keyed by photo id; rebuilt when entering review.
  const [bakedPreview, setBakedPreview] = useState({});
  useEffect(() => {
    let alive = true;
    if (step === "review" && mode === "photo") {
      (async () => {
        const out = {};
        for (const p of photos) {
          const ed = imgEdits[p.id] || defaultImgEdits();
          try {
            const blob = await bakePhoto(p.file, ed, ed.strokes || []);
            if (blob) out[p.id] = { url: URL.createObjectURL(blob), blob };
          } catch { /* keep original as fallback */ }
        }
        if (alive) setBakedPreview(out);
      })();
    } else if (Object.keys(bakedPreview).length) {
      Object.values(bakedPreview).forEach((v) => { try { URL.revokeObjectURL(v.url); } catch {} });
      setBakedPreview({});
    }
    return () => { alive = false; };
    // Re-bake when (re)entering review or when the source photos change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, photos]);

  // ── Seed from props (skip entry when initial content provided) ──
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const vis = userDoc?.statusVisibility;
    setAudience(vis === "everyone" || vis === "public" ? "public" : "contacts");
    if (initialText) {
      setTextMode(initialText);
      setMode("text");
      setStep("edit");
    } else if (initialFile) {
      if (initialFileType === "video") {
        addVideoFile(initialFile);
      } else {
        addPhotoFiles([initialFile]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    urlsToRevoke.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    urlsToRevoke.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Object URL for the recorded voice blob (created once per blob, not per render).
  useEffect(() => {
    if (!voiceBlob) { setVoiceURL(null); return; }
    const u = URL.createObjectURL(voiceBlob);
    urlsToRevoke.current.push(u);
    setVoiceURL(u);
    return () => { try { URL.revokeObjectURL(u); } catch {} };
  }, [voiceBlob]);

  // ── Sticker history (undo/redo for canvas ops) ──
  const commitStickers = (next) => {
    setTextStickers(next);
    setHistory((h) => [...h.slice(0, hIdx + 1), next].slice(-40));
    setHIdx((i) => Math.min(i + 1, 39));
  };
  const undo = () => {
    if (hIdx <= 0) return;
    const ni = hIdx - 1;
    setHIdx(ni);
    setTextStickers(history[ni] || []);
  };
  const redo = () => {
    if (hIdx >= history.length - 1) return;
    const ni = hIdx + 1;
    setHIdx(ni);
    setTextStickers(history[ni] || []);
  };
  const updateSticker = (id, patch) => {
    const next = textStickers.map((s) => (s.id === id ? { ...s, ...patch } : s));
    setTextStickers(next);
  };
  const commitStickerUpdate = (id, patch) => {
    commitStickers(textStickers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addTextSticker = (emojiText) => {
    if (mode === "text" && emojiText) {
      // In text mode there is no canvas sticker layer — append to the message.
      setTextMode((prev) => `${prev || ""}${emojiText}`);
      return;
    }
    const preset = TEXT_PRESETS.find((p) => p.id === presetId) || TEXT_PRESETS[0];
    const base = { x: 0.5, y: 0.4, align: "center", rotation: 0, background: "none", opacity: 1 };
    const st = emojiText
      ? { id: nid("st"), text: emojiText, color: "#FFFFFF", size: 44, preset: "emoji", ...base }
      : { id: nid("st"), text: "Tap to edit", color: preset.color, size: preset.size, preset: preset.id, ...base };
    commitStickers([...textStickers, st]);
    setActiveStickerId(st.id);
  };

  // ── Media intake ──
  const addPhotoFiles = (files) => {
    const room = Math.max(0, 6 - photos.length);
    const picks = files.slice(0, room || 6);
    if (!picks.length) return;
    const mapped = picks.map((f) => ({ id: nid("img"), file: f, url: URL.createObjectURL(f), width: 0, height: 0 }));
    mapped.forEach((m) => {
      urlsToRevoke.current.push(m.url);
      const im = new Image();
      im.onload = () => {
        setPhotos((prev) => prev.map((p) => (p.id === m.id ? { ...p, width: im.naturalWidth, height: im.naturalHeight } : p)));
      };
      im.src = m.url;
    });
    setPhotos((prev) => {
      const next = [...prev, ...mapped].slice(0, 6);
      if (!activePhotoId && next.length) setActivePhotoId(next[0].id);
      return next;
    });
    setImgEdits((prev) => {
      const next = { ...prev };
      mapped.forEach((m) => { if (!next[m.id]) next[m.id] = defaultImgEdits(); });
      return next;
    });
    setMode("photo");
    setStep("edit");
  };

  const addVideoFile = (file) => {
    if (videoURL) { try { URL.revokeObjectURL(videoURL); } catch {} }
    const url = URL.createObjectURL(file);
    urlsToRevoke.current.push(url);
    setVideoFile(file);
    setVideoURL(url);
    setMode("video");
    setStep("edit");
    getVideoDuration(file).then((ms) => {
      const secs = Math.max(1, Math.round(ms / 1000));
      setVideoDurSec(secs);
      setTrimStart(0);
      setTrimEnd(secs);
    });
  };

  // ── Voice recording (mirrors StatusScreen: native → WebView MediaRecorder) ──
  const startVoiceRecording = async () => {
    setPostError("");
    if (isVoiceRecording) { stopVoiceRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPostError("Voice recording isn't supported on this device.");
      return;
    }
    const isNative = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
    const NextextNative = isNative ? window.Capacitor?.Plugins?.NextextNative : null;
    if (isNative && NextextNative && typeof NextextNative.startVoiceRecording === "function") {
      try {
        await NextextNative.startVoiceRecording();
        setIsVoiceRecording(true);
        setVoiceBlob(null);
        setVoiceDurMs(0);
        const t0 = Date.now();
        voiceRecorderRef.current = voiceRecorderRef.current || {};
        voiceRecorderRef.current._nativeTick = setInterval(() => setVoiceDurMs(Date.now() - t0), 200);
        return;
      } catch { /* fall through to WebView */ }
    }
    try {
      const stream = await getMicrophoneStream({ audio: true });
      voiceStreamRef.current = stream;
      const chunks = [];
      let recorder;
      try {
        const mt = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
          : MediaRecorder.isTypeSupported("audio/m4a") ? "audio/m4a"
          : MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "";
        recorder = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      } catch { recorder = new MediaRecorder(stream); }
      voiceRecorderRef.current = recorder;
      const t0 = Date.now();
      setIsVoiceRecording(true);
      setVoiceBlob(null);
      setVoiceDurMs(0);
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        try { clearInterval(recorder._tick); } catch {}
        try { stream.getTracks().forEach((tr) => tr.stop()); } catch {}
        voiceStreamRef.current = null;
        voiceRecorderRef.current = null;
        setIsVoiceRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/mp4" });
        setVoiceBlob(blob);
        setVoiceDurMs(Date.now() - t0);
        setMode("voice");
        setStep("edit");
      };
      recorder.start();
      recorder._tick = setInterval(() => setVoiceDurMs(Date.now() - t0), 200);
    } catch { setIsVoiceRecording(false); setPostError("Microphone access denied or unavailable."); }
  };

  const stopVoiceRecording = async () => {
    const rec = voiceRecorderRef.current;
    if (rec?._nativeTick) {
      clearInterval(rec._nativeTick);
      rec._nativeTick = null;
    }
    const isNative = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
    const NextextNative = isNative ? window.Capacitor?.Plugins?.NextextNative : null;
    if (isNative && NextextNative && typeof NextextNative.stopVoiceRecording === "function") {
      try {
        const res = await NextextNative.stopVoiceRecording();
        setIsVoiceRecording(false);
        const { base64ToBlob } = await import("../media/base64");
        const blob = base64ToBlob(res?.base64 || res?.data || "", res?.mimeType || "audio/m4a");
        if (blob) {
          setVoiceBlob(blob);
          setVoiceDurMs(res?.durationMs || 0);
          setMode("voice");
          setStep("edit");
          return;
        }
        setPostError("Failed to read recorded audio.");
        return;
      } catch { /* fall through */ }
    }
    if (rec?._nativeTick) { clearInterval(rec._nativeTick); }
    if (rec && rec.state === "recording") rec.stop();
    else setIsVoiceRecording(false);
  };

  // ── Voiceover recorder (photo/video/text voice-over-media): records straight
  // into bgAudioFile without changing modes. Play/Delete/Replace in the panel.
  useEffect(() => {
    if (!bgAudioFile) { setVoPreviewUrl(null); return; }
    const u = URL.createObjectURL(bgAudioFile);
    setVoPreviewUrl(u);
    return () => { try { URL.revokeObjectURL(u); } catch { /* noop */ } };
  }, [bgAudioFile]);
  const startVoRecord = async () => {
    setPostError("");
    if (isVoRecording) { stopVoRecord(); return; }
    try {
      const { getMicrophoneStream } = await import("../media/microphone");
      const stream = await getMicrophoneStream({ audio: true });
      voStreamRef.current = stream;
      const chunks = [];
      let recorder;
      try {
        const mt = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
          : MediaRecorder.isTypeSupported("audio/m4a") ? "audio/m4a"
          : MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "";
        recorder = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      } catch { recorder = new MediaRecorder(stream); }
      voRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        try { stream.getTracks().forEach((tr) => tr.stop()); } catch { /* noop */ }
        voStreamRef.current = null;
        setIsVoRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/mp4" });
        if (blob.size > 0) setBgAudioFile(new File([blob], `voiceover-${Date.now()}.m4a`, { type: blob.type }));
      };
      setIsVoRecording(true);
      recorder.start();
    } catch { setIsVoRecording(false); setPostError("Microphone access denied or unavailable."); }
  };
  const stopVoRecord = () => {
    try { voRecorderRef.current?.state === "recording" && voRecorderRef.current.stop(); }
    catch { setIsVoRecording(false); }
  };

  // ── Draw tool ──
  const patchEdits = (patch) => {
    if (!activePhoto) return;
    setImgEdits((prev) => ({ ...prev, [activePhoto.id]: { ...(prev[activePhoto.id] || defaultImgEdits()), ...patch } }));
  };

  const redrawDrawCanvas = () => {
    const cv = canvasRef.current;
    const box = drawBoxRef.current;
    if (!cv || !box) return;
    const r = box.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width));
    cv.height = Math.max(1, Math.round(r.height));
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const strokes = [...(activeEdits.strokes || [])];
    if (currentStrokeRef.current) strokes.push(currentStrokeRef.current);
    for (const st of strokes) {
      if (!st.points || !st.points.length) continue;
      ctx.strokeStyle = st.eraser ? "rgba(0,0,0,1)" : st.color;
      // Mirror the bake step: eraser punches through via destination-out so
      // the overlay preview matches the published image.
      ctx.globalCompositeOperation = st.eraser ? "destination-out" : "source-over";
      ctx.lineWidth = Math.max(1, st.size * (cv.width / 400));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      st.points.forEach((p, i) => {
        const x = p.x * cv.width;
        const y = p.y * cv.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  };

  useEffect(() => { if (tool === "draw") redrawDrawCanvas(); });
  useEffect(() => {
    const onResize = () => { if (tool === "draw") redrawDrawCanvas(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  const drawPos = (e) => {
    const box = drawBoxRef.current;
    const r = box.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const undoStroke = () => {
    if (!activePhoto) return;
    const strokes = activeEdits.strokes || [];
    if (!strokes.length) return;
    const redo = strokeRedoRef.current[activePhoto.id] || [];
    redo.push(strokes[strokes.length - 1]);
    strokeRedoRef.current[activePhoto.id] = redo;
    patchEdits({ strokes: strokes.slice(0, -1) });
    setStrokeRedoVer((v) => v + 1);
    setTimeout(redrawDrawCanvas, 0);
  };

  const redoStroke = () => {
    if (!activePhoto) return;
    const redo = strokeRedoRef.current[activePhoto.id] || [];
    if (!redo.length) return;
    const st = redo.pop();
    strokeRedoRef.current[activePhoto.id] = redo;
    patchEdits({ strokes: [...(activeEdits.strokes || []), st] });
    setStrokeRedoVer((v) => v + 1);
    setTimeout(redrawDrawCanvas, 0);
  };

  const clearStrokes = () => {
    if (!activePhoto) return;
    strokeRedoRef.current[activePhoto.id] = [];
    patchEdits({ strokes: [] });
    setStrokeRedoVer((v) => v + 1);
    setTimeout(redrawDrawCanvas, 0);
  };
  void strokeRedoVer;

  // ── Sticker drag (pointer events, x/y 0..1) ──
  const onStickerDown = (e, st) => {
    e.stopPropagation();
    setActiveStickerId(st.id);
    const box = e.currentTarget.parentElement.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: st.x, y: st.y };
    dragRef.current = { id: st.id, startX, startY, orig, box };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const nx = Math.min(0.95, Math.max(0.05, d.orig.x + (ev.clientX - d.startX) / d.box.width));
      const ny = Math.min(0.95, Math.max(0.05, d.orig.y + (ev.clientY - d.startY) / d.box.height));
      updateSticker(d.id, { x: nx, y: ny });
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (d) {
        const cur = textStickers.find((s) => s.id === d.id);
        if (cur) commitStickerUpdate(d.id, { x: cur.x, y: cur.y });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── Sticker pinch-to-resize (touch): two fingers scale the sticker size ──
  const onStickerTouchStart = (e, st) => {
    if (e.touches && e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      pinchRef.current = { id: st.id, dist: Math.max(1, d), size: st.size || 26 };
    }
  };
  const onStickerTouchMove = (e) => {
    const p = pinchRef.current;
    if (!p || !e.touches || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    const next = Math.min(64, Math.max(12, Math.round((p.size * d) / p.dist)));
    updateSticker(p.id, { size: next });
  };
  const onStickerTouchEnd = (e) => {
    const p = pinchRef.current;
    if (!p) return;
    if (!e.touches || e.touches.length < 2) {
      const cur = textStickers.find((s) => s.id === p.id);
      if (cur) commitStickerUpdate(p.id, { size: cur.size });
      pinchRef.current = null;
    }
  };

  // ── Music ──
  const handleSelectMusic = (track) => {
    setBgMusic(buildBgMusic(track, musicProviderActive, {
      originalVolume: mode === "video" ? videoVolume / 100 : 1,
    }));
    setMusicModalOpen(false);
  };

  const onSegChange = (which, val) => {
    if (!bgMusic) return;
    const provider = bgMusic.provider || musicProviderActive;
    const next = which === "start"
      ? clampSegment(provider, val, bgMusic.end, bgMusic.durationSec)
      : clampSegment(provider, bgMusic.start, val, bgMusic.durationSec);
    setBgMusic({ ...bgMusic, start: next.start, end: next.end });
  };

  const toggleMusicPreview = () => {
    const a = musicAudioRef.current;
    if (!a || !bgMusic) return;
    if (musicPreviewOn) { a.pause(); setMusicPreviewOn(false); return; }
    const url = getPreviewUrl(bgMusic);
    if (!url) return;
    a.src = url;
    a.currentTime = bgMusic.start || 0;
    a.volume = bgMusic.muted ? 0 : (bgMusic.volume ?? 1);
    a.play().then(() => setMusicPreviewOn(true)).catch(() => {});
  };

  const onMusicTime = () => {
    const a = musicAudioRef.current;
    if (!a || !bgMusic) return;
    if (a.currentTime >= (bgMusic.end ?? 30)) { a.pause(); setMusicPreviewOn(false); }
  };

  const snapBgMusic = () => {
    if (!bgMusic) return null;
    return {
      provider: bgMusic.provider, trackId: bgMusic.trackId, title: bgMusic.title,
      artist: bgMusic.artist, album: bgMusic.album, artwork: bgMusic.artwork,
      previewUrl: bgMusic.previewUrl, videoId: bgMusic.videoId || null, source: bgMusic.source,
      start: bgMusic.start, end: bgMusic.end, durationSec: bgMusic.durationSec,
      volume: bgMusic.volume, originalVolume: bgMusic.originalVolume, muted: bgMusic.muted,
    };
  };

  // ── Dirty check + exit guard ──
  const isDirty = () => (
    photos.length > 0 || videoFile || voiceBlob || textStickers.length > 0 ||
    (caption || "").trim() || (textMode || "").trim() || bgMusic || bgAudioFile
  );
  const handleBack = () => {
    if (step === "review") { setStep("edit"); return; }
    if (step === "edit" && isDirty()) { setConfirmLeave(true); return; }
    onClose?.();
  };

  const canPost = () => {
    if (mode === "text") return (textMode || "").trim().length > 0;
    if (mode === "voice") return !!voiceBlob;
    if (mode === "photo") return photos.length > 0;
    if (mode === "video") return !!videoFile;
    return false;
  };

  // ── Publish (mirrors StatusScreen.handlePost branches) ──
  const handlePost = async () => {
    if (!canPost() || posting) return;
    setPostError("");
    const statusLim = await checkStatusAllowed(myUid, sysConfig?.dailyStatusLimit);
    if (!statusLim.allowed) {
      setPostError(`Daily status limit reached (${statusLim.limit} per day). Try again tomorrow.`);
      return;
    }
    const snapText = mode === "text" ? textMode : caption;
    // Persist full sticker styling so the viewer shows exact placement/styling.
    // (The viewer currently reads x/y/color/size/text; rotation/background/
    // opacity/align/preset ride along for forward compatibility.)
    const snapStickers = textStickers.length ? textStickers.map((s) => ({
      id: s.id, text: s.text, x: s.x, y: s.y, color: s.color, size: s.size,
      align: s.align || "center", preset: s.preset || null,
      rotation: s.rotation || 0, background: s.background || "none", opacity: s.opacity ?? 1,
    })) : null;
    const snapOverlay = null; // textOverlay null when stickers exist (viewer prefers stickers)
    const snapMusic = snapBgMusic();
    const snapVisibility = audience === "public" ? "public" : "contacts";
    // Merge this status's per-status exclusions with the owner's global
    // status-exclusion list (privacy.statusExcluded) so both apply to this post.
    const snapExcluded = Array.from(new Set([...(userDoc?.privacy?.statusExcluded || []), ...excludedUids]));
    const snapDurMs = durationSeconds * 1000;
    const snapAllow = allowDownload;
    const snapHide = commentsHidden;
    const snapWait = waitForVideo;
    const snapBgVol = bgAudioVolume;
    const snapVidVol = muteOriginal ? 0 : videoVolume;
    const snapBgAudio = bgAudioFile;
    const chatScope = `status-${myUid}`;
    // The entire upload + post runs inside the app-level status job manager so it
    // survives the Status Builder unmounting (e.g. the user leaves the page mid-
    // upload). The job lives on a module-level promise chain, not the React tree,
    // so leaving Status cannot cancel the post. A stable jobId prevents a retry
    // from double-posting the same status.
    if (mountedRef.current) setPosting(true);
    const jobId = `status-${myUid}-${mode}-${Date.now()}`;
    await runStatusJob({
      jobId,
      label: mode === "voice" ? "Voice status" : mode === "video" ? "Video status" : mode === "photo" ? "Photo status" : "Text status",
      task: async ({ update }) => {
        // Local progress reporter: feeds the job manager AND the component's own
        // progress UI while the component is still mounted.
        const report = (x) => { update(x); if (mountedRef.current) setPostProgress(x); };
      // Voice-note status → mediaType "voice" (same as chat voice notes bucket path).
      if (mode === "voice" && voiceBlob) {
        report("Uploading voice note…");
        const voiceFile = new File([voiceBlob], `status-voice-${Date.now()}.webm`, { type: voiceBlob.type || "audio/webm" });
        const voiceResult = await uploadMediaFile(chatScope, myUid, voiceFile);
        await postStatus(myUid, {
          text: (snapText || "").trim() || null,
          mediaURL: voiceResult.url,
          mediaType: "voice",
          backgroundColor: null,
          fontFamily: null,
          durationMs: voiceDurMs || snapDurMs,
          textOverlay: snapOverlay,
          textStickers: snapStickers,
          allowDownload: snapAllow,
          commentsHidden: snapHide,
          backgroundMusic: snapMusic,
          visibility: snapVisibility,
          excludedUids: snapExcluded,
        });
      }
      // Multiple images → separate status updates (max 6), photo edits baked.
      // A recorded/picked voiceover attaches to the FIRST photo (replaying it on
      // every slide would restart the audio per photo).
      if (mode === "photo" && photos.length > 0 && !voiceBlob) {
        const batch = photos.slice(0, 6);
        let photoBgAudioURL = null;
        let photoBgAudioVol = null;
        if (snapBgAudio) {
          try {
            report("Uploading voiceover…");
            const audioFile = new File([snapBgAudio], `status-audio-${Date.now()}.mp3`, { type: snapBgAudio.type || "audio/mpeg" });
            const audioResult = await uploadChatFile(chatScope, myUid, audioFile, { compress: false });
            photoBgAudioURL = audioResult.url;
            photoBgAudioVol = snapBgVol;
          } catch { photoBgAudioURL = null; }
        }
        for (let i = 0; i < batch.length; i++) {
          report(`Uploading photo ${i + 1} of ${batch.length}…`);
          const p = batch[i];
          const ed = imgEdits[p.id] || defaultImgEdits();
          let fileToUpload = p.file;
          try {
            const baked = await bakePhoto(p.file, ed, ed.strokes || []);
            if (baked) fileToUpload = new File([baked], `status-${Date.now()}-${i}.jpg`, { type: "image/jpeg" });
          } catch { fileToUpload = p.file; }
          const result = await uploadMediaFile(chatScope, myUid, fileToUpload);
          await postStatus(myUid, {
            text: (snapText || "").trim() || null,
            mediaURL: result.url,
            mediaType: "image",
            backgroundColor: null,
            fontFamily: null,
            durationMs: snapDurMs,
            textOverlay: snapOverlay,
            textStickers: snapStickers,
            bgAudioURL: i === 0 ? photoBgAudioURL : null,
            bgAudioVolume: i === 0 ? photoBgAudioVol : null,
            allowDownload: snapAllow,
            commentsHidden: snapHide,
            backgroundMusic: snapMusic,
            visibility: snapVisibility,
            excludedUids: snapExcluded,
          });
        }
      }
      // Single video → direct path with preview/poster via generateStatusPreview.
      if (mode === "video" && videoFile && !voiceBlob) {
        report("Uploading video…");
        let bgAudioURL = null;
        let bgAudioVol = null;
        let vidVol = null;
        if (snapBgAudio) {
          const audioFile = new File([snapBgAudio], `status-audio-${Date.now()}.mp3`, { type: snapBgAudio.type || "audio/mpeg" });
          const audioResult = await uploadChatFile(chatScope, myUid, audioFile, { compress: false });
          bgAudioURL = audioResult.url;
          bgAudioVol = snapBgVol;
          vidVol = snapVidVol;
        }
        const result = await uploadMediaFile(chatScope, myUid, videoFile);
        let durationMs = null;
        let previewURL = null;
        let posterURL = null;
        try { durationMs = await getVideoDuration(videoFile); } catch {}
        setPostProgress("Generating preview…");
        try {
          const { generateStatusPreview } = await import("../media/videoPreview.js");
          const { previewBlob, posterBlob } = await generateStatusPreview(videoFile);
          if (posterBlob) {
            const posterFile = new File([posterBlob], `status-poster-${Date.now()}.jpg`, { type: "image/jpeg" });
            const posterResult = await uploadMediaFile(chatScope, myUid, posterFile);
            posterURL = posterResult.url;
          }
          if (previewBlob) {
            const previewFile = new File([previewBlob], `status-preview-${Date.now()}.webm`, { type: previewBlob.type || "video/webm" });
            const previewResult = await uploadMediaFile(chatScope, myUid, previewFile);
            previewURL = previewResult.url;
          }
        } catch (e) { console.warn("[StatusBuilderNew] preview generation failed:", e?.message); }

        // ── Real trim / split ──
        // The original is uploaded as-is; we then create genuinely trimmed, separate
        // Cloudinary assets via server-side so_/eo_ segmentation. Each part is its
        // own file. Order is preserved (part 1 → part N). Every piece is independently
        // checked: if a piece is missing/exceeds limits we surface the error rather
        // than faking the split.
        const originalPublicId = (result.path || "").replace(/^cloudinary:/, "");
        const wantTrim = trimStart > 0 || trimEnd < (videoDurSec || durationMs ? (videoDurSec || (durationMs || 0) / 1000) : 0);
        const parts = Math.max(1, Math.min(5, splitParts | 0));
        if (parts > 1 && originalPublicId && videoDurSec > 0) {
          report(`Splitting into ${parts} parts…`);
          const segments = await splitCloudinaryVideo(originalPublicId, videoDurSec, parts);
          for (let pi = 0; pi < segments.length; pi++) {
            report(`Posting part ${pi + 1} of ${segments.length}…`);
            await postStatus(myUid, {
              text: (snapText || "").trim() || null,
              mediaURL: segments[pi].url,
              mediaType: "video",
              backgroundColor: null,
              fontFamily: null,
              durationMs: Math.round((videoDurSec / segments.length) * 1000),
              textOverlay: snapOverlay,
              textStickers: snapStickers,
              bgAudioURL: pi === 0 ? bgAudioURL : null,
              bgAudioVolume: pi === 0 ? bgAudioVol : null,
              videoVolume: vidVol,
              waitForVideo: snapWait,
              allowDownload: snapAllow,
              commentsHidden: snapHide,
              backgroundMusic: snapMusic,
              previewURL: pi === 0 ? previewURL : null,
              posterURL: pi === 0 ? posterURL : null,
              trimStart: null,
              trimEnd: null,
              videoFilter,
              visibility: snapVisibility,
              excludedUids: snapExcluded,
            });
          }
        } else if (wantTrim && originalPublicId) {
          report("Trimming video…");
          const seg = await createCloudinarySegment(originalPublicId, trimStart, trimEnd);
          await postStatus(myUid, {
            text: (snapText || "").trim() || null,
            mediaURL: seg.url,
            mediaType: "video",
            backgroundColor: null,
            fontFamily: null,
            durationMs: durationMs || snapDurMs,
            textOverlay: snapOverlay,
            textStickers: snapStickers,
            bgAudioURL,
            bgAudioVolume: bgAudioVol,
            videoVolume: vidVol,
            waitForVideo: snapWait,
            allowDownload: snapAllow,
            commentsHidden: snapHide,
            backgroundMusic: snapMusic,
            previewURL: previewURL || null,
            posterURL: posterURL || null,
            trimStart: null,
            trimEnd: null,
            videoFilter,
            visibility: snapVisibility,
            excludedUids: snapExcluded,
          });
        } else {
          await postStatus(myUid, {
            text: (snapText || "").trim() || null,
            mediaURL: result.url,
            mediaType: "video",
            backgroundColor: null,
            fontFamily: null,
            durationMs: durationMs || snapDurMs,
            textOverlay: snapOverlay,
            textStickers: snapStickers,
            bgAudioURL,
            bgAudioVolume: bgAudioVol,
            videoVolume: vidVol,
            waitForVideo: snapWait,
            allowDownload: snapAllow,
            commentsHidden: snapHide,
            backgroundMusic: snapMusic,
            previewURL: previewURL || null,
            posterURL: posterURL || null,
            trimStart,
            trimEnd,
            videoFilter,
            visibility: snapVisibility,
            excludedUids: snapExcluded,
          });
        }
      }
      // Text status (optional background audio + music).
      if (mode === "text") {
        report("Posting status…");
        let bgAudioURL = null;
        let bgAudioVol = null;
        if (snapBgAudio) {
          const audioFile = new File([snapBgAudio], `status-audio-${Date.now()}.mp3`, { type: snapBgAudio.type || "audio/mpeg" });
          const audioResult = await uploadChatFile(chatScope, myUid, audioFile, { compress: false });
          bgAudioURL = audioResult.url;
          bgAudioVol = snapBgVol;
        }
        await postStatus(myUid, {
          text: (snapText || "").trim(),
          mediaURL: null,
          mediaType: null,
          backgroundColor: TEXT_BG_PRESETS[bgIdx],
          fontFamily: (FONTS[fontIdx] || FONTS[0]).value,
          durationMs: snapDurMs,
          textOverlay: snapOverlay,
          bgAudioURL,
          bgAudioVolume: bgAudioVol,
          videoVolume: null,
          backgroundMusic: snapMusic,
          commentsHidden: snapHide,
          allowDownload: snapAllow,
          visibility: snapVisibility,
          excludedUids: snapExcluded,
        });
      }
      try { await recordStatusUsage(myUid); } catch {}
        report("Done");
      },
      onDone: () => {
        if (mountedRef.current) { setPosting(false); setPostProgress(""); }
        onPosted?.();
      },
    }).catch((err) => {
      // Surface the REAL underlying error in the console (dev diagnosis) instead of
      // only the generic "Couldn't post your status" the user sees.
      console.error("[StatusBuilderNew] post failed:", err);
      if (mountedRef.current) {
        setPosting(false);
        setPostProgress("");
        setPostError(describeUploadError(err, "Couldn't post your status"));
      }
    });
  };

  // ── Derived preview helpers ──
  const liveFilterCss = () => {
    const f = PHOTO_FILTERS.find((x) => x.id === activeEdits.filter)?.css || "";
    const adj = `brightness(${activeEdits.bright ?? 1}) contrast(${activeEdits.contrast ?? 1}) saturate(${activeEdits.sat ?? 1})`;
    return [f, adj].filter(Boolean).join(" ");
  };

  const shell = {
    position: "fixed", top: 0, left: 0, right: 0, height: vhUnit, zIndex: 2000, display: "flex",
    alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)", boxSizing: "border-box",
  };
  const phone = {
    width: "min(430px, 100%)", height: "100%", maxHeight: "100%",
    background: t.bg, color: t.text, display: "flex", flexDirection: "column",
    overflow: "hidden", position: "relative",
    borderRadius: window.innerWidth > 500 ? 24 : 0,
  };

  const toolBtn = (active) => ({
    display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
    padding: "8px 4px", borderRadius: 12, cursor: "pointer", flex: "1 1 0",
    background: active ? t.primaryLight : "transparent", color: active ? t.primary : t.text,
    border: "none", fontSize: 10, fontWeight: 700, minWidth: 54, minHeight: 48,
    flexShrink: 0,
  });

  // ══════════ ENTRY ══════════
  if (step === "entry") {
    const cards = [
      { id: "photo", label: "Photo", icon: <Camera size={30} color="#fff" />, bg: "linear-gradient(135deg,#00A884,#007AFF)" },
      { id: "video", label: "Video", icon: <Video size={30} color="#fff" />, bg: "linear-gradient(135deg,#7C5CFF,#B784E0)" },
      { id: "text", label: "Text", icon: <Type size={30} color="#fff" />, bg: "linear-gradient(135deg,#FF9500,#FF3B30)" },
      { id: "voice", label: "Voice", icon: <Mic size={30} color="#fff" />, bg: "linear-gradient(135deg,#34C759,#30B0C7)" },
    ];
    return (
      <div style={shell}>
        <div style={phone}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
            <button onClick={() => onClose?.()} aria-label="Close status builder" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
              <X size={22} color={t.text} />
            </button>
            <span style={{ fontWeight: 800, fontSize: 18 }}>Create Status</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20 }}>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 16, textAlign: "center" }}>Share a moment for the next 24 hours</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {cards.map((c) => (
                <button
                  key={c.id}
                  aria-label={`Create ${c.label} status`}
                  onClick={() => {
                    if (c.id === "photo") photoInputRef.current?.click();
                    else if (c.id === "video") videoInputRef.current?.click();
                    else if (c.id === "text") { setMode("text"); setTextMode(initialText || ""); setStep("edit"); }
                    else startVoiceRecording();
                  }}
                  style={{ background: c.bg, border: "none", borderRadius: 20, padding: "28px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, cursor: "pointer", transition: "transform 0.15s ease" }}
                >
                  {c.icon}
                  <span style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>{c.label}</span>
                </button>
              ))}
            </div>
            {isVoiceRecording && (
              <div style={{ marginTop: 18, padding: 14, borderRadius: 14, background: t.surface, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF3B30", animation: "nextext-pulse 1s infinite" }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>Recording… {Math.round(voiceDurMs / 1000)}s</span>
                <button onClick={stopVoiceRecording} aria-label="Stop recording" style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 10, background: t.primary, color: "#fff", border: "none", fontWeight: 700, cursor: "pointer" }}>Stop</button>
              </div>
            )}
            {postError && <div style={{ marginTop: 14, color: "#FF3B30", fontSize: 13, textAlign: "center" }}>{postError}</div>}
            <div style={{ marginTop: 18, fontSize: 11.5, color: t.textMuted, textAlign: "center" }}>Keep important content inside the frame</div>
          </div>
          <input ref={photoInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addPhotoFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
          <input ref={videoInputRef} type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) addVideoFile(f); e.target.value = ""; }} />
        </div>
      </div>
    );
  }

  // ══════════ REVIEW ══════════
  if (step === "review") {
    const summary = mode === "photo" ? `${photos.length} photo${photos.length > 1 ? "s" : ""}`
      : mode === "video" ? "1 video" : mode === "voice" ? "Voice note" : "Text";
    return (
      <div style={shell}>
        <div style={phone}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
            <button onClick={handleBack} aria-label="Back to editor" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
              <ChevronLeft size={24} color={t.text} />
            </button>
            <span style={{ fontWeight: 800, fontSize: 18 }}>Final preview</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
            <div style={{ borderRadius: 16, overflow: "hidden", background: "#000", minHeight: 220, maxHeight: 380, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              {mode === "photo" && activePhoto && (
                <img src={bakedPreview[activePhoto.id]?.url || activePhoto.url} alt="Status preview" style={{ width: "100%", maxHeight: 380, objectFit: "cover", background: "#000" }} />
              )}
              {mode === "video" && videoURL && (
                <video src={videoURL} controls playsInline style={{ width: "100%", maxHeight: 380, filter: PHOTO_FILTERS.find((f) => f.id === videoFilter)?.css || "none" }} />
              )}
              {mode === "text" && (
                <div style={{ width: "100%", minHeight: 220, background: TEXT_BG_PRESETS[bgIdx], display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                  <div style={{ color: "#fff", fontWeight: 800, fontSize: 22, textAlign: textAlign, fontFamily: (FONTS[fontIdx] || FONTS[0]).value, wordBreak: "break-word" }}>{textMode || " "}</div>
                </div>
              )}
              {mode === "voice" && (
                <div style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "#fff" }}>
                  <Mic size={36} color={t.primary} />
                  <div style={{ fontWeight: 700 }}>Voice note · {Math.round(voiceDurMs / 100) / 10}s</div>
                  {voiceURL && <audio src={voiceURL} controls style={{ width: "100%" }} />}
                </div>
              )}
              {(mode === "photo" || mode === "video") && textStickers.map((s) => (
                <div
                  key={s.id}
                  style={{
                    position: "absolute", left: `${s.x * 100}%`, top: `${s.y * 100}%`,
                    transform: `translate(-50%,-50%) rotate(${s.rotation || 0}deg)`,
                    color: s.color || "#fff", fontSize: Math.min(34, s.size || 22), opacity: s.opacity ?? 1,
                    fontWeight: 800,
                    textShadow: s.background && s.background !== "none" ? "none" : "0 1px 4px rgba(0,0,0,0.85)",
                    background: s.background && s.background !== "none" ? s.background : "transparent",
                    padding: s.background && s.background !== "none" ? "4px 10px" : "2px 6px",
                    borderRadius: 10, whiteSpace: "pre-wrap", maxWidth: "90%",
                    textAlign: s.align || "center", pointerEvents: "none", lineHeight: 1.2,
                  }}
                >{s.text}</div>
              ))}
              {renderMusicOverlay()}
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: t.textMuted, textAlign: "center" }}>{summary} · {durationSeconds}s{mode === "video" && videoDurSec ? ` · video ${videoDurSec}s` : ""}</div>
            {mode !== "video" && (
              <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: t.surface, border: `1px solid ${t.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>Status duration</span>
                  <span style={{ fontWeight: 800, color: t.primary }}>{durationSeconds}s</span>
                </div>
                <input type="range" min="1" max="15" step="1" value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} aria-label="Status duration seconds" style={{ width: "100%", accentColor: t.primary }} />
              </div>
            )}
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: t.surface, border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Who can see this?</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[{ id: "contacts", label: "My Contacts", icon: <Users size={15} /> }, { id: "public", label: "Public", icon: <Globe size={15} /> }].map((o) => (
                  <button key={o.id} onClick={() => setAudience(o.id)} aria-label={`Audience ${o.label}`} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `1.5px solid ${audience === o.id ? t.primary : t.border}`, background: audience === o.id ? t.primaryLight : "transparent", color: audience === o.id ? t.primary : t.textMuted }}>
                    {o.icon}{o.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Per-status audience exclusion */}
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: t.surface, border: `1px solid ${t.border}` }}>
              <div onClick={() => setShowExcludeList((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <EyeOff size={16} color={t.primary} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: t.text }}>
                  {excludedUids.length > 0 ? `Hidden from ${excludedUids.length} contact${excludedUids.length !== 1 ? "s" : ""}` : "Don't show to specific contacts"}
                </span>
                <span style={{ fontSize: 12, color: t.textMuted }}>{showExcludeList ? "▲" : "▼"}</span>
              </div>
              {showExcludeList && (
                <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
                  {acceptedContactsForExclude.length === 0 && (
                    <div style={{ padding: 12, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No contacts to exclude.</div>
                  )}
                  {acceptedContactsForExclude.map((c) => {
                    const isEx = excludedUids.includes(c.uid);
                    return (
                      <div key={c.uid} onClick={() => setExcludedUids((prev) => isEx ? prev.filter((u) => u !== c.uid) : [...prev, c.uid])} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                        <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={34} />
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.profile?.displayName || "Unknown"}</span>
                        <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${isEx ? "#FF3B30" : t.border}`, background: isEx ? "#FF3B30" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {isEx && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {mode === "video" && (
              <label style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: t.surface, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={waitForVideo} onChange={(e) => setWaitForVideo(e.target.checked)} style={{ width: 18, height: 18, accentColor: t.primary }} />
                Wait for video to finish before advancing
              </label>
            )}
            <ToggleRow t={t} icon={<Download size={17} color={t.primary} />} title="Allow download" sub="Let viewers save this status" value={allowDownload} onToggle={() => setAllowDownload((v) => !v)} label="allow download" />
            <ToggleRow t={t} icon={<MessageCircle size={17} color={t.primary} />} title="Hide comments" sub="Disable comments on this status" value={commentsHidden} onToggle={() => setCommentsHidden((v) => !v)} label="hide comments" />
            {postError && <div style={{ marginTop: 12, color: "#FF3B30", fontSize: 13, textAlign: "center" }}>{postError}</div>}
          </div>
          <div style={{ padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: `1px solid ${t.border}`, flexShrink: 0 }}>
            <button
              onClick={handlePost} disabled={posting || !canPost()} aria-label="Post status"
              style={{ width: "100%", padding: "14px 0", minHeight: 52, borderRadius: 14, border: "none", background: posting || !canPost() ? t.border : t.primary, color: "#fff", fontWeight: 800, fontSize: 16, cursor: posting || !canPost() ? "default" : "pointer", opacity: posting || !canPost() ? 0.6 : 1 }}
            >
              {posting ? (postProgress || "Posting…") : "Post Status"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════ EDITOR ══════════
  // Toolbar per media (spec):
  //   Photo: Text/Draw/Emoji/Music/Crop/Effects (+Voiceover — recorded/picked,
  //          uploaded at publish, attached to the first photo)
  //   Video: Text/Emoji/Music/Trim/Effects (+Voiceover extra — genuinely persisted)
  //   Text:  Text/Emoji/Background/Music (+Voiceover extra — genuinely persisted)
  // Draw is photo-only: strokes bake into the published JPEG, which is not
  // possible for video without a transcode pipeline, so it stays hidden there.
  const tools = [];
  const canUseMusic = showMusicTool && (mode === "photo" || mode === "video" || mode === "text");
  if (mode === "photo") {
    tools.push({ id: "text", label: "Text", icon: <Type size={20} /> });
    tools.push({ id: "draw", label: "Draw", icon: <PenTool size={20} /> });
    tools.push({ id: "emoji", label: "Emoji", icon: <Smile size={20} /> });
    if (canUseMusic) tools.push({ id: "music", label: "Music", icon: <Music size={20} /> });
    tools.push({ id: "crop", label: "Crop", icon: <CropIcon size={20} /> });
    tools.push({ id: "effects", label: "Effects", icon: <Sparkles size={20} /> });
    tools.push({ id: "audio", label: "Voiceover", icon: <Volume2 size={20} /> });
  } else if (mode === "video") {
    tools.push({ id: "text", label: "Text", icon: <Type size={20} /> });
    tools.push({ id: "emoji", label: "Emoji", icon: <Smile size={20} /> });
    if (canUseMusic) tools.push({ id: "music", label: "Music", icon: <Music size={20} /> });
    tools.push({ id: "trim", label: "Trim", icon: <Scissors size={20} /> });
    tools.push({ id: "effects", label: "Effects", icon: <Sparkles size={20} /> });
    tools.push({ id: "audio", label: "Voiceover", icon: <Volume2 size={20} /> });
  } else if (mode === "text") {
    tools.push({ id: "text", label: "Text", icon: <Type size={20} /> });
    tools.push({ id: "emoji", label: "Emoji", icon: <Smile size={20} /> });
    tools.push({ id: "background", label: "Background", icon: <Palette size={20} /> });
    if (canUseMusic) tools.push({ id: "music", label: "Music", icon: <Music size={20} /> });
    tools.push({ id: "audio", label: "Voiceover", icon: <Volume2 size={20} /> });
  }

  return (
    <div style={shell}>
      <div style={phone}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <button onClick={handleBack} aria-label="Back" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6 }}>
            <ChevronLeft size={24} color={t.text} />
          </button>
          <span style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>
            {mode === "photo" ? `Photo${photos.length > 1 ? ` ${Math.max(1, photos.findIndex((p) => p.id === activePhoto?.id) + 1)}/${photos.length}` : ""}` : mode === "video" ? "Video" : mode === "text" ? "Text" : "Voice"}
          </span>
          <button onClick={undo} disabled={hIdx <= 0} aria-label="Undo" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, opacity: hIdx <= 0 ? 0.35 : 1 }}>
            <Undo2 size={20} color={t.text} />
          </button>
          <button onClick={redo} disabled={hIdx >= history.length - 1} aria-label="Redo" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, opacity: hIdx >= history.length - 1 ? 0.35 : 1 }}>
            <Redo2 size={20} color={t.text} />
          </button>
          <button
            onClick={() => canPost() && !posting && setStep("review")} disabled={!canPost() || posting} aria-label="Continue to publish"
            style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: canPost() ? t.primary : t.border, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: canPost() ? "pointer" : "default", opacity: canPost() ? 1 : 0.6 }}
          >
            Next
          </button>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column" }}>
          <div
            ref={tool === "draw" ? drawBoxRef : null}
            style={{
              position: "relative", borderRadius: 18, overflow: "hidden", background: "#000",
              minHeight: 380, maxHeight: 480, display: "flex", alignItems: "center", justifyContent: "center",
              aspectRatio: mode === "photo" && (activeEdits.aspect === "freeform"
                ? (() => {
                    const w = activePhoto?.width || 1, h = activePhoto?.height || 1;
                    const sw = (activeEdits.rotate || 0) % 360 === 90 || (activeEdits.rotate || 0) % 360 === 270;
                    return sw ? h / w : w / h;
                  })()
                : activeEdits.aspect !== "original"
                  ? String(ASPECTS.find((a) => a.id === activeEdits.aspect)?.ratio || "4/5").replace("/", " / ")
                  : undefined),
              touchAction: tool === "draw" ? "none" : "pan-x pan-y",
            }}
          >
            {mode === "photo" && activePhoto && (
              <img
                src={activePhoto.url} alt="Status canvas" draggable={false}
                style={{ width: "100%", height: "100%", maxHeight: 480, objectFit: activeEdits.aspect === "freeform" || activeEdits.aspect === "original" ? "contain" : "cover", filter: liveFilterCss(), transform: `rotate(${activeEdits.rotate || 0}deg)`, pointerEvents: "none" }}
              />
            )}
            {mode === "photo" && activePhoto && tool === "crop" && activeEdits.aspect === "freeform" && <FreeformCropOverlay edits={activeEdits} onChange={(rect) => patchEdits({ cropRect: rect })} />}
            {mode === "video" && videoURL && (
              <video
                ref={videoRef} src={videoURL} playsInline controls={tool !== "draw"}
                onLoadedMetadata={() => {
                  const d = videoRef.current?.duration;
                  if (d && !videoDurSec) { const s = Math.max(1, Math.round(d)); setVideoDurSec(s); setTrimEnd(s); }
                }}
                style={{ width: "100%", maxHeight: 480, filter: PHOTO_FILTERS.find((f) => f.id === videoFilter)?.css || "" }}
              />
            )}
            {mode === "text" && (
              <div style={{ position: "absolute", inset: 0, background: TEXT_BG_PRESETS[bgIdx], display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <textarea
                  value={textMode} onChange={(e) => setTextMode(e.target.value)} placeholder="Type your status…"
                  aria-label="Status text"
                  style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 24, fontWeight: 800, textAlign: textAlign, resize: "none", fontFamily: (FONTS[fontIdx] || FONTS[0]).value, lineHeight: 1.35, caretColor: "#fff", minHeight: 160 }}
                />
              </div>
            )}
            {mode === "voice" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "#fff", padding: 32 }}>
                <Mic size={44} color={t.primary} />
                <div style={{ fontWeight: 800, fontSize: 16 }}>Voice note · {Math.round(voiceDurMs / 100) / 10}s</div>
                {voiceURL && <audio src={voiceURL} controls style={{ width: "100%" }} />}
                <input
                  value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption… (optional)"
                  aria-label="Voice caption"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, boxSizing: "border-box" }}
                />
              </div>
            )}
            {/* Stickers */}
            {(mode === "photo" || mode === "video") && textStickers.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                aria-label={`Text sticker: ${s.text}. Activate to edit.`}
                onPointerDown={(e) => onStickerDown(e, s)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveStickerId(s.id); setTool("text"); } }}
                onTouchStart={(e) => onStickerTouchStart(e, s)}
                onTouchMove={onStickerTouchMove}
                onTouchEnd={onStickerTouchEnd}
                style={{
                  position: "absolute", left: `${s.x * 100}%`, top: `${s.y * 100}%`,
                  transform: `translate(-50%,-50%) rotate(${s.rotation || 0}deg)`,
                  color: s.color, fontSize: s.size, opacity: s.opacity ?? 1,
                  fontWeight: 800,
                  textShadow: s.background && s.background !== "none" ? "none" : "0 1px 4px rgba(0,0,0,0.85)",
                  background: s.background && s.background !== "none" ? s.background : "transparent",
                  padding: s.background && s.background !== "none" ? "4px 10px" : "2px 6px",
                  borderRadius: 10,
                  whiteSpace: "pre-wrap", maxWidth: "90%", textAlign: s.align || "center",
                  cursor: "grab", lineHeight: 1.2, userSelect: "none", touchAction: "none",
                  outline: activeStickerId === s.id ? `2px dashed ${t.primary}` : "none", zIndex: 5,
                }}
              >
                {s.text}
              </div>
            ))}
            {/* Compact contextual toolbar: visible only while a sticker is selected */}
            {(mode === "photo" || mode === "video") && activeSticker && (
              <div
                role="toolbar"
                aria-label="Selected text options"
                style={{
                  position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 9,
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
                  borderRadius: 12, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
                  maxWidth: "calc(100% - 16px)",
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>
                  {(activeSticker.text || "Text").slice(0, 18)}
                </span>
                <button onClick={() => setTool("text")} aria-label="Edit selected text style" style={{ background: t.primary, border: "none", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>Style</button>
                <button onClick={() => { commitStickers(textStickers.filter((s) => s.id !== activeSticker.id)); setActiveStickerId(null); }} aria-label="Delete selected text" style={{ background: "rgba(255,59,48,0.9)", border: "none", color: "#fff", borderRadius: 8, padding: "5px 8px", cursor: "pointer", display: "flex", alignItems: "center" }}><Trash2 size={13} /></button>
                <button onClick={() => setActiveStickerId(null)} aria-label="Deselect text" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}><X size={14} color="#fff" /></button>
              </div>
            )}
            {/* Draw overlay */}
            {tool === "draw" && mode === "photo" && (
              <canvas
                ref={canvasRef}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  currentStrokeRef.current = { color: eraserOn ? "#000" : brushColor, size: brushSize, eraser: eraserOn, points: [drawPos(e)] };
                }}
                onPointerMove={(e) => {
                  if (!currentStrokeRef.current) return;
                  currentStrokeRef.current.points.push(drawPos(e));
                  redrawDrawCanvas();
                }}
                onPointerUp={() => {
                  if (currentStrokeRef.current) {
                    patchEdits({ strokes: [...(activeEdits.strokes || []), currentStrokeRef.current] });
                    if (activePhoto) {
                      strokeRedoRef.current[activePhoto.id] = [];
                      setStrokeRedoVer((v) => v + 1);
                    }
                    currentStrokeRef.current = null;
                    setTimeout(redrawDrawCanvas, 0);
                  }
                }}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair", zIndex: 6, touchAction: "none" }}
              />
            )}
            {renderMusicOverlay()}
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, textAlign: "center", marginTop: 6 }}>Keep important content inside the frame</div>

          {/* Multi-photo strip */}
          {mode === "photo" && photos.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, flex: 1, overflowX: "auto" }}>
                {photos.map((p) => (
                  <div key={p.id} onClick={() => setActivePhotoId(p.id)} style={{ position: "relative", flexShrink: 0, cursor: "pointer", borderRadius: 10, overflow: "hidden", border: p.id === activePhoto?.id ? `2.5px solid ${t.primary}` : `1px solid ${t.border}` }}>
                    <img src={p.url} alt="" style={{ width: 52, height: 52, objectFit: "cover", display: "block" }} />
                  </div>
                ))}
              </div>
              {photos.length < 6 && (
                <button onClick={() => photoInputRef.current?.click()} aria-label="Add more photos" style={{ width: 52, height: 52, borderRadius: 10, border: `1.5px dashed ${t.border}`, background: "transparent", color: t.textMuted, cursor: "pointer", flexShrink: 0, fontSize: 20 }}>+</button>
              )}
            </div>
          )}

          {/* Caption */}
          {(mode === "photo" || mode === "video") && (
            <input
              value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption… (optional)"
              aria-label="Status caption"
              style={{ marginTop: 10, width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13.5, background: t.surface, color: t.text, boxSizing: "border-box" }}
            />
          )}

          {/* Tool panels */}
          <div style={{ marginTop: 10 }}>{renderToolPanel()}</div>
          {postError && <div style={{ marginTop: 8, color: "#FF3B30", fontSize: 13, textAlign: "center" }}>{postError}</div>}
        </div>

        {/* Bottom toolbar */}
        <div role="toolbar" aria-label="Status editing tools" style={{ display: "flex", gap: 2, overflowX: "auto", flexShrink: 0, padding: "8px 10px calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${t.border}`, background: t.surface, borderRadius: "18px 18px 0 0" }}>
          {tools.map((tb) => (
            <button key={tb.id} onClick={() => setTool((cur) => (cur === tb.id ? null : tb.id))} aria-label={`${tb.label} tool`} style={toolBtn(tool === tb.id)}>
              {tb.icon}
              <span>{tb.label}</span>
            </button>
          ))}
          {tools.length === 0 && <div style={{ fontSize: 12, color: t.textMuted, padding: 8 }}>No editing tools for voice notes</div>}
        </div>

        <input ref={photoInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addPhotoFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
        <input ref={videoInputRef} type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) addVideoFile(f); e.target.value = ""; }} />
        <input ref={audioInputRef} type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setBgAudioFile(f); e.target.value = ""; }} />
        <audio ref={musicAudioRef} style={{ display: "none" }} onTimeUpdate={onMusicTime} onEnded={() => setMusicPreviewOn(false)} />

        {musicModalOpen && (
          <MusicPickerModal
            onClose={() => setMusicModalOpen(false)}
            onSelect={handleSelectMusic}
            globalSettings={globalSettings}
            userDoc={userDoc}
            t={t}
          />
        )}

        {confirmLeave && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50 }}>
            <div style={{ background: t.surface, borderRadius: 18, padding: 22, width: "100%", maxWidth: 320 }}>
              <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>Leave without posting?</div>
              <div style={{ fontSize: 13.5, color: t.textMuted, marginBottom: 18 }}>Your edits will be lost.</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setConfirmLeave(false)} aria-label="Keep editing" style={{ flex: 1, padding: "11px 0", borderRadius: 11, border: "none", background: t.primary, color: "#fff", fontWeight: 800, cursor: "pointer" }}>Keep Editing</button>
                <button onClick={() => { setConfirmLeave(false); onClose?.(); }} aria-label="Discard status" style={{ flex: 1, padding: "11px 0", borderRadius: 11, border: `1px solid ${t.border}`, background: "transparent", color: "#FF3B30", fontWeight: 800, cursor: "pointer" }}>Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Music overlay preview (compact overlay: artwork/title/artist + eq bars) ──
  function renderMusicOverlay() {
    if (!bgMusic) return null;
    const eq = (
      <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 14 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="nextext-eq-bar" style={{ width: 3, height: 12, background: "#fff", borderRadius: 2, animationDelay: `${i * 0.2}s` }} />
        ))}
      </span>
    );
    const card = {
      position: "absolute", top: 12, right: 12, left: "auto", bottom: "auto", zIndex: 8,
      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
      borderRadius: 14, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      maxWidth: "calc(100% - 24px)",
    };
    if (musicStyle === "minimal") {
      return (
        <div style={{ ...card, justifyContent: "center", gap: 6 }}>
          {eq}
          <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>♪ {bgMusic.title} · {bgMusic.artist}</span>
        </div>
      );
    }
    return (
      <div style={card}>
        {musicStyle === "artwork" && bgMusic.artwork && (
          <img src={bgMusic.artwork} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontSize: 12.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgMusic.title}</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgMusic.artist}</div>
        </div>
        {eq}
        <button onClick={(e) => { e.stopPropagation(); setBgMusic(null); setMusicPreviewOn(false); }} aria-label="Remove music" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
          <X size={15} color="#fff" />
        </button>
      </div>
    );
  }

  // ── Tool panels ──
  function renderToolPanel() {
    if (!tool) {
      // Hint must name ONLY the tools actually rendered in the bottom
      // toolbar (Music is gated on provider access, so never promise it
      // unconditionally — otherwise the hint advertises UI that isn't there).
      const names = tools.map((tb) => tb.label).join(", ");
      if (!names) return null;
      return (
        <div style={{ fontSize: 12, color: t.textMuted, textAlign: "center", padding: "2px 4px" }}>
          Use the toolbar below — {names} — to style your status.
        </div>
      );
    }
    const panel = { padding: 12, borderRadius: 14, background: t.surface, border: `1px solid ${t.border}` };
    if (tool === "text") {
      // Text mode has no canvas sticker layer — style the message itself.
      if (mode === "text") {
        return (
          <div style={panel}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Text style</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Font</div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10 }}>
              {FONTS.map((f, i) => (
                <div key={f.id} onClick={() => setFontIdx(i)} style={{ padding: "6px 12px", borderRadius: 10, background: i === fontIdx ? t.primary : t.bg, border: `1px solid ${t.border}`, color: i === fontIdx ? "#fff" : t.textMuted, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: f.value }}>{f.label}</div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["left", "center", "right"].map((a) => (
                <button key={a} onClick={() => setTextAlign(a)} aria-label={`Align ${a}`} style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1px solid ${a === textAlign ? t.primary : t.border}`, background: a === textAlign ? t.primaryLight : "transparent", color: a === textAlign ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12.5, cursor: "pointer", textTransform: "capitalize" }}>{a}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>Type directly on the canvas above. Pick a Background for color themes.</div>
          </div>
        );
      }
      return (
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Text</span>
            <button onClick={() => addTextSticker()} aria-label="Add text" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 9, border: "none", background: t.primary, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}><Plus size={14} /> Add</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {TEXT_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPresetId(p.id);
                  if (activeSticker) commitStickerUpdate(activeSticker.id, { color: p.color, size: p.size, preset: p.id });
                }}
                aria-label={`Preset ${p.label}${activeSticker ? ", apply to selected text" : ""}`}
                style={{ padding: "6px 12px", borderRadius: 9, border: `1.5px solid ${(activeSticker ? activeSticker.preset : presetId) === p.id ? t.primary : t.border}`, background: (activeSticker ? activeSticker.preset : presetId) === p.id ? t.primaryLight : "transparent", color: (activeSticker ? activeSticker.preset : presetId) === p.id ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
              >{p.label}</button>
            ))}
          </div>
          {activeSticker ? (
            <div>
              <input
                value={activeSticker.text} onChange={(e) => updateSticker(activeSticker.id, { text: e.target.value })}
                onBlur={() => commitStickerUpdate(activeSticker.id, { text: activeSticker.text })}
                placeholder="Sticker text…" aria-label="Sticker text"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13.5, background: t.bg, color: t.text, boxSizing: "border-box", marginBottom: 10 }}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {STICKER_COLORS.map((c) => (
                  <div key={c} onClick={() => commitStickerUpdate(activeSticker.id, { color: c })} aria-label={`Sticker color ${c}`} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: activeSticker.color === c ? `3px solid ${t.primary}` : "2px solid transparent", cursor: "pointer" }} />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Minus size={15} color={t.textMuted} />
                <input type="range" min="12" max="64" step="1" value={activeSticker.size} onChange={(e) => updateSticker(activeSticker.id, { size: Number(e.target.value) })} onMouseUp={() => commitStickerUpdate(activeSticker.id, { size: activeSticker.size })} onTouchEnd={() => commitStickerUpdate(activeSticker.id, { size: activeSticker.size })} aria-label="Sticker size" style={{ flex: 1, accentColor: t.primary }} />
                <Plus size={15} color={t.textMuted} />
                <span style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, width: 30 }}>{activeSticker.size}</span>
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Highlight background</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {STICKER_BGS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => commitStickerUpdate(activeSticker.id, { background: b.css === "none" ? "none" : b.css })}
                    aria-label={`Sticker background ${b.label}`}
                    title={b.label}
                    style={{
                      minWidth: 34, height: 26, borderRadius: 8, cursor: "pointer",
                      background: b.css === "none" ? "transparent" : b.css,
                      border: (activeSticker.background || "none") === (b.css === "none" ? "none" : b.css) ? `2.5px solid ${t.primary}` : `1px solid ${t.border}`,
                      color: b.id === "light" || b.id === "none" ? t.textMuted : "#fff",
                      fontSize: 10, fontWeight: 800,
                    }}
                  >{b.id === "none" ? "∅" : "Ag"}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <RotateCw size={15} color={t.textMuted} />
                <input type="range" min="-180" max="180" step="1" value={activeSticker.rotation || 0} onChange={(e) => updateSticker(activeSticker.id, { rotation: Number(e.target.value) })} onMouseUp={() => commitStickerUpdate(activeSticker.id, { rotation: activeSticker.rotation || 0 })} onTouchEnd={() => commitStickerUpdate(activeSticker.id, { rotation: activeSticker.rotation || 0 })} aria-label="Sticker rotation degrees" style={{ flex: 1, accentColor: t.primary }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, width: 40 }}>{activeSticker.rotation || 0}°</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: t.textMuted, width: 52 }}>Opacity</span>
                <input type="range" min="20" max="100" step="5" value={Math.round((activeSticker.opacity ?? 1) * 100)} onChange={(e) => updateSticker(activeSticker.id, { opacity: Number(e.target.value) / 100 })} onMouseUp={() => commitStickerUpdate(activeSticker.id, { opacity: activeSticker.opacity ?? 1 })} onTouchEnd={() => commitStickerUpdate(activeSticker.id, { opacity: activeSticker.opacity ?? 1 })} aria-label="Sticker opacity" style={{ flex: 1, accentColor: t.primary }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, width: 40 }}>{Math.round((activeSticker.opacity ?? 1) * 100)}%</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {["left", "center", "right"].map((a) => (
                  <button key={a} onClick={() => commitStickerUpdate(activeSticker.id, { align: a })} aria-label={`Sticker align ${a}`} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${(activeSticker.align || "center") === a ? t.primary : t.border}`, background: (activeSticker.align || "center") === a ? t.primaryLight : "transparent", color: (activeSticker.align || "center") === a ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>{a}</button>
                ))}
              </div>
              <button onClick={() => { commitStickers(textStickers.filter((s) => s.id !== activeSticker.id)); setActiveStickerId(null); }} aria-label="Delete sticker" style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "none", background: "rgba(255,59,48,0.15)", color: "#FF3B30", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}><Trash2 size={14} /> Delete</button>
              <div style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>Drag the text on the canvas to reposition it.</div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: t.textMuted }}>Tap Add, then tap a sticker on the canvas to edit it.</div>
          )}
        </div>
      );
    }
    if (tool === "emoji") {
      return (
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Emoji</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4 }}>
            {EMOJI_GRID.map((em) => (
              <button key={em} onClick={() => addTextSticker(em)} aria-label={`Add emoji ${em}`} style={{ fontSize: 24, padding: 6, background: "transparent", border: "none", cursor: "pointer", borderRadius: 8 }}>{em}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>{mode === "text" ? "Emoji are appended to your message." : "Emoji are added as draggable, resizable canvas text."}</div>
        </div>
      );
    }
    if (tool === "draw") {
      return (
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Draw (baked into photo)</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={undoStroke} disabled={!(activeEdits.strokes || []).length} aria-label="Undo stroke" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: (activeEdits.strokes || []).length ? 1 : 0.4 }}>Undo</button>
              <button onClick={redoStroke} disabled={!(activePhoto && (strokeRedoRef.current[activePhoto.id] || []).length)} aria-label="Redo stroke" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: activePhoto && (strokeRedoRef.current[activePhoto.id] || []).length ? 1 : 0.4 }}>Redo</button>
              <button onClick={clearStrokes} aria-label="Clear drawing" style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "rgba(255,59,48,0.15)", color: "#FF3B30", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Clear</button>
              <button onClick={() => setTool(null)} aria-label="Done drawing" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}><Check size={14} /> Done</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {STICKER_COLORS.map((c) => (
              <div key={c} onClick={() => { setBrushColor(c); setEraserOn(false); }} aria-label={`Brush color ${c}`} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: !eraserOn && brushColor === c ? `3px solid ${t.primary}` : "2px solid transparent", cursor: "pointer", opacity: eraserOn ? 0.4 : 1 }} />
            ))}
            <button onClick={() => setEraserOn((v) => !v)} aria-label="Toggle eraser" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 8, border: `1.5px solid ${eraserOn ? t.primary : t.border}`, background: eraserOn ? t.primaryLight : "transparent", color: eraserOn ? t.primary : t.textMuted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}><Eraser size={14} /> Eraser</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: t.textMuted }}>Size</span>
            <input type="range" min="2" max="24" step="1" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} aria-label="Brush size" style={{ flex: 1, accentColor: t.primary }} />
          </div>
        </div>
      );
    }
    if (tool === "effects") {
      // Video filters are stored as videoFilter metadata and applied by the
      // viewer; photo filters/adjustments are baked into the JPEG at publish.
      if (mode === "video") {
        return (
          <div style={panel}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Effects (stored, applied on playback)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PHOTO_FILTERS.map((f) => (
                <button key={f.id} onClick={() => setVideoFilter(f.id)} aria-label={`Video filter ${f.label}`} style={{ padding: "6px 12px", borderRadius: 9, border: `1.5px solid ${videoFilter === f.id ? t.primary : t.border}`, background: videoFilter === f.id ? t.primaryLight : "transparent", color: videoFilter === f.id ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{f.label}</button>
              ))}
            </div>
          </div>
        );
      }
      return (
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Effects (baked at publish)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {PHOTO_FILTERS.map((f) => (
              <button key={f.id} onClick={() => patchEdits({ filter: f.id })} aria-label={`Filter ${f.label}`} style={{ padding: "6px 12px", borderRadius: 9, border: `1.5px solid ${activeEdits.filter === f.id ? t.primary : t.border}`, background: activeEdits.filter === f.id ? t.primaryLight : "transparent", color: activeEdits.filter === f.id ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{f.label}</button>
            ))}
          </div>
          {[["Brightness", "bright", activeEdits.bright ?? 1, 0.5, 1.5], ["Contrast", "contrast", activeEdits.contrast ?? 1, 0.5, 1.5], ["Saturation", "sat", activeEdits.sat ?? 1, 0, 2]].map(([label, key, val, min, max]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: t.textMuted, width: 70 }}>{label}</span>
              <input type="range" min={min} max={max} step="0.05" value={val} onChange={(e) => patchEdits({ [key]: Number(e.target.value) })} aria-label={label} style={{ flex: 1, accentColor: t.primary }} />
            </div>
          ))}
        </div>
      );
    }
    if (tool === "crop") {
      const rotations = [0, 90, 180, 270];
      return (
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Crop & Rotate (baked at publish)</div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Aspect</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {ASPECTS.map((a) => (
              <button key={a.id} onClick={() => {
                // Selecting "Free" seeds a sensible default crop rectangle so the
                // freeform box is immediately real and baked at publish (otherwise a
                // user who just taps "Free" and posts would get the full, uncropped
                // image because bakePhoto only crops when a cropRect exists).
                const patch = { aspect: a.id };
                if (a.id === "freeform" && !(activeEdits.cropRect && activeEdits.cropRect.w > 0.01)) {
                  patch.cropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
                }
                patchEdits(patch);
              }} aria-label={`Aspect ${a.label}`} style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1.5px solid ${activeEdits.aspect === a.id ? t.primary : t.border}`, background: activeEdits.aspect === a.id ? t.primaryLight : "transparent", color: activeEdits.aspect === a.id ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{a.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Rotate</div>
          <div style={{ display: "flex", gap: 6 }}>
            {rotations.map((r) => (
              <button key={r} onClick={() => patchEdits({ rotate: r })} aria-label={`Rotate ${r} degrees`} style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1.5px solid ${(activeEdits.rotate || 0) === r ? t.primary : t.border}`, background: (activeEdits.rotate || 0) === r ? t.primaryLight : "transparent", color: (activeEdits.rotate || 0) === r ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{r}°</button>
            ))}
          </div>
        </div>
      );
    }
    if (tool === "trim") {
      const max = Math.max(1, videoDurSec || 1);
      return (
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Trim &amp; Split</div>
          <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 8 }}>Start {trimStart.toFixed(1)}s · End {trimEnd.toFixed(1)}s of {max}s — the posted clip is actually trimmed on the server.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: t.textMuted, width: 40 }}>Start</span>
            <input type="range" min="0" max={Math.max(0, max - 1)} step="0.5" value={Math.min(trimStart, Math.max(0, max - 1))} onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 1))} aria-label="Trim start" style={{ flex: 1, accentColor: t.primary }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: t.textMuted, width: 40 }}>End</span>
            <input type="range" min="1" max={max} step="0.5" value={Math.max(trimEnd, 1)} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 1))} aria-label="Trim end" style={{ flex: 1, accentColor: t.primary }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <button onClick={() => setMuteOriginal((v) => !v)} aria-label={muteOriginal ? "Unmute video" : "Mute video"} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: `1.5px solid ${muteOriginal ? t.primary : t.border}`, background: muteOriginal ? t.primaryLight : "transparent", color: muteOriginal ? t.primary : t.text, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {muteOriginal ? <VolumeX size={15} /> : <Volume2 size={15} />} {muteOriginal ? "Muted" : "Sound on"}
            </button>
            {!muteOriginal && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <input type="range" min="0" max="100" step="5" value={videoVolume} onChange={(e) => setVideoVolume(Number(e.target.value))} aria-label="Video volume" style={{ flex: 1, accentColor: t.primary }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: t.primary }}>{videoVolume}%</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, marginTop: 8 }}>Video filter</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PHOTO_FILTERS.map((f) => (
              <button key={f.id} onClick={() => setVideoFilter(f.id)} aria-label={`Video filter ${f.label}`} style={{ padding: "6px 12px", borderRadius: 9, border: `1.5px solid ${videoFilter === f.id ? t.primary : t.border}`, background: videoFilter === f.id ? t.primaryLight : "transparent", color: videoFilter === f.id ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{f.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, marginTop: 10 }}>Split into parts (each a separate, trimmed clip)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setSplitParts(n)} aria-label={`Split into ${n} parts`} style={{ padding: "6px 14px", borderRadius: 9, border: `1.5px solid ${splitParts === n ? t.primary : t.border}`, background: splitParts === n ? t.primaryLight : "transparent", color: splitParts === n ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{n === 1 ? "No split" : `${n} parts`}</button>
            ))}
          </div>
        </div>
      );
    }
    if (tool === "background") {
      return (
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Background</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {TEXT_BG_PRESETS.map((c, i) => (
              <div key={i} onClick={() => setBgIdx(i)} role="button" tabIndex={0} aria-label={`Background ${i + 1}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBgIdx(i); } }} style={{ width: 30, height: 30, borderRadius: "50%", background: c, border: bgIdx === i ? `3px solid ${t.primary}` : `1px solid ${t.border}`, cursor: "pointer" }} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Font</div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {FONTS.map((f, i) => (
              <div key={f.id} onClick={() => setFontIdx(i)} style={{ padding: "6px 12px", borderRadius: 10, background: i === fontIdx ? t.primary : t.bg, border: `1px solid ${t.border}`, color: i === fontIdx ? "#fff" : t.textMuted, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: f.value }}>{f.label}</div>
            ))}
          </div>
        </div>
      );
    }
    if (tool === "music") {
      const caps = musicCaps;
      const provider = bgMusic?.provider || musicProviderActive;
      const seg = bgMusic ? clampSegment(provider, bgMusic.start, bgMusic.end, bgMusic.durationSec) : { start: 0, end: 30, maxSeg: 30 };
      return (
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Background Music (metadata only)</span>
            {!bgMusic && (
              <button onClick={() => setMusicModalOpen(true)} aria-label="Pick music" style={{ padding: "6px 12px", borderRadius: 9, border: "none", background: t.primary, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Pick</button>
            )}
          </div>
          {!bgMusic && <div style={{ fontSize: 12, color: t.textMuted }}>Streams from the source on viewer devices. Nothing is uploaded. {caps.seekLabel}</div>}
          {bgMusic && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                {bgMusic.artwork
                  ? <img src={bgMusic.artwork} alt="" style={{ width: 44, height: 44, borderRadius: 9, objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 9, background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: t.primary }}>{(bgMusic.title || "?")[0]}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgMusic.title}</div>
                  <div style={{ fontSize: 12, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgMusic.artist}</div>
                </div>
                <button onClick={toggleMusicPreview} aria-label={musicPreviewOn ? "Stop music preview" : "Play music preview from start"} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  {musicPreviewOn ? <Pause size={16} color="#fff" /> : <Play size={16} color="#fff" />}
                </button>
                <button onClick={() => { setBgMusic(null); setMusicPreviewOn(false); }} aria-label="Remove music" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}><X size={16} color={t.textMuted} /></button>
              </div>
              <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4 }}>Segment {Math.round(bgMusic.start)}s – {Math.round(bgMusic.end)}s (max {Math.round(seg.maxSeg)}s) · {caps.seekLabel}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: t.textMuted, width: 40 }}>Start</span>
                <input type="range" min="0" max={Math.max(1, seg.maxSeg - 1)} step="1" value={Math.min(bgMusic.start, seg.maxSeg - 1)} onChange={(e) => onSegChange("start", Number(e.target.value))} aria-label="Music segment start" style={{ flex: 1, accentColor: t.primary }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: t.textMuted, width: 40 }}>End</span>
                <input type="range" min="1" max={seg.maxSeg} step="1" value={bgMusic.end} onChange={(e) => onSegChange("end", Number(e.target.value))} aria-label="Music segment end" style={{ flex: 1, accentColor: t.primary }} />
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Overlay style</div>
              <div style={{ display: "flex", gap: 6 }}>
                {MUSIC_OVERLAY_STYLES.map((s) => (
                  <button key={s.id} onClick={() => setMusicStyle(s.id)} aria-label={`Music overlay ${s.label}`} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1.5px solid ${musicStyle === s.id ? t.primary : t.border}`, background: musicStyle === s.id ? t.primaryLight : "transparent", color: musicStyle === s.id ? t.primary : t.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    if (tool === "audio") {
      return (
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: bgAudioFile || isVoRecording ? 8 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Voiceover audio</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={startVoRecord} aria-label={isVoRecording ? "Stop voiceover recording" : "Record voiceover"} style={{ padding: "6px 12px", borderRadius: 9, border: "none", background: isVoRecording ? "#FF3B30" : t.primary, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                {isVoRecording ? "● Stop" : "● Record"}
              </button>
              <button onClick={() => audioInputRef.current?.click()} aria-label="Choose voiceover audio" style={{ padding: "6px 12px", borderRadius: 9, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                {bgAudioFile ? "Replace" : "Choose file"}
              </button>
            </div>
          </div>
          {isVoRecording && <div style={{ fontSize: 12, color: "#FF3B30", fontWeight: 700, marginBottom: 6 }}>Recording… tap Stop when done.</div>}
          {bgAudioFile && voPreviewUrl && (
            <div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgAudioFile.name}</div>
              <audio controls src={voPreviewUrl} style={{ width: "100%", height: 32, marginBottom: 6 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: t.textMuted }}>Volume</span>
                <input type="range" min="0" max="100" step="5" value={bgAudioVolume} onChange={(e) => setBgAudioVolume(Number(e.target.value))} aria-label="Voiceover volume" style={{ flex: 1, accentColor: t.primary }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: t.primary }}>{bgAudioVolume}%</span>
              </div>
              <button onClick={() => setBgAudioFile(null)} aria-label="Delete voiceover" style={{ fontSize: 12, color: "#FF3B30", fontWeight: 700, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Delete voiceover</button>
            </div>
          )}
          {!bgAudioFile && !isVoRecording && <div style={{ fontSize: 12, color: t.textMuted }}>Record a voice note or pick an audio file — it plays over this status (uploaded at publish as bgAudioURL).</div>}
        </div>
      );
    }
    return null;
  }

  function ToggleRow({ t: th, icon, title, sub, value, onToggle, label }) {
    return (
      <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: th.surface, border: `1px solid ${th.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {icon}
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
            <div style={{ fontSize: 11.5, color: th.textMuted }}>{sub}</div>
          </div>
        </div>
        <button
          onClick={onToggle} aria-label={value ? `Disable ${label}` : `Enable ${label}`}
          style={{ width: 46, height: 26, borderRadius: 13, border: "none", background: value ? th.primary : th.border, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.15s ease" }}
        >
          <span style={{ position: "absolute", top: 3, left: value ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
        </button>
      </div>
    );
  }
}
