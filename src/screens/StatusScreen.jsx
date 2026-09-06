import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Plus, Camera, X, Video, Type, Palette, Eye, Trash2, Play, Pause, RefreshCw, Mic, MessageCircle, Download, Globe, Search, Music } from "lucide-react";
import { useTheme, FONTS } from "../theme/ThemeContext";
import { postStatus, useStatuses, usePublicStatuses, viewStatus, useStatusViewers, deleteStatus, updateStatusVisibility } from "../firebase/status";
import { useSystemConfigHook } from "../firebase/ai";
import { checkStatusAllowed, recordStatusUsage } from "../firebase/limits";
import { useContacts, getContactDisplayName } from "../firebase/contacts";
import { useChats, getOrCreateDirectChat, sendMediaMessage } from "../firebase/chats";
import { uploadChatFile, getSignedUrl } from "../supabase/media";
import { uploadMediaFile, RawFileTooLargeError } from "../services/mediaUpload";
import { NativeCameraSheet } from "../components/NativeCameraLauncher";
import { doc, onSnapshot, updateDoc, setDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { Capacitor } from "@capacitor/core";
import Avatar from "../components/Avatar";
import StatusStoryViewer from "./StatusStoryViewer";
import { getMicrophoneStream } from "../media/microphone";
import { base64ToBlob } from "../media/base64";
import { useGlobalSettings } from "../firebase/config-settings";
import { getActiveProvider, resolveMusicAccess, resolveAllowUserProviderChoice, resolveSelectableProviders, searchMusic, getPreviewUrl, resolveDownload } from "../media/musicService";
import { fetchTrackBlob } from "../media/musicCatalog";
import { getProxyMediaUrl, getVideoPosterUrl } from "../media/mediaProxy";
import JewishStatusesTab from "../features/jewishStatus/JewishStatusesTab";

// Resolve the thumbnail shown in the status feed for a video item. Prefers a
// generated poster; when none exists, derive a Cloudinary still-frame poster from
// the video so the feed never renders blank.
function statusPosterSrc(item) {
  if (!item) return "";
  if (item.posterURL) return getProxyMediaUrl(item.posterURL, "image");
  if (item.mediaURL) return getVideoPosterUrl(item.mediaURL);
  return "";
}

// Status thumbnail for the feed. Resolves the video's poster asynchronously
// (including Supabase pipeline objects) so EVERY viewer — not just the poster —
// sees the admin-chosen preview: a static picture when the admin setting is
// "static_picture" (the default), or a looping video preview when it is
// "video_loop". Without this, pipeline statuses (which have no mediaURL) showed
// a blank tile or fell back to the video for non-owners.
function StatusThumb({ item, forceStaticPreview, showThumbs = true, style = {} }) {
  const [poster, setPoster] = useState(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!showThumbs) { setPoster(null); setPreview(null); return; }
      if (item?.posterURL) { live && setPoster(getProxyMediaUrl(item.posterURL, "image")); }
      else if (item?.posterPath) { try { live && setPoster(await getSignedUrl(item.posterPath, item.expiresAt)); } catch {} }
      // Prefer the already-uploaded static client-side thumbnail — this avoids
      // minting a fresh Cloudinary fetch transform (credit cost) on every render.
      else if (item?.thumbnailURL) { live && setPoster(getProxyMediaUrl(item.thumbnailURL, "image")); }
      else if (item?.mediaURL) { live && setPoster(getVideoPosterUrl(item.mediaURL)); }
      if (item?.previewURL) { live && setPreview(getProxyMediaUrl(item.previewURL, "video")); }
      else if (item?.previewPath) { try { live && setPreview(await getSignedUrl(item.previewPath, item.expiresAt)); } catch {} }
    })();
    return () => { live = false; };
  }, [item?.id, item?.posterURL, item?.posterPath, item?.thumbnailURL, item?.mediaURL, item?.expiresAt, item?.previewURL, item?.previewPath, showThumbs]);

  // Admin turned off video thumbnails: render a blank placeholder, never the
  // heavy video stream.
  if (!showThumbs) {
    return <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a2a2e,#1a1a1d)", ...style }} />;
  }
  if (forceStaticPreview) {
    return <img src={poster || undefined} alt="" style={style} />;
  }
  const vid = preview || (item?.previewURL ? getProxyMediaUrl(item.previewURL, "video") : item?.mediaURL ? getProxyMediaUrl(item.mediaURL, "video") : undefined);
  return <video src={vid || undefined} poster={poster || undefined} muted autoPlay loop playsInline preload="metadata" style={style} />;
}

// Pick the best status to show as a static preview: prefer an image, or a video
// that already has a poster/thumbnail; fall back to the latest item. Used so
// list/rows modes don't render a blank card when the newest status is a video
// whose thumbnail couldn't be generated.
function pickPreviewItem(items) {
  if (!items || !items.length) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.mediaType === "image" && it.mediaURL) return it;
    if (it.mediaType === "video" && (it.posterURL || it.thumbnailURL || it.previewURL)) return it;
  }
  return items[items.length - 1];
}

// Camera preview / capture effect filters (CSS filter strings). Applied live to
// the preview and baked into captured photos via canvas ctx.filter.
const CAMERA_FILTERS = [
  { id: "none", label: "None", css: "" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.05)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.85)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.8) contrast(1.1)" },
  { id: "cool", label: "Cool", css: "hue-rotate(180deg) saturate(1.2)" },
  { id: "warm", label: "Warm", css: "sepia(0.35) saturate(1.4) hue-rotate(-15deg)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.6) brightness(0.9)" },
  { id: "fade", label: "Fade", css: "contrast(0.85) brightness(1.1) sepia(0.2)" },
  { id: "vintage", label: "Vintage", css: "sepia(0.55) contrast(1.2) saturate(1.3) brightness(1.05)" },
  { id: "cool2", label: "Icy", css: "hue-rotate(200deg) saturate(1.5) brightness(1.05)" },
  { id: "warm2", label: "Sunset", css: "sepia(0.4) saturate(1.6) hue-rotate(-25deg) brightness(1.05)" },
  { id: "pop", label: "Pop", css: "saturate(2) contrast(1.3)" },
  { id: "blur", label: "Dream", css: "blur(1.5px) brightness(1.05)" },
  { id: "invert", label: "Negative", css: "invert(1) hue-rotate(180deg)" },
  { id: "bw", label: "B&W", css: "grayscale(1) brightness(1.1)" },
];

const VIEWED_KEY = "nextext_status_viewed";

function SegmentedRing({ count, allViewed, size, gap = 4 }) {
  if (count <= 0) return null;
  const r = (size / 2) - 2;
  const circumference = 2 * Math.PI * r;
  const segLen = (circumference - gap * count) / count;
  const color = allViewed ? "rgba(255,255,255,0.25)" : "#00A884";
  return (
    <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => (
        <circle
          key={i}
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={`${segLen} ${circumference - segLen}`}
          strokeDashoffset={-i * (segLen + gap)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ))}
    </svg>
  );
}

const STATUS_BG_COLORS = [
  "#00A884", "#1FA855", "#53BDEB", "#7C5CFF",
  "#D98A9A", "#FF6B5B", "#E8A33D", "#FF7A45",
  "#B784E0", "#4C8DFF", "#000000", "#1F2C33",
  "#2D3B45", "#0B141A", "#1E1B2E", "#3A2218",
];

function getStoredViewed() {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const now = Date.now();
    const cleaned = {};
    for (const [uid, ts] of Object.entries(obj)) {
      if (now - ts < 24 * 60 * 60 * 1000) cleaned[uid] = ts;
    }
    return cleaned;
  } catch { return {}; }
}

function markViewed(uid) {
  const viewed = getStoredViewed();
  viewed[uid] = Date.now();
  localStorage.setItem(VIEWED_KEY, JSON.stringify(viewed));
}

// Per-status viewed IDs so re-opening a story starts at the first unseen update.
const STATUS_VIEWED_IDS_KEY = "nextext_status_viewed_ids";
function getViewedIds() {
  try { return new Set(JSON.parse(localStorage.getItem(STATUS_VIEWED_IDS_KEY) || "[]")); } catch { return new Set(); }
}
function markStatusViewed(id) {
  if (!id) return;
  try { const s = getViewedIds(); s.add(id); localStorage.setItem(STATUS_VIEWED_IDS_KEY, JSON.stringify([...s])); } catch {}
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { v.src = URL.revokeObjectURL(v.src); resolve(Math.ceil(v.duration * 1000)); };
    v.onerror = () => resolve(VIDEO_DURATIONS_MS);
    v.src = URL.createObjectURL(file);
  });
}

const VIDEO_DURATIONS_MS = 10000;

function SlideViewerCount({ statusId, t, onClickEye }) {
  const viewers = useStatusViewers(statusId);
  return (
    <div onClick={(e) => { e.stopPropagation(); onClickEye(statusId); }} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", padding: "2px 6px", borderRadius: 8, background: "rgba(0,0,0,0.06)" }}>
      <Eye size={12} color={t.textMuted} />
      <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 600 }}>{viewers.length}</span>
    </div>
  );
}

function StatusViewerModal({ statusId, contacts, onClose, t }) {
  const viewers = useStatusViewers(statusId);
  const extraProfiles = {};

  const resolveProfile = (uid) => {
    const c = contacts?.find((ct) => ct.uid === uid);
    if (c?.profile) return c.profile;
    if (extraProfiles[uid]) return extraProfiles[uid];
    return null;
  };
  const resolveName = (uid) => resolveProfile(uid)?.displayName || uid?.slice(0, 8) || "Unknown";
  const resolvePhoto = (uid) => resolveProfile(uid)?.photoURL || null;

  const timeAgo = (ts) => {
    if (!ts?.toDate) return "";
    const mins = Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div onClick={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: 16, width: "100%", maxWidth: 320, maxHeight: "70%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Eye size={18} color={t.primary} style={{ marginRight: 8 }} />
            <span style={{ fontWeight: 700, fontSize: 16, color: t.text, flex: 1 }}>Viewers ({viewers.length})</span>
          </div>
          <div onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", border: `1.5px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={16} color={t.textMuted} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {viewers.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No views yet</div>
          )}
          {viewers.map((v) => (
            <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
              <Avatar photoURL={resolvePhoto(v.viewerUid)} name={resolveName(v.viewerUid)} uid={v.viewerUid} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{resolveName(v.viewerUid)}</div>
                <div style={{ fontSize: 11.5, color: t.textMuted }}>{timeAgo(v.viewedAt)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function StatusScreen({ myUid, myName, myPhoto, onBack, onStoryViewerChange, initialViewStatuses, statusOrigin, onConsumeInitialView }) {
  const { t } = useTheme();
  const { contacts } = useContacts(myUid);
  const sysConfig = useSystemConfigHook();
  const globalSettings = useGlobalSettings();
  const hideStatusCamera = globalSettings?.hideStatusCamera === true;
  const hideStatusVoiceNote = globalSettings?.hideStatusVoiceNote === true;
  // Admin-controlled preview mode: 'static_picture' (default) shows poster JPEGs;
  // 'video_loop' shows lightweight animated preview clips.
  const statusPreviewMode = globalSettings?.status_preview_mode || "static_picture";
  const forceStaticPreview = statusPreviewMode !== "video_loop";
  // Admin can globally disable video thumbnails in the feed (shows a blank
  // placeholder instead of the heavy video stream). Defaults to ON.
  const showVideoThumbs = globalSettings?.show_video_thumbnails !== false;
  // Live snapshot of this user's own doc (for per-user feature overrides).
  const [myUserDoc, setMyUserDoc] = useState(null);
  // Active music provider + whether this account may use it (drives the Add Music
  // button visibility and the composer's provider label).
  const musicProviderActive = getActiveProvider(globalSettings);
  const musicAccessAllowed = resolveMusicAccess(globalSettings, myUserDoc);
  // Jewish Statuses tab visibility (mirrors the admin + per-user override logic).
  const jsSettings = globalSettings?.jewishStatuses || {};
  const jsEnabled = jsSettings.enabled === true;
  const jsOverride = myUserDoc?.jewishStatusesOverride || "inherit";
  const jewishVisible = jsOverride === "enabled" || (jsOverride !== "disabled" && jsEnabled);
  const [blockStatus, setBlockStatus] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myDisplayName, setMyDisplayName] = useState(myName);
  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      setBlockStatus(!!snap.data()?.restrictions?.blockStatus);
      setIsAdmin(snap.data()?.role === "admin");
    });
    return unsub;
  }, [myUid]);
  // Status look is a PER-USER preference (the admin can no longer force a layout
  // onto everyone). Persisted to the user's profile and localStorage so it sticks.
  const [statusLayout, setStatusLayout] = useState(() => localStorage.getItem("nextext_status_layout") || "cards");
  const [statusPreviewSize, setStatusPreviewSize] = useState(() => localStorage.getItem("nextext_status_preview_size") || "compact");
  const [statusTab, setStatusTab] = useState("updates"); // "updates" | "public"
  const [publicInfo, setPublicInfo] = useState(false);
  const [postPublic, setPostPublic] = useState(false);
  const [userStatusVisibility, setUserStatusVisibility] = useState("contacts");
  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      const d = snap.data();
      setBlockStatus(!!d?.restrictions?.blockStatus);
      setIsAdmin(d?.role === "admin");
      if (d?.statusLayout) { setStatusLayout(d.statusLayout); try { localStorage.setItem("nextext_status_layout", d.statusLayout); } catch {} }
      if (d?.statusPreviewSize) { setStatusPreviewSize(d.statusPreviewSize); try { localStorage.setItem("nextext_status_preview_size", d.statusPreviewSize); } catch {} }
      if (d?.statusVisibility) setUserStatusVisibility(d.statusVisibility);
      if (d?.displayName || d?.username) setMyDisplayName(d.displayName || d.username || myUid);
      setMyUserDoc(d);
    });
    return unsub;
  }, [myUid]);
  const changeStatusLayout = (l) => {
    setStatusLayout(l);
    try { localStorage.setItem("nextext_status_layout", l); } catch {}
    if (myUid) setDoc(doc(db, "users", myUid), { statusLayout: l }, { merge: true }).catch(() => {});
  };
  const changeStatusPreviewSize = (s) => {
    setStatusPreviewSize(s);
    try { localStorage.setItem("nextext_status_preview_size", s); } catch {}
    if (myUid) setDoc(doc(db, "users", myUid), { statusPreviewSize: s }, { merge: true }).catch(() => {});
  };
  const [showPost, setShowPost] = useState(false);
  const [postText, setPostText] = useState("");
  const [postMedia, setPostMedia] = useState(null);
  const [postMediaType, setPostMediaType] = useState(null);
  const [bgColorIdx, setBgColorIdx] = useState(0);
  const [fontIdx, setFontIdx] = useState(0);
  const [postMode, setPostMode] = useState("text");
  // Device "Share to NexText" → open the status composer prefilled with the
  // shared text when the Status tab mounts.
  useEffect(() => {
    try {
      const p = window.__nextextStatusPrefill;
      if (p && p.text) {
        setPostMode("text");
        setPostText(p.text);
        setShowPost(true);
        window.__nextextStatusPrefill = "";
      }
    } catch { /* no prefill */ }
  }, []);
  const [posting, setPosting] = useState(false);
  const [viewStoryOwner, setViewStoryOwner] = useState(null);
  const [viewedMap, setViewedMap] = useState(() => getStoredViewed());
  const [showCamera, setShowCamera] = useState(false);
  const [showNativeCamera, setShowNativeCamera] = useState(false);
  const { chats } = useChats(myUid);
  const [cameraError, setCameraError] = useState("");
  const [postError, setPostError] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [waitForVideo, setWaitForVideo] = useState(false);
  const [textOverlay, setTextOverlay] = useState("");
  // Movable, colored text stickers drawn over image/video statuses.
  const [textStickers, setTextStickers] = useState([]); // {id, text, x, y, color, size}
  const [activeStickerId, setActiveStickerId] = useState(null);
  const STICKER_COLORS = ["#FFFFFF", "#000000", "#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#30B0C7", "#007AFF", "#AF52DE", "#FF2D55"];
  const addTextSticker = () => {
    const id = `st_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTextStickers((prev) => [...prev, { id, text: "Tap to edit", x: 0.5, y: 0.4, color: "#FFFFFF", size: 22 }]);
    setActiveStickerId(id);
  };
  const updateSticker = (id, patch) => setTextStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSticker = (id) => { setTextStickers((prev) => prev.filter((s) => s.id !== id)); setActiveStickerId((cur) => (cur === id ? null : cur)); };
  const [bgAudioFile, setBgAudioFile] = useState(null);
  const [bgMusic, setBgMusic] = useState(null);
  const [musicModalOpen, setMusicModalOpen] = useState(false);
  const bgMusicChipAudioRef = useRef(null);
  const [bgAudioVolume, setBgAudioVolume] = useState(70);
  const [videoVolume, setVideoVolume] = useState(100);
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState(null);
  const [voiceDurationMs, setVoiceDurationMs] = useState(0);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewAudioURL, setPreviewAudioURL] = useState(null);
  const [previewVideoURL, setPreviewVideoURL] = useState(null);
  const [postImages, setPostImages] = useState([]);
  const [allowDownload, setAllowDownload] = useState(true);
  const [hideComments, setHideComments] = useState(false);
  const previewVideoRef = useRef(null);
  const previewAudioRef = useRef(null);
  const [viewerModalStatusId, setViewerModalStatusId] = useState(null);
  const fileRef = useRef(null);
  const videoFileRef = useRef(null);
  const audioFileRef = useRef(null);
  const postTextRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraRecordingRef = useRef(null);
  const cameraTimerRef = useRef(null);
  const [cameraFacing, setCameraFacing] = useState("user");
  const [cameraMode, setCameraMode] = useState("photo");
  const [cameraFilter, setCameraFilter] = useState("");
  const [cameraZoom, setCameraZoom] = useState(1);
  const [cameraStreamKey, setCameraStreamKey] = useState(0);
  // After a capture we show an action sheet: send the media to a chat, or
  // continue into the status composer. This avoids jumping straight into the
  // composer and lets the user pick where the capture goes.
  const [showCaptureActions, setShowCaptureActions] = useState(false);
  const [_sendingToChat, setSendingToChat] = useState(false);
  const [chatSendTarget, setChatSendTarget] = useState(null);
  // Expose builder state for global hardware back handling (AppShell).
  useEffect(() => {
    const open = !!(showPost || showCamera || viewStoryOwner || showCaptureActions);
    try { window.__nextextStatusBuilderOpen = open; } catch {}
    const onClose = () => {
      if (showCaptureActions) { setShowCaptureActions(false); return; }
      if (showCamera) { try { if (cameraStreamRef.current) cameraStreamRef.current.getTracks().forEach((tr) => tr.stop()); } catch {} setShowCamera(false); return; }
      if (showPost) { setShowPost(false); setPostMedia(null); setPostText(""); setPostMode("text"); setTextStickers([]); setActiveStickerId(null); return; }
      if (viewStoryOwner) { setViewStoryOwner(null); onStoryViewerChange?.(false); return; }
    };
    window.addEventListener("nextextCloseStatusBuilder", onClose);
    return () => window.removeEventListener("nextextCloseStatusBuilder", onClose);
  }, [showPost, showCamera, viewStoryOwner, showCaptureActions]);
  const photoInputRef = useRef(null);
  const mediaPreviewRef = useRef(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showZoomHint, setShowZoomHint] = useState(false);
  const pinchRef = useRef(null);

  const onPreviewTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchRef.current = {
        dist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
        scale: previewZoom,
      };
    }
  };

  const onPreviewTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchRef.current.dist > 0) {
        const next = Math.min(3, Math.max(1, pinchRef.current.scale * (dist / pinchRef.current.dist)));
        setPreviewZoom(next);
        setShowZoomHint(true);
      }
    }
  };

  const onPreviewTouchEnd = () => { pinchRef.current = null; };

  const acceptedContacts = contacts.filter((c) => c.status === "accepted");
  const contactUids = acceptedContacts.map((c) => c.uid);
  const allUids = [myUid, ...contactUids];
  const statuses = useStatuses(allUids);
  const publicStatuses = usePublicStatuses();

  useEffect(() => {
    if (showPost && postTextRef.current && document.activeElement !== postTextRef.current) {
      postTextRef.current.focus();
    }
  });

  useEffect(() => {
    if (initialViewStatuses && statuses.length > 0 && !viewStoryOwner) {
      const { ownerUid } = initialViewStatuses;
      const matching = statuses.filter((s) => s.ownerId === ownerUid);
      if (matching.length > 0) {
        setViewStoryOwner({ statuses: matching, initialIndex: 0, ownerUid });
        if (onStoryViewerChange) onStoryViewerChange(true);
        // Consume the initial-view request so closing the story never
        // re-triggers it (this was the source of an infinite replay loop).
        if (onConsumeInitialView) onConsumeInitialView();
      }
    }
  }, [initialViewStatuses, statuses, viewStoryOwner, onStoryViewerChange, onConsumeInitialView]);

  const sourceStatuses = statusTab === "jewish" ? [] : (statusTab === "public" ? publicStatuses : statuses);
  const myStatuses = sourceStatuses.filter((s) => s.ownerId === myUid);
  const contactStatuses = sourceStatuses.filter((s) => s.ownerId !== myUid);

  const grouped = {};
  contactStatuses.forEach((s) => {
    if (!grouped[s.ownerId]) grouped[s.ownerId] = [];
    grouped[s.ownerId].push(s);
  });

  useEffect(() => {
    if (!bgAudioFile) { setPreviewAudioURL(null); return; }
    const url = URL.createObjectURL(bgAudioFile);
    setPreviewAudioURL(url);
    return () => URL.revokeObjectURL(url);
  }, [bgAudioFile]);

  useEffect(() => {
    if (postMediaType !== "video" || !postMedia) { setPreviewVideoURL(null); return; }
    const url = URL.createObjectURL(postMedia);
    setPreviewVideoURL(url);
    return () => URL.revokeObjectURL(url);
  }, [postMedia, postMediaType]);

  const stopPreview = () => {
    if (previewVideoRef.current) previewVideoRef.current.pause();
    if (previewAudioRef.current) previewAudioRef.current.pause();
    setPreviewPlaying(false);
  };

  const togglePreview = () => {
    const v = previewVideoRef.current;
    const a = previewAudioRef.current;
    if (previewPlaying) {
      v?.pause();
      a?.pause();
      setPreviewPlaying(false);
      return;
    }
    if (v) { v.currentTime = 0; v.volume = muteOriginal ? 0 : videoVolume / 100; v.play().catch(() => {}); }
    if (a) { a.currentTime = 0; a.volume = bgAudioVolume / 100; a.play().catch(() => {}); }
    setPreviewPlaying(true);
  };

  const openPostSheet = (mode) => {
    stopPreview();
    setPostMode(mode);
    setPostText("");
    setPostMedia(null);
    setPostMediaType(null);
    setPostImages([]);
    setDurationSeconds(5);
    setWaitForVideo(false);
    setTextOverlay("");
    setTextStickers([]);
    setActiveStickerId(null);
    setBgAudioFile(null);
    setBgAudioVolume(70);
    setBgMusic(null);
    setMusicModalOpen(false);
    setVideoVolume(100);
    setMuteOriginal(false);
    setAllowDownload(true);
    setHideComments(false);
    setPreviewZoom(1);
    setShowZoomHint(false);
    setPostError("");
    setShowPost(true);
  };

    const handleSelectMusic = (track) => {
      // Store metadata ONLY — never an audio blob. The licensed preview URL (Apple)
      // or YouTube videoId (Zemer) is streamed on-device by the viewer. Include
      // `provider` and `videoId` so the viewer knows how to play the track.
      const provider = track.source || musicProviderActive;
      // Apple exposes only a 30s preview; Zemer maps to a full YouTube video.
      const dur = track.durationSec ? Math.round(track.durationSec) : (provider === "apple" ? 30 : 0);
      const maxSeg = provider === "apple" ? Math.min(dur || 30, 30) : (dur || 30);
      setBgMusic({
        ...track,
        provider,
        videoId: track.videoId || null,
        start: 0,
        end: maxSeg,
        durationSec: dur,
        volume: 1,
        originalVolume: postMediaType === "video" ? (videoVolume / 100) : 1,
        muted: false,
      });
      setMusicModalOpen(false);
    };

    const handlePost = async () => {
    if (postMode === "text" && !postText.trim() && !voiceBlob) return;
    if (postMode === "media" && !postMedia && postImages.length === 0 && !voiceBlob) {
      setPostError("Please select an image, video, or record something.");
      return;
    }
    // Daily status-limit check (0 = unlimited).
    const statusLim = await checkStatusAllowed(myUid, sysConfig?.dailyStatusLimit);
    if (!statusLim.allowed) {
      setPostError(`Daily status limit reached (${statusLim.limit} per day). Try again tomorrow.`);
      return;
    }
    // Snapshot and close UI immediately so upload continues in background even if user leaves
    const snapMode = postMode;
    const snapText = postText;
    const snapMedia = postMedia;
    const snapMediaType = postMediaType;
    const snapImages = [...postImages];
    const snapVoice = voiceBlob;
    const snapDuration = durationSeconds;
    const snapVoiceDur = voiceDurationMs;
    const snapTextOverlay = textOverlay;
    const snapBgAudio = bgAudioFile;
    const snapAllowDownload = allowDownload;
    const snapHideComments = hideComments;
    const snapWaitForVideo = waitForVideo;
    const snapBgVol = bgAudioVolume;
    const snapVidVol = videoVolume;
    const snapMuteOriginal = muteOriginal;
    const snapBgMusic = bgMusic
      ? {
          provider: bgMusic.provider,
          trackId: bgMusic.trackId,
          title: bgMusic.title,
          artist: bgMusic.artist,
          album: bgMusic.album,
          artwork: bgMusic.artwork,
          previewUrl: bgMusic.previewUrl,
          videoId: bgMusic.videoId || null,
          source: bgMusic.source,
          start: bgMusic.start,
          end: bgMusic.end,
          durationSec: bgMusic.durationSec,
          volume: bgMusic.volume,
          originalVolume: bgMusic.originalVolume,
          muted: bgMusic.muted,
        }
      : null;
    setShowPost(false);
    setPostText("");
    setPostMedia(null);
    setPostMediaType(null);
    setPostImages([]);
    setTextOverlay("");
    setTextStickers([]);
    setActiveStickerId(null);
    setBgAudioFile(null);
    setVoiceBlob(null);
    setIsVoiceRecording(false);
    setPosting(true);
    setPostError("");
    const postVisibility = (postPublic || userStatusVisibility === "everyone") ? "public" : "contacts";
    try {
      // Handle voice-note status — a recorded audio blob with optional caption
      // (and optional background image). Uploaded the same way chat voice
      // notes are (Supabase `chat-media` bucket) and posted as mediaType
      // "voice" so the viewer can play it back inline.
      if (snapMode === "media" && snapVoice) {
        const voiceFile = new File([snapVoice], `status-voice-${Date.now()}.webm`, { type: snapVoice.type || "audio/webm" });
        const voiceResult = await uploadMediaFile(`status-${myUid}`, myUid, voiceFile);
        await postStatus(myUid, {
          text: snapText.trim() || null,
          mediaURL: voiceResult.url,
          mediaType: "voice",
          backgroundColor: null,
          fontFamily: null,
          durationMs: snapVoiceDur || snapDuration * 1000,
          textOverlay: snapTextOverlay.trim() || null,
          textStickers: textStickers.length ? textStickers : null,
          allowDownload: snapAllowDownload,
          commentsHidden: snapHideComments,
          visibility: postVisibility,
        });
      }
      // Handle multiple images - send as separate status updates
      if (snapMode === "media" && snapImages.length > 0 && !snapVoice) {
        for (let i = 0; i < snapImages.length; i++) {
          const img = snapImages[i];
          const file = new File([img], `status-${Date.now()}-${i}.jpg`, { type: "image/jpeg" });
          const result = await uploadMediaFile(`status-${myUid}`, myUid, file);
          await postStatus(myUid, {
            text: snapText.trim() || null,
            mediaURL: result.url,
            mediaType: "image",
            backgroundColor: null,
            fontFamily: null,
           durationMs: snapDuration * 1000,
           textOverlay: snapTextOverlay.trim() || null,
          textStickers: textStickers.length ? textStickers : null,
            allowDownload: snapAllowDownload,
            commentsHidden: snapHideComments,
            backgroundMusic: snapBgMusic,
            visibility: postVisibility,
          });
        }
        setPostImages([]);
      }

      // Handle single video or single image from postMedia
      if (snapMode === "media" && snapMedia && !snapVoice) {
        const isVideo = snapMediaType === "video";
        const ext = isVideo ? "mp4" : "jpg";
        const mime = isVideo ? "video/mp4" : "image/jpeg";
        const file = new File([snapMedia], `status-${Date.now()}.${ext}`, { type: mime });
        let bgAudioURL = null;
        let bgAudioVol = null;
        let vidVol = null;
        if (snapBgAudio) {
          const audioFile = new File([snapBgAudio], `status-audio-${Date.now()}.mp3`, { type: snapBgAudio.type || "audio/mpeg" });
          const audioResult = await uploadChatFile(`status-${myUid}`, myUid, audioFile, { compress: false });
          bgAudioURL = audioResult.url;
          bgAudioVol = snapBgVol;
          vidVol = snapMuteOriginal ? 0 : snapVidVol;
        }
        if (isVideo && globalSettings?.statusVideoPipelineEnabled) {
          // Private pipeline: keep original private, create queued status for worker
          const { uploadPrivateFile } = await import("../supabase/media.js");
          const statusRef = doc(collection(db, "status"));
          const statusId = statusRef.id;
          const originalPath = `status/${myUid}/${statusId}/original.mp4`;
          await uploadPrivateFile(originalPath, file, mime);
          let durationMs = await getVideoDuration(snapMedia);
          await setDoc(statusRef, {
            ownerId: myUid,
            text: snapText.trim() || null,
            mediaType: "video",
            backgroundColor: null,
            fontFamily: null,
            durationMs: durationMs || snapDuration * 1000,
            textOverlay: snapTextOverlay.trim() || null,
          textStickers: textStickers.length ? textStickers : null,
            bgAudioURL,
            bgAudioVolume: bgAudioVol,
            videoVolume: vidVol,
            waitForVideo: snapWaitForVideo,
            allowDownload: snapAllowDownload,
            commentsHidden: snapHideComments,
            backgroundMusic: snapBgMusic,
            state: "queued",
            originalPath,
            hlsMasterPath: null,
            fallbackPath: null,
            posterPath: null,
            previewPath: null,
            cardPreviewPath: null,
            renditions: null,
            commentCount: 0,
            createdAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            visibility: postVisibility,
          });
        } else {
          const result = await uploadMediaFile(`status-${myUid}`, myUid, file);
          let durationMs = null;
          let previewURL = null;
          let posterURL = null;
          if (isVideo) {
            durationMs = await getVideoDuration(snapMedia);
            // Generate lightweight preview clip + poster for the feed card.
            try {
              const { generateStatusPreview } = await import("../media/videoPreview.js");
              const { previewBlob, posterBlob } = await generateStatusPreview(snapMedia);
              // Always upload whatever we got — even just a poster is useful.
              if (posterBlob) {
                const posterFile = new File([posterBlob], `status-poster-${Date.now()}.jpg`, { type: "image/jpeg" });
                const posterResult = await uploadMediaFile(`status-${myUid}`, myUid, posterFile);
                posterURL = posterResult.url;
              }
              if (previewBlob) {
                const previewFile = new File([previewBlob], `status-preview-${Date.now()}.webm`, { type: previewBlob.type || "video/webm" });
                const previewResult = await uploadMediaFile(`status-${myUid}`, myUid, previewFile);
                previewURL = previewResult.url;
              }
            } catch (previewErr) {
              console.warn("[StatusScreen] Preview generation failed, generating poster-only fallback:", previewErr);
              // Generate a poster directly from the video as a last resort.
              try {
                const posterBlob = await new Promise((resolve) => {
                  const video = document.createElement("video");
                  video.muted = true;
                  video.playsInline = true;
                  video.preload = "metadata";
                  video.src = URL.createObjectURL(snapMedia);
                  video.onloadeddata = () => {
                    video.currentTime = Math.min(0.5, (video.duration || 1) / 4);
                  };
                  video.onseeked = () => {
                    const c = document.createElement("canvas");
                    c.width = video.videoWidth || 480;
                    c.height = video.videoHeight || 360;
                    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
                    c.toBlob((b) => { URL.revokeObjectURL(video.src); resolve(b); }, "image/jpeg", 0.8);
                  };
                  video.onerror = () => resolve(null);
                  setTimeout(() => resolve(null), 8000);
                });
                if (posterBlob) {
                  const posterFile = new File([posterBlob], `status-poster-${Date.now()}.jpg`, { type: "image/jpeg" });
                  const posterResult = await uploadMediaFile(`status-${myUid}`, myUid, posterFile);
                  posterURL = posterResult.url;
                }
              } catch (posterErr) {
                console.warn("[StatusScreen] Poster fallback also failed:", posterErr);
              }
            }
          }
          await postStatus(myUid, {
            text: snapText.trim() || null,
            mediaURL: result.url,
            mediaType: isVideo ? "video" : "image",
            backgroundColor: null,
            fontFamily: null,
            durationMs: durationMs || snapDuration * 1000,
            textOverlay: snapTextOverlay.trim() || null,
          textStickers: textStickers.length ? textStickers : null,
            bgAudioURL,
            bgAudioVolume: bgAudioVol,
            videoVolume: vidVol,
            waitForVideo: isVideo && snapWaitForVideo,
            allowDownload: snapAllowDownload,
            commentsHidden: snapHideComments,
            backgroundMusic: snapBgMusic,
            previewURL: previewURL || null,
            posterURL: posterURL || null,
            // Static client-side thumbnail (already uploaded). When present the
            // feed uses this instead of re-deriving a Cloudinary fetch poster,
            // avoiding per-view transformation-credit costs.
            thumbnailURL: result.thumbnailURL || null,
            visibility: postVisibility,
          });
        }
      }

      // Handle text status (with optional background audio)
      if (snapMode === "text") {
        let bgAudioURL = null;
        let bgAudioVol = null;
        if (snapBgAudio) {
          const audioFile = new File([snapBgAudio], `status-audio-${Date.now()}.mp3`, { type: snapBgAudio.type || "audio/mpeg" });
          const audioResult = await uploadChatFile(`status-${myUid}`, myUid, audioFile, { compress: false });
          bgAudioURL = audioResult.url;
          bgAudioVol = snapBgVol;
        }
        await postStatus(myUid, {
          text: snapText.trim(),
          mediaURL: null,
          mediaType: null,
          backgroundColor: STATUS_BG_COLORS[bgColorIdx],
          fontFamily: FONTS[fontIdx].value,
          durationMs: snapDuration * 1000,
          textOverlay: null,
          bgAudioURL,
          bgAudioVolume: bgAudioVol,
          videoVolume: null,
          commentsHidden: snapHideComments,
          visibility: postVisibility,
        });
      }

      // Record one status against the daily limit (per post action).
      try { await recordStatusUsage(myUid); } catch {}

      // UI already closed at snapshot time; this is just final cleanup (idempotent)
      setPostError("");
      setPostMode("text");
    } catch (err) {
      setPostError("Couldn't post status: " + (err?.message || err || "unknown error"));
    }
    setPosting(false);
  };

  const handleFileSelect = async (e, type) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (type === "image") {
      // Allow up to 6 images
      const newImages = files.slice(0, 6 - postImages.length);
      if (newImages.length > 0) {
        setPostImages(prev => [...prev, ...newImages]);
        setPostMode("media");
        setPostMediaType("image");
      }
    } else if (type === "video" && files[0]) {
      setPostMedia(files[0]);
      setPostMediaType("video");
      setPostMode("media");
    }
    e.target.value = "";
  };

    const startCamera = async (captureMode, facing = cameraFacing) => {
      setCameraError("");
      setShowCamera(true);
      try {
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
          cameraStreamRef.current = null;
        }
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
            audio: true,
          });
        } catch (err) {
          // Mic may be unavailable/denied — fall back to video-only so the
          // preview still shows (the recording will simply be silent).
          if (captureMode === "video") {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
              audio: false,
            });
          } else {
            throw err;
          }
        }
        cameraStreamRef.current = stream;
        setCameraStreamKey((k) => k + 1);
        setCameraFacing(facing);
        setCameraMode(captureMode);
        setShowCamera(true);
         if (captureMode === "video") {
           let recorder;
           const videoMimeCandidates = [
             "video/webm;codecs=vp8,opus",
             "video/webm;codecs=vp9,opus",
             "video/mp4",
             "video/webm",
           ];
           const videoMime = videoMimeCandidates.find(
             (m) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)
           ) || "";
           try { recorder = videoMime ? new MediaRecorder(stream, { mimeType: videoMime }) : new MediaRecorder(stream); }
           catch { recorder = new MediaRecorder(stream); }
          cameraRecordingRef.current = recorder;
          const chunks = [];
          cameraRecordingRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          cameraRecordingRef.current.onstop = async () => {
            const blob = new Blob(chunks, { type: "video/webm" });
            const file = new File([blob], `status-cam-${Date.now()}.webm`, { type: "video/webm" });
            setPostMedia(file);
            setPostMediaType("video");
            setPostMode("media");
            // Videos default to ending once the clip finishes playing.
            setWaitForVideo(true);
            setCameraZoom(1);
            setShowCamera(false);
            stopCameraStream();
            setShowCaptureActions(true);
          };
          cameraRecordingRef.current.start();
        }
      } catch {
        setCameraError("Camera access denied or unavailable.");
      }
    };

  const flipCamera = () => {
    if (cameraRecordingRef.current && cameraRecordingRef.current.state === "recording") return;
    startCamera(cameraMode, cameraFacing === "user" ? "environment" : "user");
  };

  // Pinch-to-zoom on the live preview. Tracks two-finger distance and maps the
  // ratio to a 1x–4x zoom applied as a CSS scale on the <video>.
  const camPinchRef = useRef({ dist: 0, zoom: 1 });
  const onCamTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      camPinchRef.current = { dist: Math.hypot(dx, dy), zoom: cameraZoom };
    }
  };
  const onCamTouchMove = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = camPinchRef.current.dist ? dist / camPinchRef.current.dist : 1;
      const next = Math.min(4, Math.max(1, camPinchRef.current.zoom * ratio));
      setCameraZoom(next);
      e.preventDefault();
    }
  };
  const zoomBy = (delta) => setCameraZoom((z) => Math.min(4, Math.max(1, +(z + delta).toFixed(2))));

  // Robustly attach the live stream to the <video> preview and start playback.
  // Runs after the stream is (re)started (cameraStreamKey changes on every
  // startCamera, including flips/mode switches) and whenever the camera opens.
  useLayoutEffect(() => {
    const v = cameraVideoRef.current;
    if (!showCamera || !v || !cameraStreamRef.current) return;
    try {
      v.muted = true;
      if (v.srcObject !== cameraStreamRef.current) v.srcObject = cameraStreamRef.current;
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch { /* noop */ }
    // Also set up a small interval to re-attach if the stream gets detached
    const interval = setInterval(() => {
      if (v && cameraStreamRef.current && v.srcObject !== cameraStreamRef.current) {
        try {
          v.srcObject = cameraStreamRef.current;
          v.play().catch(() => {});
        } catch { /* noop */ }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [showCamera, cameraStreamKey]);

  const capturePhotoFromCamera = () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (cameraFilter) ctx.filter = cameraFilter;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `status-cam-${Date.now()}.jpg`, { type: "image/jpeg" });
      setPostMedia(file);
      setPostMediaType("image");
      setPostMode("media");
      setWaitForVideo(false);
      setCameraZoom(1);
      setShowCamera(false);
      stopCameraStream();
      setShowCaptureActions(true);
    }, "image/jpeg", 0.92);
  };

  const sendCaptureToChat = async (targetUid) => {
    if (!postMedia || !targetUid || !myUid) return;
    try {
      setSendingToChat(true);
      setPostError("");
      // Resolve / create the direct chat first so uploadChatFile can put the
      // media into the right Supabase folder.
      const chatId = await getOrCreateDirectChat(myUid, targetUid);
      const isImage = postMediaType === "image";
      const result = await uploadMediaFile(chatId, myUid, postMedia);
      await sendMediaMessage(chatId, myUid, isImage ? "image" : "video", result, [targetUid]);
      setShowCaptureActions(false);
      setShowPost(false);
      setPostMedia(null);
      setPostMediaType(null);
      setPostMode("text");
      setChatSendTarget(null);
    } catch (err) {
      setPostError(err?.message || "Couldn't send to chat.");
    } finally {
      setSendingToChat(false);
    }
  };

  const stopCameraStream = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
      cameraStreamRef.current = null;
    }
    if (cameraTimerRef.current) { clearTimeout(cameraTimerRef.current); cameraTimerRef.current = null; }
  };

  // ── Native camera (Capacitor) + routing sheet ──────────────────
  const nativeStatusChats = (chats || []).map((c) => {
    let name = c.groupName;
    if (!name) {
      const other = c.participants?.find((p) => p !== myUid);
      const contact = contacts.find((ct) => ct.uid === other);
      name = contact ? getContactDisplayName(contact) : (other === myUid ? (myName || "Me") : (other ? other.slice(0, 8) : "Chat"));
    }
    return { id: c.id, name, isGroup: c.type === "group" };
  });

  const nativeSendStatus = async (file) => {
    const isVideo = !!file?.type && file.type.startsWith("video");
    const result = await uploadMediaFile(`status-${myUid}`, myUid, file);
    const postVisibility = (postPublic || userStatusVisibility === "everyone") ? "public" : "contacts";
    await postStatus(myUid, {
      text: null,
      mediaURL: result.url,
      mediaType: isVideo ? "video" : "image",
      backgroundColor: null,
      fontFamily: null,
      durationMs: isVideo ? 10000 : 8000,
      textOverlay: null,
      visibility: postVisibility,
    });
  };

  // Open the existing status composer/builder with the captured file pre-filled.
  const nativeStatusBuilder = (file) => {
    const isVideo = !!file?.type && file.type.startsWith("video");
    setPostMedia(file);
    setPostMediaType(isVideo ? "video" : "image");
    setPostMode("media");
    setWaitForVideo(isVideo);
    setShowPost(true);
  };

  const stopVoiceRecording = async () => {
    const isNative = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
    const NextextNative = isNative ? window.Capacitor?.Plugins?.NextextNative : null;
    if (isNative && NextextNative && typeof NextextNative.stopVoiceRecording === "function") {
      // Native recording path — the recorder returns the audio as base64
      // (the file is deleted right after), so decode it directly.
      try {
        const res = await NextextNative.stopVoiceRecording();
        const b64 = res?.base64;
         if (b64) {
           const blob = base64ToBlob(b64, res?.mimeType || "audio/mp4");
           setVoiceBlob(blob);
           setVoiceDurationMs(res?.durationMs || 0);
           setIsVoiceRecording(false);
           setPostMode("media");
          if (voiceRecorderRef.current?._nativeTickInterval) {
            clearInterval(voiceRecorderRef.current._nativeTickInterval);
            voiceRecorderRef.current._nativeTickInterval = null;
          }
          return;
        }
        setPostError("Failed to read recorded audio.");
      } catch (err) {
        console.warn("Native stopVoiceRecording failed:", err);
      }
    }
    // Clear native timer if any
    if (voiceRecorderRef.current?._nativeTickInterval) {
      clearInterval(voiceRecorderRef.current._nativeTickInterval);
      voiceRecorderRef.current._nativeTickInterval = null;
    }
    // WebView MediaRecorder fallback
    if (voiceRecorderRef.current && voiceRecorderRef.current.state === "recording") {
      voiceRecorderRef.current.stop();
    }
  };

  const startVoiceRecording = async () => {
    setPostError("");
    if (isVoiceRecording) {
      stopVoiceRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPostError("Voice recording isn't supported on this device.");
      return;
    }
    const isNative = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
    const NextextNative = isNative ? window.Capacitor?.Plugins?.NextextNative : null;
    if (isNative && NextextNative && typeof NextextNative.startVoiceRecording === "function") {
      // Use native Android recording (same as regular voice notes) — avoids WebView
      // MediaRecorder NotReadableError on devices like the Duoqin F21 Pro.
      try {
        await NextextNative.startVoiceRecording();
        setIsVoiceRecording(true);
        setVoiceBlob(null);
        setVoiceDurationMs(0);
        // Start timer for native recording to show duration
        const nativeStartTime = Date.now();
        voiceRecorderRef.current = voiceRecorderRef.current || {};
        voiceRecorderRef.current._nativeTickInterval = setInterval(() => {
          setVoiceDurationMs(Date.now() - nativeStartTime);
        }, 200);
        // The actual blob will be retrieved when stopVoiceRecording is called
        return;
      } catch (err) {
        console.warn("Native status voice recording failed, falling back to WebView:", err);
        // Fall through to WebView fallback
      }
    }
    // WebView MediaRecorder fallback
    try {
      const stream = await getMicrophoneStream({ audio: true });
      voiceStreamRef.current = stream;
      const chunks = [];
      let recorder;
      try {
        const mt = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" :
          (MediaRecorder.isTypeSupported("audio/m4a") ? "audio/m4a" :
          (MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
          (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "")));
        recorder = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      } catch {
        recorder = new MediaRecorder(stream);
      }
      voiceRecorderRef.current = recorder;
      const startTime = Date.now();
      setIsVoiceRecording(true);
      setVoiceBlob(null);
      setVoiceDurationMs(0);
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        clearInterval(voiceRecorderRef.current?._tickInterval);
        try { stream.getTracks().forEach((tr) => tr.stop()); } catch { /* ignore */ }
        voiceStreamRef.current = null;
        voiceRecorderRef.current = null;
        setIsVoiceRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/mp4" });
        setVoiceBlob(blob);
        setVoiceDurationMs(Date.now() - startTime);
        setPostMode("media");
      };
      recorder.start();
      voiceRecorderRef.current._tickInterval = setInterval(() => {
        setVoiceDurationMs(Date.now() - startTime);
      }, 200);
    } catch (err) {
      setIsVoiceRecording(false);
      setPostError("Microphone access denied or unavailable.");
    }
  };

  const openStory = (items, ownerUid) => {
    // Start at the first status the user hasn't seen yet (so re-opening after a
    // new post resumes where they left off).
    const viewedIds = getViewedIds();
    let initialIndex = items.findIndex((s) => !viewedIds.has(s.id));
    if (initialIndex < 0) initialIndex = 0;
    setViewStoryOwner({ statuses: items, initialIndex, ownerUid });
    onStoryViewerChange?.(true);
    // Record view for each status in this story (fire-and-forget) and mark the
    // owner as viewed locally so the ring turns from green (unviewed) to grey.
    if (ownerUid !== myUid) {
      items.forEach((s) => viewStatus(s.id, myUid));
      markViewed(ownerUid);
    }
  };

  const advanceToNextOwner = (currentUid) => {
    const owners = Object.keys(grouped);
    const ci = owners.indexOf(currentUid);
    if (ci === -1 || ci >= owners.length - 1) {
      setViewStoryOwner(null);
      onStoryViewerChange?.(false);
      return;
    }
    const nextUid = owners[ci + 1];
    openStory(grouped[nextUid], nextUid);
  };

  const handleStoryViewed = () => {
    if (viewStoryOwner?.ownerUid) {
      markViewed(viewStoryOwner.ownerUid);
      setViewedMap(getStoredViewed());
    }
  };

  const isViewed = (uid) => {
    const viewedTs = viewedMap[uid];
    if (!viewedTs) return false;
    const userStatuses = grouped[uid] || [];
    if (userStatuses.length === 0) return true;
    const latestStatus = userStatuses.reduce((latest, s) => {
      const sTs = s.createdAt?.toMillis?.() || 0;
      const lTs = latest.createdAt?.toMillis?.() || 0;
      return sTs > lTs ? s : latest;
    }, userStatuses[0]);
    const latestTs = latestStatus.createdAt?.toMillis?.() || 0;
    return viewedTs >= latestTs;
  };

  const timeAgo = (ts) => {
    if (!ts?.toDate) return "";
    const mins = Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const SectionHeader = ({ label }) => (
    <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted, padding: "14px 16px 6px", textTransform: "uppercase" }}>{label}</div>
  );

  return (
    <div className="nx-screen" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: t.bg, zIndex: 40, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "calc(16px + var(--safe-top)) 16px 16px", gap: 12, background: t.surface, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 18 }}>Status</span>
        <div onClick={() => setShowNativeCamera(true)} title="Camera" style={{ marginLeft: "auto", width: 38, height: 38, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Camera size={20} color={t.primary} />
        </div>
        <select
          value={statusLayout === "cards" ? `cards-${statusPreviewSize}` : statusLayout}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "list") changeStatusLayout("list");
            else if (v === "rows") changeStatusLayout("rows");
            else if (v === "cards-cozy") { changeStatusLayout("cards"); changeStatusPreviewSize("cozy"); }
            else { changeStatusLayout("cards"); changeStatusPreviewSize("compact"); }
          }}
          style={{ padding: "7px 8px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 12, fontWeight: 600, outline: "none", color: t.text, background: t.bg, flexShrink: 0 }}
        >
          <option value="cards-compact">Cards · Compact</option>
          <option value="cards-cozy">Cards · Cozy</option>
          <option value="list">List</option>
          <option value="rows">Rows</option>
        </select>
      </div>

      {/* Tab bar: Updates (contacts) vs Public */}
      <div style={{ display: "flex", background: t.surface, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
         {[
           { id: "updates", label: "Updates" },
           { id: "public", label: `Public${publicStatuses.length ? ` (${publicStatuses.length})` : ""}` },
           ...(jewishVisible ? [{ id: "jewish", label: "Jewish Statuses" }] : []),
         ].map((tab) => (
          <div
            key={tab.id}
            onClick={() => setStatusTab(tab.id)}
            style={{ flex: 1, textAlign: "center", padding: "11px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer", color: statusTab === tab.id ? t.primary : t.textMuted, borderBottom: `2px solid ${statusTab === tab.id ? t.primary : "transparent"}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <span>{tab.label}</span>
            {tab.id === "public" && (
              <span
                onClick={(e) => { e.stopPropagation(); setPublicInfo((v) => !v); }}
                title="What is a public status?"
                style={{ width: 16, height: 16, borderRadius: "50%", border: `1px solid ${t.textMuted}`, color: t.textMuted, fontSize: 11, fontWeight: 800, lineHeight: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >?</span>
            )}
          </div>
        ))}
        {publicInfo && (
          <div style={{ padding: "10px 16px", background: t.primaryLight, borderBottom: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 13, color: t.text, lineHeight: 1.5 }}>
              <b>Public statuses</b> are visible to <b>anyone</b> with the app link — not just your NexText contacts. Post something public only if you're comfortable with it being widely seen. You can toggle each status between Contacts-only and Public from the visibility switch on your own status cards.
            </div>
            <div onClick={() => setPublicInfo(false)} style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, color: t.primary, marginTop: 6, cursor: "pointer" }}>Got it</div>
          </div>
        )}
      </div>

      <div className="nx-scroll" style={{ flex: 1, paddingBottom: 70, minHeight: 0 }}>
        {statusTab === "jewish" && <JewishStatusesTab onStoryViewerChange={onStoryViewerChange} />}
        {statusTab === "updates" && (<>
        <SectionHeader label="My Status" />
        <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 16px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ position: "relative", cursor: "pointer" }} onClick={() => openPostSheet("text")}>
            <Avatar name={myName || myDisplayName} uid={myUid} size={50} />
            <div onClick={(e) => { e.stopPropagation(); openPostSheet("text"); }} style={{ position: "absolute", bottom: -2, right: -2, width: 22, height: 22, borderRadius: "50%", background: t.accent, border: `2px solid ${t.bg}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Plus size={13} color="#fff" />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>My Status</div>
            <div style={{ fontSize: 12.5, color: t.textMuted }}>
              {myStatuses.length > 0 ? `${myStatuses.length} update${myStatuses.length > 1 ? "s" : ""}` : "Tap to add status update"}
            </div>
          </div>
          <div onClick={() => openPostSheet("text")} style={{ padding: "10px 18px", borderRadius: 24, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
            Post
          </div>
          {!hideStatusCamera && (
            <div onClick={() => setShowNativeCamera(true)} title="Camera" style={{ width: 40, height: 40, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              <Camera size={20} color={t.primary} />
            </div>
          )}
        </div>

        {myStatuses.length > 0 && myStatuses.map((s, idx) => (
          <div key={s.id} onClick={() => openStory(myStatuses, myUid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 10px 42px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: s.mediaURL ? `url(${s.mediaURL}) center/cover` : (s.bgColor || t.primaryLight), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: s.mediaURL ? "#fff" : t.text, fontWeight: 700, border: `1px solid ${t.border}`, overflow: "hidden" }}>
              {!s.mediaURL && (s.text || `#${idx + 1}`).slice(0, 4)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, color: t.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                {s.text || (s.mediaType === "video" ? "Video" : s.mediaType === "image" ? "Photo" : `Slide ${idx + 1}`)}
              </span>
              <span style={{ fontSize: 11.5, color: t.textMuted }}>
                {s.sentAt?.toDate ? s.sentAt.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
              </span>
            </div>
            <SlideViewerCount statusId={s.id} t={t} onClickEye={(sid) => setViewerModalStatusId(sid)} />
            <div
              onClick={(e) => { e.stopPropagation(); updateStatusVisibility(s.id, s.visibility === "public" ? "contacts" : "public").catch(() => {}); }}
              title={s.visibility === "public" ? "Visible to everyone — tap to limit to contacts" : "Limited to contacts — tap to make public"}
              style={{ padding: "4px 8px", borderRadius: 8, fontSize: 10.5, fontWeight: 700, cursor: "pointer", flexShrink: 0, color: s.visibility === "public" ? "#fff" : t.textMuted, background: s.visibility === "public" ? t.primary : t.primaryLight }}
            >
              {s.visibility === "public" ? "PUBLIC" : "CONTACTS"}
            </div>
            <div onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this status update early?")) { deleteStatus(s.id).catch(() => {}); } }} style={{ padding: 4, cursor: "pointer", flexShrink: 0 }}>
              <Trash2 size={15} color="#FF3B30" />
            </div>
          </div>
        ))}</>)}

        {Object.keys(grouped).length > 0 && <SectionHeader label={statusTab === "public" ? "Public Statuses" : "Recent Updates"} />}
        {statusLayout === "list" ? (
           <div className="noPagerSwipe" style={{ display: "flex", overflowX: "auto", overflowY: "hidden", padding: "10px 16px 14px", WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}>
            {Object.entries(grouped).map(([uid, items]) => {
              const contact = acceptedContacts.find((c) => c.uid === uid);
              const name = contact?.profile?.displayName || "Unknown";
              const latest = items[items.length - 1];
              const previewItem = pickPreviewItem(items);
              const noThumb = previewItem?.mediaType === "video" && !previewItem.posterURL && !previewItem.thumbnailURL && !previewItem.previewURL;
              return (
                <div
                  key={uid}
                  onClick={() => openStory(items, uid)}
                  style={{ flexShrink: 0, width: 158, marginRight: 10, borderRadius: 14, border: `2px solid ${isViewed(uid) ? t.border : t.primary}`, overflow: "hidden", background: t.surface, cursor: "pointer", boxSizing: "border-box" }}
                >
                  <div style={{ position: "relative", paddingBottom: "120%", background: "#000" }}>
                    {previewItem?.mediaURL && !noThumb ? (
                      previewItem.mediaType === "video" ? (
                        <StatusThumb item={previewItem} forceStaticPreview={forceStaticPreview} showThumbs={showVideoThumbs} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                        <img src={getProxyMediaUrl(previewItem.mediaURL, "image")} alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        )
                    ) : noThumb ? (
                      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "linear-gradient(135deg,#2a2a2e,#1a1a1d)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
                        <span style={{ fontSize: 12, color: "#fff", fontWeight: 700, textAlign: "center" }}>Tap to view {name}'s status</span>
                      </div>
                    ) : (
                      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: latest.backgroundColor || t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
                        <span style={{ color: latest.backgroundColor ? "#fff" : t.text, fontSize: 12.5, fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>{latest.text || "Status"}</span>
                      </div>
                    )}
                    <div style={{ position: "absolute", top: 6, left: 6 }}>
                      <Avatar photoURL={contact?.profile?.photoURL} name={name} uid={uid} size={28} hasActiveStatus statusViewed={isViewed(uid)} blockStatus={blockStatus} onStatusView={() => openStory(items, uid)} />
                    </div>
                  </div>
                  <div style={{ padding: "7px 9px" }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                    <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 1 }}>{items.length} update{items.length > 1 ? "s" : ""} · {timeAgo(latest.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : statusLayout === "rows" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "4px 0" }}>
            {myStatuses.length > 0 ? (
              (() => {
                const latest = myStatuses[myStatuses.length - 1];
                return (
                  <div key="__own_row" onClick={() => openStory(myStatuses, myUid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: t.surface }}>
                    <Avatar photoURL={myPhoto} name={myName || myDisplayName} uid={myUid} size={44} hasActiveStatus statusViewed={true} blockStatus={blockStatus} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>My Status</div>
                      <div style={{ fontSize: 12, color: t.textMuted }}>{myStatuses.length} update{myStatuses.length > 1 ? "s" : ""} · {timeAgo(latest.createdAt)}</div>
                    </div>
                    <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "#000", flexShrink: 0 }}>
                    {latest.mediaURL ? (
                      latest.mediaType === "video" ? (
                        <StatusThumb item={latest} forceStaticPreview={forceStaticPreview} showThumbs={showVideoThumbs} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : <img src={getProxyMediaUrl(latest.mediaURL, "image")} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: latest.backgroundColor || t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", padding: 6 }}><span style={{ fontSize: 9, fontWeight: 700, color: latest.backgroundColor ? "#fff" : t.text, textAlign: "center" }}>{(latest.text || "").slice(0, 12) || "Text"}</span></div>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div onClick={() => openPostSheet("text")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={18} color={t.primary} /></div>
                <span style={{ fontWeight: 600, color: t.text }}>Post status</span>
              </div>
            )}
            {Object.entries(grouped).map(([uid, items]) => {
              const contact = acceptedContacts.find((c) => c.uid === uid);
              const name = contact?.profile?.displayName || "Unknown";
              const latest = items[items.length - 1];
              const previewItem = pickPreviewItem(items);
              const noThumb = previewItem?.mediaType === "video" && !previewItem.posterURL && !previewItem.thumbnailURL && !previewItem.previewURL;
              const viewed = isViewed(uid);
              return (
                <div key={uid} onClick={() => openStory(items, uid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: t.surface }}>
                  <Avatar photoURL={contact?.profile?.photoURL} name={name} uid={uid} size={42} hasActiveStatus statusViewed={viewed} blockStatus={blockStatus} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                    <div style={{ fontSize: 12, color: t.textMuted }}>{items.length} update{items.length > 1 ? "s" : ""} · {timeAgo(latest.createdAt)}</div>
                  </div>
                    <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "#000", flexShrink: 0 }}>
                    {previewItem?.mediaURL && !noThumb ? (
                      previewItem.mediaType === "video" ? (
                        <StatusThumb item={previewItem} forceStaticPreview={forceStaticPreview} showThumbs={showVideoThumbs} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : <img src={getProxyMediaUrl(previewItem.mediaURL, "image")} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : noThumb ? (
                      <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a2a2e,#1a1a1d)", display: "flex", alignItems: "center", justifyContent: "center", padding: 6 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#fff", textAlign: "center" }}>Tap to view</span></div>
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: latest.backgroundColor || t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", padding: 6 }}><span style={{ fontSize: 9, fontWeight: 700, color: latest.backgroundColor ? "#fff" : t.text }}>{(latest.text || "").slice(0, 12)}</span></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: statusPreviewSize === "compact" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 10, padding: "4px 14px 14px" }}>
            {/* First card is always the user's own status (or a "Post status" prompt) */}
            {myStatuses.length > 0 ? (
              (() => {
                const latest = myStatuses[myStatuses.length - 1];
                const viewed = true;
                return (
                  <div
                    key="__own"
                    onClick={() => openStory(myStatuses, myUid)}
                    style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: `2px solid ${t.primary}`, cursor: "pointer", boxSizing: "border-box", paddingBottom: "133.33%", background: "#000", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
                  >
                     {latest.mediaURL ? (
                      latest.mediaType === "video" ? (
                        <StatusThumb item={latest} forceStaticPreview={forceStaticPreview} showThumbs={showVideoThumbs} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <img src={getProxyMediaUrl(latest.mediaURL, "image")} alt="" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                      )
                    ) : (
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: latest.backgroundColor || t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
                        <span style={{ color: latest.backgroundColor ? "#fff" : t.text, fontSize: 13, fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>{latest.text || "My status"}</span>
                      </div>
                    )}
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "8px 10px", background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0))" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Avatar photoURL={myPhoto} name={myName || myDisplayName} uid={myUid} size={22} hasActiveStatus statusViewed={viewed} blockStatus={blockStatus} />
                        <span style={{ color: "#fff", fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{myName || "My status"}</span>
                      </div>
                    </div>
                    <div style={{ position: "absolute", bottom: 8, right: 10, color: "#fff", fontSize: 10.5, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                      {myStatuses.length} · {timeAgo(latest.createdAt)}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div
                key="__own_empty"
                onClick={() => openPostSheet("text")}
                style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: `2px dashed ${t.primary}`, cursor: "pointer", boxSizing: "border-box", paddingBottom: "133.33%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 8 }}>
                  <Plus size={26} color={t.primary} />
                  <span style={{ color: t.primary, fontSize: 12.5, fontWeight: 700, textAlign: "center" }}>Post status</span>
                </div>
              </div>
            )}
            {Object.entries(grouped).map(([uid, items]) => {
              const contact = acceptedContacts.find((c) => c.uid === uid);
              const name = contact?.profile?.displayName || "Unknown";
              const latest = items[items.length - 1];
              const viewed = isViewed(uid);
              return (
                <div
                  key={uid}
                  onClick={() => openStory(items, uid)}
                  style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: `2px solid ${viewed ? t.border : t.primary}`, cursor: "pointer", boxSizing: "border-box", paddingBottom: "133.33%", background: "#000", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
                >
                  {latest.mediaURL ? (
                    latest.mediaType === "video" ? (
                      showVideoThumbs ? (
                        <video src={getProxyMediaUrl(latest.previewURL || latest.mediaURL, "video")} poster={latest.posterURL || undefined} muted autoPlay loop playsInline preload="metadata" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "linear-gradient(135deg,#2a2a2e,#1a1a1d)" }} />
                      )

                    ) : (
                      <img src={getProxyMediaUrl(latest.mediaURL, "image")} alt="" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                    )
                  ) : (
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: latest.backgroundColor || t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
                      <span style={{ color: latest.backgroundColor ? "#fff" : t.text, fontSize: 13, fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>{latest.text || "Status"}</span>
                    </div>
                  )}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "8px 10px", background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0))" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Avatar photoURL={contact?.profile?.photoURL} name={name} uid={uid} size={22} hasActiveStatus statusViewed={viewed} blockStatus={blockStatus} />
                      <span style={{ color: "#fff", fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    </div>
                    <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                      {Array.from({ length: items.length }).map((_, i) => (
                        <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.9)" }} />
                      ))}
                    </div>
                  </div>
                  <div style={{ position: "absolute", bottom: 8, right: 10, color: "#fff", fontSize: 10.5, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                    {items.length} · {timeAgo(latest.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {Object.keys(grouped).length === 0 && myStatuses.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: t.textMuted, fontSize: 13.5, lineHeight: 1.6 }}>
            No status updates yet. Tap the + button to post yours!
          </div>
        )}
      </div>

      {viewStoryOwner && (
        <StatusStoryViewer
          statuses={viewStoryOwner.statuses}
          initialIndex={viewStoryOwner.initialIndex}
          myUid={myUid}
          ownerUid={viewStoryOwner.ownerUid}
          contacts={acceptedContacts}
          onClose={() => { setViewStoryOwner(null); onStoryViewerChange?.(false); }}
          onExit={() => { setViewStoryOwner(null); onStoryViewerChange?.(false); if (statusOrigin !== "status") onBack?.(); }}
          onViewStory={handleStoryViewed}
          onViewedStatus={markStatusViewed}
          onNext={() => advanceToNextOwner(viewStoryOwner.ownerUid)}
        />
      )}

      {viewerModalStatusId && (
        <StatusViewerModal statusId={viewerModalStatusId} contacts={acceptedContacts} onClose={() => setViewerModalStatusId(null)} t={t} />
      )}

      <NativeCameraSheet
        open={showNativeCamera}
        onClose={() => setShowNativeCamera(false)}
        onSendStatus={nativeSendStatus}
        onStatusBuilder={nativeStatusBuilder}
        chats={nativeStatusChats}
      />

      {/* Camera overlay — portaled to document.body so it escapes the scaled
          app shell (a position:fixed inside a transformed ancestor is sized
          relative to that ancestor, which made the old camera render tiny in a
          corner). Now it's truly full-screen. */}
        {showCamera && createPortal(
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100vh", background: "#000", zIndex: 2147482000, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "calc(12px + var(--safe-top)) 16px 12px", minHeight: 44, flexShrink: 0, position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}>
              <X size={22} color="#fff" onClick={() => { setShowCamera(false); stopCameraStream(); }} style={{ cursor: "pointer" }} />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 6 }}>
                <div onClick={() => zoomBy(-0.25)} style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontSize: 16, fontWeight: 700 }}>−</div>
                <div style={{ fontSize: 11.5, color: "#fff", fontWeight: 700, minWidth: 30, textAlign: "center" }}>{cameraZoom.toFixed(1)}x</div>
                <div onClick={() => zoomBy(0.25)} style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontSize: 16, fontWeight: 700 }}>+</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div onClick={() => setCameraMode((m) => (m === "photo" ? "video" : "photo"))} style={{ padding: "7px 16px", borderRadius: 99, background: "rgba(255,255,255,0.18)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  {cameraMode === "photo" ? "Photo" : "Video"}
                </div>
                <div onClick={flipCamera} style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <RefreshCw size={20} color="#fff" />
                </div>
              </div>
            </div>
            <video
              key={cameraStreamKey}
              ref={(el) => {
                cameraVideoRef.current = el;
                if (el && cameraStreamRef.current) {
                  try {
                    el.muted = true;
                    if (el.srcObject !== cameraStreamRef.current) el.srcObject = cameraStreamRef.current;
                    el.play().catch(() => {});
                  } catch { /* noop */ }
                }
              }}
              autoPlay
              playsInline
              muted
              onTouchStart={onCamTouchStart}
              onTouchMove={onCamTouchMove}
              onLoadedData={(e) => { try { e.target.play(); } catch {} }}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000", zIndex: 1, filter: cameraFilter || "none", transform: `${cameraFacing === "user" ? "scaleX(-1) " : ""}scale(${cameraZoom})`, transformOrigin: "center center" }}
            />
            {cameraError && <div style={{ position: "absolute", bottom: "calc(190px + var(--safe-bottom))", left: 0, right: 0, textAlign: "center", color: "#FF3B30", fontSize: 13, fontWeight: 600, zIndex: 11 }}>{cameraError}</div>}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: "calc(118px + var(--safe-bottom))", display: "flex", gap: 8, overflowX: "auto", padding: "0 16px", zIndex: 10 }}>
              {CAMERA_FILTERS.map((f) => (
                <div key={f.id} onClick={() => setCameraFilter(f.css)} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 99, background: (cameraFilter === f.css) ? "#fff" : "rgba(255,255,255,0.18)", color: (cameraFilter === f.css) ? "#000" : "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                  {f.label}
                </div>
              ))}
            </div>
            <div style={{ position: "absolute", bottom: "calc(28px + var(--safe-bottom))", left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 10 }}>
              {cameraMode === "photo" ? (
                <div onClick={capturePhotoFromCamera} style={{ width: "min(72px, 18vw)", height: "min(72px, 18vw)", borderRadius: "50%", border: "4px solid #fff", background: "rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Camera size={28} color="#fff" />
                </div>
              ) : (
                <div
                  onClick={() => {
                    if (cameraRecordingRef.current && cameraRecordingRef.current.state === "recording") {
                      cameraRecordingRef.current.stop();
                    } else {
                      startCamera("video");
                    }
                  }}
                  style={{ width: "min(72px, 18vw)", height: "min(72px, 18vw)", borderRadius: "50%", border: "4px solid #FF3B30", background: cameraRecordingRef.current?.state === "recording" ? "rgba(255,59,48,0.35)" : "rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <Video size={28} color="#FF3B30" />
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Capture actions: send to chat or post to status */}
      {showCaptureActions && createPortal(
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 2147483000, display: "flex", alignItems: "flex-end" }} onClick={() => { setShowCaptureActions(false); setPostMedia(null); setPostMediaType(null); setPostMode("text"); }}>
          <div style={{ background: t.surface, width: "100%", borderRadius: "20px 20px 0 0", padding: "24px 20px 30px", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 -4px 24px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>{postMediaType === "video" ? "Video captured" : "Photo captured"}</span>
              <X size={22} color={t.textMuted} onClick={() => { setShowCaptureActions(false); setPostMedia(null); setPostMediaType(null); setPostMode("text"); }} style={{ cursor: "pointer" }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div onClick={() => { setShowCaptureActions(false); }} style={{ flex: 1, padding: "16px 12px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 15, textAlign: "center", cursor: "pointer" }}>
                <Camera size={20} style={{ display: "block", margin: "0 auto 6px" }} />
                Post to Status
              </div>
              <div onClick={() => setChatSendTarget("pick")} style={{ flex: 1, padding: "16px 12px", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}`, color: t.text, fontWeight: 700, fontSize: 15, textAlign: "center", cursor: "pointer" }}>
                <MessageCircle size={20} style={{ display: "block", margin: "0 auto 6px" }} />
                Send to Chat
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Chat picker for sending the capture */}
      {chatSendTarget === "pick" && createPortal(
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 2147483010, display: "flex", flexDirection: "column" }} onClick={() => setChatSendTarget(null)}>
          <div style={{ background: t.surface, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 -4px 24px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Send to Chat</span>
              <X size={22} color={t.textMuted} onClick={() => setChatSendTarget(null)} style={{ cursor: "pointer" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {contacts?.map((c) => (
                <div key={c.uid} onClick={() => { setChatSendTarget(c.uid); sendCaptureToChat(c.uid); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", cursor: "pointer" }}>
                  <Avatar src={c.photoURL} name={c.name} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: t.text, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                    {c.status && <div style={{ fontSize: 12, color: t.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.status}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Post status sheet */}
      {showPost && !showCamera && createPortal(
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", zIndex: 2147481000, display: "flex", alignItems: "flex-end" }} onClick={() => { setShowPost(false); setPostMedia(null); setPostText(""); setPostMode("text"); }}>
          <div style={{ background: t.surface, width: "100%", boxSizing: "border-box", borderRadius: "20px 20px 0 0", padding: "20px 24px 30px", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>New Status</span>
              <X size={20} color={t.textMuted} onClick={() => { setShowPost(false); setPostMedia(null); setPostText(""); setPostMode("text"); }} style={{ cursor: "pointer" }} />
            </div>

            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <div onClick={() => setPostMode("text")} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 10, background: postMode === "text" ? t.primary : t.bg, color: postMode === "text" ? t.bubbleMeText : t.textMuted, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Type size={14} /> Text
              </div>
              <div onClick={() => setPostMode("media")} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 10, background: postMode === "media" ? t.primary : t.bg, color: postMode === "media" ? t.bubbleMeText : t.textMuted, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Camera size={14} /> Media
              </div>
            </div>

            {postMode === "text" ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>Preview ({previewZoom > 1 ? `${Math.round(previewZoom * 100)}%` : "pinch to zoom"})</span>
                  {previewZoom > 1 && (
                    <div onClick={() => { setPreviewZoom(1); setShowZoomHint(false); }} style={{ fontSize: 11, color: t.primary, fontWeight: 700, cursor: "pointer", padding: "2px 8px", borderRadius: 8, background: t.primaryLight }}>Reset zoom</div>
                  )}
                </div>
                <div
                  onTouchStart={onPreviewTouchStart}
                  onTouchMove={onPreviewTouchMove}
                  onTouchEnd={onPreviewTouchEnd}
                  style={{ position: "relative", boxSizing: "border-box", overflow: "hidden", borderRadius: 12, background: STATUS_BG_COLORS[bgColorIdx], width: "100%", height: 300, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", transition: "background 0.2s", touchAction: "pan-x pan-y" }}
                >
                  <div style={{ transform: `scale(${previewZoom})`, transformOrigin: "center center", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <textarea
                      ref={postTextRef}
                      autoFocus
                      value={postText}
                      onChange={(e) => setPostText(e.target.value)}
                      placeholder="What's on your mind?"
                      rows={3}
                      style={{ width: "100%", height: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 20, fontWeight: 700, textAlign: "center", resize: "none", fontFamily: FONTS[fontIdx].value, lineHeight: 1.4, caretColor: "#fff", padding: 12 }}
                    />
                  </div>
                  {showZoomHint && previewZoom > 1 && (
                    <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", fontSize: 10.5, color: "rgba(255,255,255,0.85)", background: "rgba(0,0,0,0.45)", padding: "3px 8px", borderRadius: 10, width: "fit-content", margin: "0 auto" }}>Zoomed — drag with two fingers</div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <Palette size={16} color={t.textMuted} />
                  <div style={{ display: "flex", gap: 6, flex: 1, overflowX: "auto", paddingBottom: 2 }}>
                    {STATUS_BG_COLORS.map((c, i) => (
                      <div key={c} onClick={() => setBgColorIdx(i)} style={{ width: 28, height: 28, borderRadius: "50%", background: c, border: i === bgColorIdx ? `3px solid ${t.text}` : "2px solid transparent", cursor: "pointer", flexShrink: 0, transition: "border 0.15s" }} />
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, marginBottom: 14 }}>
                  {FONTS.map((f, i) => (
                    <div key={f.id} onClick={() => setFontIdx(i)} style={{ padding: "6px 12px", borderRadius: 10, background: i === fontIdx ? t.primary : t.bg, color: i === fontIdx ? t.bubbleMeText : t.textMuted, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, fontFamily: f.value }}>
                      {f.label}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => handleFileSelect(e, "image")} />
                <input ref={videoFileRef} type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => handleFileSelect(e, "video")} />
                <input ref={photoInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => handleFileSelect(e, "image")} />

                {/* Multiple image gallery picker (WhatsApp-style) */}
                {postImages.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>
                      {postImages.length} image{postImages.length > 1 ? "s" : ""} selected
                    </div>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
                      {postImages.map((img, idx) => (
                        <div key={idx} style={{ position: "relative", flexShrink: 0, width: 80, height: 80, borderRadius: 10, overflow: "hidden", border: `1px solid ${t.border}` }}>
                          <img src={URL.createObjectURL(img)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <button
                            onClick={(e) => { e.stopPropagation(); setPostImages(prev => prev.filter((_, i) => i !== idx)); }}
                            style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {postImages.length < 6 && (
                      <button
                        onClick={() => photoInputRef.current?.click()}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, cursor: "pointer", marginTop: 8 }}
                      >
                        <Plus size={16} color={t.primary} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: t.primary }}>Add more</span>
                      </button>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <div onClick={() => fileRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                    <Camera size={16} color={t.primary} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.primary }}>Photo</span>
                  </div>
                  <div onClick={() => videoFileRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                    <Video size={16} color={t.primary} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.primary }}>Video</span>
                  </div>
                  {!hideStatusCamera && (
                    <div onClick={() => setShowNativeCamera(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                      <Camera size={16} color={t.primary} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: t.primary }}>Camera</span>
                    </div>
                  )}
                  {!hideStatusVoiceNote && (
                    <div onClick={() => { try { startVoiceRecording(); } catch (e) { setPostError(e?.message || "Could not start voice recording."); } }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primary, cursor: "pointer", border: `1px solid ${t.primary}` }}>
                      <Mic size={16} color={t.bubbleMeText} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.bubbleMeText }}>🎙️ Voice Note</span>
                    </div>
                  )}
                </div>

                {/* Voice note preview — shown when the user has recorded audio.
                    Lets them play it back, see the duration, and delete it
                    before posting. Hides the photo/video preview slot so the
                    voice note is the sole media of this status. */}
                {(isVoiceRecording || voiceBlob) && (
                  <div style={{ marginBottom: 12, padding: "14px 14px", boxSizing: "border-box", width: "100%", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                    <div onClick={() => { if (isVoiceRecording) stopVoiceRecording(); }} style={{ width: 38, height: 38, borderRadius: "50%", background: isVoiceRecording ? "#FF3B30" : t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, animation: isVoiceRecording ? "nextext-rec-pulse 1s ease-in-out infinite" : "none" }}>
                      <Mic size={16} color="#fff" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                        {isVoiceRecording ? "Recording…" : (voiceBlob ? "Voice note ready" : "")}
                      </div>
                      <div style={{ fontSize: 12, color: t.textMuted, marginTop: 1 }}>
                        {Math.floor((voiceDurationMs || 0) / 1000)}s{Math.floor((voiceDurationMs || 0) / 100) % 10 > 0 ? `.${Math.floor((voiceDurationMs || 0) / 100) % 10}` : ""}
                        {voiceBlob && !isVoiceRecording && " — attach as status audio"}
                      </div>
                      {voiceBlob && !isVoiceRecording && (
                        <audio controls src={URL.createObjectURL(voiceBlob)} style={{ width: "100%", marginTop: 6, height: 32 }} />
                      )}
                    </div>
                    {voiceBlob && !isVoiceRecording && (
                      <div onClick={() => { try { URL.revokeObjectURL(URL.createObjectURL(voiceBlob)); } catch { /* ignore */ } setVoiceBlob(null); setVoiceDurationMs(0); }} style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,59,48,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        <X size={15} color="#FF3B30" />
                      </div>
                    )}
                  </div>
                )}

                {/* Single video/image fallback when no multiple images */}
                {(postMedia || postImages.length === 0) && postMedia && (
                  <div style={{ position: "relative", marginBottom: 12, width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
                    <div ref={mediaPreviewRef} style={{ position: "relative", width: "100%", maxWidth: "none", height: "min(62vh, 520px)", borderRadius: 10, overflow: "hidden", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" }}>
                      {postMediaType === "video" ? (
                        <video src={URL.createObjectURL(postMedia)} controls playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : (
                        <img src={URL.createObjectURL(postMedia)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      )}
                      {/* Draggable, colored text stickers overlaid on the media */}
                      {textStickers.map((s) => (
                        <div
                          key={s.id}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setActiveStickerId(s.id);
                            const rect = mediaPreviewRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            const startX = e.clientX, startY = e.clientY;
                            const origX = s.x, origY = s.y;
                            const move = (ev) => {
                              const dx = (ev.clientX - startX) / rect.width;
                              const dy = (ev.clientY - startY) / rect.height;
                              updateSticker(s.id, {
                                x: Math.max(0.02, Math.min(0.98, origX + dx)),
                                y: Math.max(0.02, Math.min(0.98, origY + dy)),
                              });
                            };
                            const up = () => {
                              window.removeEventListener("pointermove", move);
                              window.removeEventListener("pointerup", up);
                            };
                            window.addEventListener("pointermove", move);
                            window.addEventListener("pointerup", up);
                          }}
                          style={{
                            position: "absolute",
                            left: `${s.x * 100}%`,
                            top: `${s.y * 100}%`,
                            transform: "translate(-50%, -50%)",
                            color: s.color,
                            fontSize: s.size,
                            fontWeight: 800,
                            textShadow: "0 1px 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.85)",
                            padding: "2px 6px",
                            background: activeStickerId === s.id ? "rgba(124,92,255,0.35)" : "transparent",
                            borderRadius: 6,
                            cursor: "move",
                            whiteSpace: "pre-wrap",
                            maxWidth: "90%",
                            textAlign: "center",
                            userSelect: "none",
                          }}
                        >{s.text}</div>
                      ))}
                    </div>
                    <div onClick={() => { setPostMedia(null); setPostMediaType(null); setPostMode("text"); }} style={{ position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: "50%", background: "#FF3B30", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <X size={12} color="#fff" />
                    </div>
                  </div>
                )}

                <textarea
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder="Add a caption…"
                  rows={2}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13.5, background: t.bg, color: t.text, resize: "none", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 12 }}
                />
              </div>
            )}

            {/* Wait for video to finish */}
            {postMode === "media" && postMediaType === "video" && postMedia && (
              <div style={{ marginBottom: 12, padding: "12px 14px", boxSizing: "border-box", width: "100%", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={waitForVideo}
                  onChange={(e) => setWaitForVideo(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: t.primary, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: t.text }}>Wait for video to finish before advancing</span>
              </div>
            )}

            {/* Duration slider — hidden for video statuses, which play the full
                video (bar follows the video's real length instead). */}
            {!(postMode === "media" && postMediaType === "video") && (
            <div style={{ marginBottom: 12, padding: "14px 16px", boxSizing: "border-box", width: "100%", overflowX: "auto", whiteSpace: "nowrap", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: t.text, whiteSpace: "nowrap" }}>Status lifespan duration</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: t.primary, flexShrink: 0, marginLeft: 8 }}>{durationSeconds}s</span>
              </div>
              <input type="range" min="1" max="15" step="1" value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} style={{ width: "100%", boxSizing: "border-box", accentColor: t.primary, height: 30, minHeight: 30 }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: t.textMuted, marginTop: 4 }}>
                <span>1s</span><span>15s</span>
              </div>
            </div>
            )}

            {/* Movable, colored text stickers for media mode */}
            {postMode === "media" && (postMedia || postImages.length > 0) && (
              <div style={{ marginBottom: 12 }}>
                <div onClick={addTextSticker} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primary, color: t.bubbleMeText, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
                  <Type size={15} /> Add text on media
                </div>
                {textStickers.length > 0 && (
                  <div style={{ marginTop: 10, padding: "12px 12px", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}` }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, marginBottom: 8 }}>Edit text sticker</div>
                    {activeStickerId && (
                      <>
                        <input
                          autoFocus
                          value={textStickers.find((s) => s.id === activeStickerId)?.text || ""}
                          onChange={(e) => updateSticker(activeStickerId, { text: e.target.value })}
                          placeholder="Sticker text…"
                          style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13.5, background: t.surface, color: t.text, boxSizing: "border-box", fontFamily: "inherit", marginBottom: 10 }}
                        />
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                          {STICKER_COLORS.map((c) => (
                            <div key={c} onClick={() => updateSticker(activeStickerId, { color: c })} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: textStickers.find((s) => s.id === activeStickerId)?.color === c ? `3px solid ${t.primary}` : "2px solid transparent", cursor: "pointer", flexShrink: 0 }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: 12, color: t.textMuted }}>Size</span>
                          <input type="range" min="12" max="48" step="1" value={textStickers.find((s) => s.id === activeStickerId)?.size || 22} onChange={(e) => updateSticker(activeStickerId, { size: Number(e.target.value) })} style={{ flex: 1, accentColor: t.primary }} />
                          <div onClick={() => removeSticker(activeStickerId)} style={{ padding: "5px 10px", borderRadius: 8, background: "rgba(255,59,48,0.15)", color: "#FF3B30", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Delete</div>
                        </div>
                        <div style={{ fontSize: 11, color: t.textMuted }}>Drag the text on the preview to reposition it.</div>
                      </>
                    )}
                    {!activeStickerId && (
                      <div style={{ fontSize: 12, color: t.textMuted }}>Tap a sticker on the preview to edit it.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Allow download toggle for media statuses */}
            {postMode === "media" && (
              <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Download size={18} color={t.primary} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>Allow download</div>
                    <div style={{ fontSize: 11.5, color: t.textMuted }}>Let viewers save this status to their device</div>
                  </div>
                </div>
                <button
                  onClick={() => setAllowDownload((v) => !v)}
                  aria-label={allowDownload ? "Disable download" : "Enable download"}
                  style={{ width: 46, height: 26, borderRadius: 13, background: allowDownload ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.15s ease" }}
                >
                  <span style={{ position: "absolute", top: 3, left: allowDownload ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
                </button>
              </div>
            )}

            {/* Hide comments toggle */}
            <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <MessageCircle size={18} color={t.primary} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>Hide comments</div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>Disable comments on this status</div>
                </div>
              </div>
              <button
                onClick={() => setHideComments((v) => !v)}
                aria-label={hideComments ? "Show comments" : "Hide comments"}
                style={{ width: 46, height: 26, borderRadius: 13, background: hideComments ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.15s ease" }}
              >
                <span style={{ position: "absolute", top: 3, left: hideComments ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
              </button>
            </div>

            {/* Public visibility toggle for this status */}
            <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: t.bg, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Globe size={18} color={postPublic ? t.primary : t.textMuted} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>Make public</div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>{postPublic ? "Anyone on NexText can see this" : "Only your NexText contacts"}</div>
                </div>
              </div>
              <button
                onClick={() => setPostPublic((v) => !v)}
                aria-label={postPublic ? "Make contacts-only" : "Make public"}
                style={{ width: 46, height: 26, borderRadius: 13, background: postPublic ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.15s ease" }}
              >
                <span style={{ position: "absolute", top: 3, left: postPublic ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
              </button>
            </div>

            {/* Background audio multi-track mixer */}
            {((postMode === "media" && postMedia) || postMode === "text") && (
              <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}` }}>
                <input ref={audioFileRef} type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setBgAudioFile(f); e.target.value = ""; }} />
                <div onClick={() => audioFileRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: t.primary, fontSize: 13, fontWeight: 600, marginBottom: bgAudioFile ? 8 : 0 }}>
                  🎵 {bgAudioFile ? "Change background audio" : "Add background audio"}
                </div>
                {bgAudioFile && (
                  <>
                    <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgAudioFile.name}</div>

                    {/* Live playground loop player */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div onClick={togglePreview} style={{ width: 34, height: 34, borderRadius: "50%", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        {previewPlaying ? <Pause size={16} color="#fff" /> : <Play size={16} color="#fff" />}
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>Test mix (loop)</span>
                      {postMediaType === "video" && previewVideoURL && (
                        <video ref={previewVideoRef} src={previewVideoURL} loop muted={muteOriginal} style={{ display: "none" }} />
                      )}
                      <audio ref={previewAudioRef} src={previewAudioURL || undefined} loop style={{ display: "none" }} />
                    </div>

                    <div onClick={() => setBgAudioFile(null)} style={{ fontSize: 11.5, color: "#FF3B30", cursor: "pointer", marginBottom: 8, fontWeight: 600 }}>Remove audio</div>

                    {postMediaType === "video" && (
                      <>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: t.text }}>
                          <input
                            type="checkbox"
                            checked={muteOriginal}
                            onChange={(e) => { const checked = e.target.checked; setMuteOriginal(checked); if (previewVideoRef.current) previewVideoRef.current.volume = checked ? 0 : videoVolume / 100; }}
                          />
                          Mute Original Video Sound entirely
                        </label>
                        <div style={{ marginBottom: 6, opacity: muteOriginal ? 0.4 : 1 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: t.text }}>Original Video Sound</span>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: t.primary }}>{videoVolume}%</span>
                          </div>
                          <input type="range" min="0" max="100" step="5" value={videoVolume} disabled={muteOriginal} onChange={(e) => { const val = Number(e.target.value); setVideoVolume(val); if (previewVideoRef.current) previewVideoRef.current.volume = muteOriginal ? 0 : val / 100; }} style={{ width: "100%", accentColor: t.primary }} />
                        </div>
                      </>
                    )}

                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: t.text }}>Background Music Volume</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: t.primary }}>{bgAudioVolume}%</span>
                      </div>
                      <input type="range" min="0" max="100" step="5" value={bgAudioVolume} onChange={(e) => { const val = Number(e.target.value); setBgAudioVolume(val); if (previewAudioRef.current) previewAudioRef.current.volume = val / 100; }} style={{ width: "100%", accentColor: t.primary }} />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Background Music (metadata only — preview streamed on-device by the viewer) */}
            {musicProviderActive !== "disabled" && musicAccessAllowed && ((postMode === "media" && postMedia) || postMode === "text") && (
              <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}` }}>
                <div onClick={() => setMusicModalOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: t.primary, fontSize: 13, fontWeight: 600 }}>
                  <Music size={16} /> Add Music
                </div>
                {bgMusic && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {bgMusic.artwork ? (
                        <img src={bgMusic.artwork} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", background: t.primaryLight, flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 8, background: t.primaryLight, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: t.primary }}>{(bgMusic.title || "?")[0]}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgMusic.title}</div>
                        <div style={{ fontSize: 12, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bgMusic.artist}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: t.primary, marginTop: 2 }}>{bgMusic.provider === "apple" ? "🎵 Apple Music" : bgMusic.provider === "zemer" ? "🎵 Zemer" : ""}</div>
                      </div>
                      <div onClick={() => { const a = bgMusicChipAudioRef.current; if (a) { a.currentTime = bgMusic.start || 0; a.volume = bgMusic.volume ?? 1; a.play().catch(() => {}); } }} title="Preview" style={{ width: 32, height: 32, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        <Play size={14} color={t.primary} />
                      </div>
                      <div onClick={() => setMusicModalOpen(true)} style={{ padding: "6px 10px", borderRadius: 8, background: t.primaryLight, color: t.primary, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Replace</div>
                      <div onClick={() => { try { if (bgMusicChipAudioRef.current) bgMusicChipAudioRef.current.pause(); } catch {} setBgMusic(null); }} style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(255,59,48,0.15)", color: "#FF3B30", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Remove</div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: t.text }}>Song segment</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: t.primary }}>{fmtSecs(bgMusic.start || 0)} → {fmtSecs(Math.min(bgMusic.end || 30, bgMusic.provider === "apple" ? 30 : (bgMusic.durationSec || 300)))}</span>
                      </div>
                      {(() => {
                        const maxSeg = bgMusic.provider === "apple" ? Math.min(bgMusic.durationSec || 30, 30) : Math.min(bgMusic.durationSec || 300, 600);
                        const endVal = Math.min(bgMusic.end || maxSeg, maxSeg);
                        return (
                          <>
                            <input type="range" min="0" max={maxSeg} step="1" value={bgMusic.start || 0} onChange={(e) => { const v = Number(e.target.value); setBgMusic((m) => ({ ...m, start: v, end: Math.max(v + 1, Math.min(m.end || maxSeg, maxSeg)) })); if (bgMusicChipAudioRef.current) { try { bgMusicChipAudioRef.current.currentTime = v; } catch { /* noop */ } } }} style={{ width: "100%", accentColor: t.primary, height: 26, minHeight: 26 }} />
                            <input type="range" min="1" max={maxSeg} step="1" value={endVal} onChange={(e) => { const v = Number(e.target.value); setBgMusic((m) => ({ ...m, end: Math.max(v, (m.start || 0) + 1) })); }} style={{ width: "100%", accentColor: t.primary, height: 26, minHeight: 26 }} />
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: t.textMuted }}>
                              <span>Start</span>
                              <span>End (of {fmtSecs(maxSeg)}{bgMusic.provider === "apple" ? " preview" : ""})</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: t.text }}>Music volume</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: t.primary }}>{Math.round((bgMusic.volume ?? 1) * 100)}%</span>
                      </div>
                      <input type="range" min="0" max="1" step="0.05" value={bgMusic.volume ?? 1} onChange={(e) => setBgMusic((m) => ({ ...m, volume: Number(e.target.value) }))} style={{ width: "100%", accentColor: t.primary, height: 26, minHeight: 26 }} />
                    </div>

                    {postMediaType === "video" && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: t.text }}>
                        <input type="checkbox" checked={!!bgMusic.muted} onChange={(e) => setBgMusic((m) => ({ ...m, muted: e.target.checked }))} />
                        Mute original video sound
                      </label>
                    )}

                    <audio
                      ref={bgMusicChipAudioRef}
                      src={bgMusic.previewUrl}
                      style={{ display: "none" }}
                      onTimeUpdate={(e) => { const end = bgMusic.end || 30; if (e.currentTarget.currentTime >= end) e.currentTarget.pause(); }}
                    />
                  </div>
                )}
              </div>
            )}

            <div style={{ flex: 1, minHeight: 0 }} />

            {postError && (
              <div style={{ color: "#FF3B30", fontSize: 12.5, fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>{postError}</div>
            )}

            <button
              onClick={handlePost}
              disabled={posting || (postMode === "text" && !postText.trim()) || (postMode === "media" && !postMedia && postImages.length === 0 && !voiceBlob)}
              style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: ((postMode === "text" && postText.trim()) || (postMode === "media" && (postMedia || postImages.length > 0 || voiceBlob))) ? t.primary : t.border, color: ((postMode === "text" && postText.trim()) || (postMode === "media" && (postMedia || postImages.length > 0 || voiceBlob))) ? t.bubbleMeText : t.textMuted, fontWeight: 700, fontSize: 15, cursor: ((postMode === "text" && postText.trim()) || (postMode === "media" && (postMedia || postImages.length > 0 || voiceBlob))) ? "pointer" : "not-allowed" }}
            >
              {posting ? "Posting…" : "Post Status"}
            </button>
          </div>
        </div>,
        document.body
      )}

      {musicModalOpen && (
        <MusicSearchModal
          onClose={() => setMusicModalOpen(false)}
          onSelect={handleSelectMusic}
          globalSettings={globalSettings}
          userDoc={myUserDoc}
          t={t}
        />
      )}
    </div>
  );
}

// ── Music search modal (Status Builder "Add Music") ───────────────────────────
// Streams 30s preview clips from the iTunes Search API and stores metadata ONLY.
// No audio blob is ever uploaded; downloads (when permitted) save locally.
function fmtSecs(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}
function MusicSearchModal({ onClose, onSelect, globalSettings, userDoc, t }) {
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
    if (playingId === track.trackId) { a.pause(); setPlayingId(null); setPreviewPos(0); return; }
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
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 2147481100, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
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
            const canPreview = !!previewUrl;
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
              {!dl.allowed && dl.reason && (
                <div title={dl.reason} style={{ fontSize: 10.5, color: t.textMuted, maxWidth: 90, flexShrink: 0, lineHeight: 1.2 }}>{dl.reason}</div>
              )}
            </div>
            );
          })}
        </div>
        {/* Apple preview: real seek bar bound to the ACTUAL preview duration (never
            presented as the full song). Zemer previews via the legitimate YouTube
            embed (Zemer's own playback source) with YouTube's native controls. */}
        {playingId && chosenProvider === "apple" && (
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
                src={`https://www.youtube.com/embed/${zemerPreviewId}?autoplay=1&rel=0&modestbranding=1`}
                title="Zemer preview"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
              />
            </div>
            <div style={{ fontSize: 10.5, color: t.textMuted, marginTop: 4 }}>
              Zemer plays through YouTube. Full-length preview with YouTube's own play/pause/seek controls.
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
