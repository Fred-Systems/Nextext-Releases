import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Plus, Camera, X, Video, Type, Palette, Eye, Trash2, Play, Pause, RefreshCw, Mic, MessageCircle, Download } from "lucide-react";
import { useTheme, FONTS } from "../theme/ThemeContext";
import { postStatus, useStatuses, viewStatus, useStatusViewers, deleteStatus } from "../firebase/status";
import { useContacts } from "../firebase/contacts";
import { useChats, getOrCreateDirectChat, sendMediaMessage } from "../firebase/chats";
import { uploadChatFile } from "../supabase/media";
import { uploadMediaFile, RawFileTooLargeError } from "../services/mediaUpload";
import CameraCapture from "../components/CameraCapture";
import { doc, onSnapshot, updateDoc, setDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import Avatar from "../components/Avatar";
import StatusStoryViewer from "./StatusStoryViewer";
import { getMicrophoneStream } from "../media/microphone";
import { base64ToBlob } from "../media/base64";
import { useGlobalSettings } from "../firebase/config-settings";

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
  const globalSettings = useGlobalSettings();
  const hideStatusCamera = globalSettings?.hideStatusCamera === true;
  const hideStatusVoiceNote = globalSettings?.hideStatusVoiceNote === true;
  // Admin-controlled preview mode: 'video_loop' (default) shows animated clips;
  // 'static_picture' shows only poster JPEGs (maximum data savings).
  const statusPreviewMode = globalSettings?.status_preview_mode || "video_loop";
  const forceStaticPreview = statusPreviewMode === "static_picture";
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
  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      const d = snap.data();
      setBlockStatus(!!d?.restrictions?.blockStatus);
      setIsAdmin(d?.role === "admin");
      if (d?.statusLayout) { setStatusLayout(d.statusLayout); try { localStorage.setItem("nextext_status_layout", d.statusLayout); } catch {} }
      if (d?.statusPreviewSize) { setStatusPreviewSize(d.statusPreviewSize); try { localStorage.setItem("nextext_status_preview_size", d.statusPreviewSize); } catch {} }
      if (d?.displayName || d?.username) setMyDisplayName(d.displayName || d.username || myUid);
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
  const [cameraCapture, setCameraCapture] = useState(null); // { target: "chat" | "builder" }
  const { chats } = useChats(myUid);
  const [cameraError, setCameraError] = useState("");
  const [postError, setPostError] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [waitForVideo, setWaitForVideo] = useState(false);
  const [textOverlay, setTextOverlay] = useState("");
  const [bgAudioFile, setBgAudioFile] = useState(null);
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
      if (showPost) { setShowPost(false); setPostMedia(null); setPostText(""); setPostMode("text"); return; }
      if (viewStoryOwner) { setViewStoryOwner(null); return; }
    };
    window.addEventListener("nextextCloseStatusBuilder", onClose);
    return () => window.removeEventListener("nextextCloseStatusBuilder", onClose);
  }, [showPost, showCamera, viewStoryOwner, showCaptureActions]);
  const photoInputRef = useRef(null);
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

  const myStatuses = statuses.filter((s) => s.ownerId === myUid);
  const contactStatuses = statuses.filter((s) => s.ownerId !== myUid);

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
    setBgAudioFile(null);
    setBgAudioVolume(70);
    setVideoVolume(100);
    setMuteOriginal(false);
    setAllowDownload(true);
    setHideComments(false);
    setPreviewZoom(1);
    setShowZoomHint(false);
    setPostError("");
    setShowPost(true);
  };

   const handlePost = async () => {
    if (postMode === "text" && !postText.trim() && !voiceBlob) return;
    if (postMode === "media" && !postMedia && postImages.length === 0 && !voiceBlob) {
      setPostError("Please select an image, video, or record something.");
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
    setShowPost(false);
    setPostText("");
    setPostMedia(null);
    setPostMediaType(null);
    setPostImages([]);
    setTextOverlay("");
    setBgAudioFile(null);
    setVoiceBlob(null);
    setIsVoiceRecording(false);
    setPosting(true);
    setPostError("");
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
          allowDownload: snapAllowDownload,
          commentsHidden: snapHideComments,
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
           allowDownload: snapAllowDownload,
           commentsHidden: snapHideComments,
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
            bgAudioURL,
            bgAudioVolume: bgAudioVol,
            videoVolume: vidVol,
            waitForVideo: snapWaitForVideo,
            allowDownload: snapAllowDownload,
            commentsHidden: snapHideComments,
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
          });
        } else {
          const result = await uploadMediaFile(`status-${myUid}`, myUid, file);
          let durationMs = null;
          let previewURL = null;
          if (isVideo) {
            durationMs = await getVideoDuration(snapMedia);
            // Generate lightweight preview clip + poster for the feed card.
            try {
              const { generateStatusPreview } = await import("../media/videoPreview.js");
              const { previewBlob, posterBlob } = await generateStatusPreview(snapMedia);
              if (previewBlob) {
                const previewFile = new File([previewBlob], `status-preview-${Date.now()}.webm`, { type: previewBlob.type || "video/webm" });
                const previewResult = await uploadMediaFile(`status-${myUid}`, myUid, previewFile);
                previewURL = previewResult.url;
              }
              if (posterBlob) {
                const posterFile = new File([posterBlob], `status-poster-${Date.now()}.jpg`, { type: "image/jpeg" });
                const posterResult = await uploadMediaFile(`status-${myUid}`, myUid, posterFile);
                await postStatus(myUid, {
                  text: snapText.trim() || null,
                  mediaURL: result.url,
                  mediaType: "video",
                  backgroundColor: null,
                  fontFamily: null,
                  durationMs: durationMs || snapDuration * 1000,
                  textOverlay: snapTextOverlay.trim() || null,
                  bgAudioURL,
                  bgAudioVolume: bgAudioVol,
                  videoVolume: vidVol,
                  waitForVideo: isVideo && snapWaitForVideo,
                  allowDownload: snapAllowDownload,
                  commentsHidden: snapHideComments,
                  previewURL: previewURL || null,
                  posterURL: posterResult.url,
                });
              } else {
                await postStatus(myUid, {
                  text: snapText.trim() || null,
                  mediaURL: result.url,
                  mediaType: "video",
                  backgroundColor: null,
                  fontFamily: null,
                  durationMs: durationMs || snapDuration * 1000,
                  textOverlay: snapTextOverlay.trim() || null,
                  bgAudioURL,
                  bgAudioVolume: bgAudioVol,
                  videoVolume: vidVol,
                  waitForVideo: isVideo && snapWaitForVideo,
                  allowDownload: snapAllowDownload,
                  commentsHidden: snapHideComments,
                  previewURL: previewURL || null,
                });
              }
            } catch {
              // Preview generation failed — post without preview.
              await postStatus(myUid, {
                text: snapText.trim() || null,
                mediaURL: result.url,
                mediaType: "video",
                backgroundColor: null,
                fontFamily: null,
                durationMs: durationMs || snapDuration * 1000,
                textOverlay: snapTextOverlay.trim() || null,
                bgAudioURL,
                bgAudioVolume: bgAudioVol,
                videoVolume: vidVol,
                waitForVideo: isVideo && snapWaitForVideo,
                allowDownload: snapAllowDownload,
                commentsHidden: snapHideComments,
              });
            }
          } else {
            await postStatus(myUid, {
              text: snapText.trim() || null,
              mediaURL: result.url,
              mediaType: "image",
              backgroundColor: null,
              fontFamily: null,
              durationMs: durationMs || snapDuration * 1000,
              textOverlay: snapTextOverlay.trim() || null,
              bgAudioURL,
              bgAudioVolume: bgAudioVol,
              videoVolume: vidVol,
              waitForVideo: isVideo && snapWaitForVideo,
              allowDownload: snapAllowDownload,
              commentsHidden: snapHideComments,
            });
          }
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
        });
      }

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
            audio: captureMode === "video",
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
          try { recorder = new MediaRecorder(stream, { mimeType: "video/webm" }); }
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
    setViewStoryOwner({ statuses: items, initialIndex: 0, ownerUid });
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
        <div onClick={() => setCameraCapture({ target: "chat" })} title="Camera" style={{ marginLeft: "auto", width: 38, height: 38, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Camera size={20} color={t.primary} />
        </div>
        <div style={{ display: "flex", background: t.primaryLight, borderRadius: 16, overflow: "hidden", flexShrink: 0 }}>
          {["cards", "list", "rows"].map((l) => (
            <span
              key={l}
              onClick={() => changeStatusLayout(l)}
              style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: statusLayout === l ? "#fff" : t.text, background: statusLayout === l ? t.primary : "transparent", cursor: "pointer" }}
            >{l}</span>
          ))}
        </div>
        {statusLayout === "cards" && (
          <div style={{ display: "flex", background: t.primaryLight, borderRadius: 16, overflow: "hidden", flexShrink: 0 }}>
            {["compact", "cozy"].map((s) => (
              <span
                key={s}
                onClick={() => changeStatusPreviewSize(s)}
                style={{ padding: "6px 10px", fontSize: 12, fontWeight: 700, textTransform: "capitalize", color: statusPreviewSize === s ? "#fff" : t.text, background: statusPreviewSize === s ? t.primary : "transparent", cursor: "pointer" }}
              >{s}</span>
            ))}
          </div>
        )}
      </div>

      <div className="nx-scroll" style={{ flex: 1, paddingBottom: 70, minHeight: 0 }}>
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
            <div onClick={() => setCameraCapture({ target: "builder" })} title="Camera" style={{ width: 40, height: 40, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
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
            <div onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this status update early?")) { deleteStatus(s.id).catch(() => {}); } }} style={{ padding: 4, cursor: "pointer", flexShrink: 0 }}>
              <Trash2 size={15} color="#FF3B30" />
            </div>
          </div>
        ))}

        {Object.keys(grouped).length > 0 && <SectionHeader label="Recent Updates" />}
        {statusLayout === "list" ? (
          <div style={{ display: "flex", overflowX: "auto", overflowY: "hidden", padding: "10px 16px 14px", WebkitOverflowScrolling: "touch", onTouchMove: (e) => e.stopPropagation() }}>
            {Object.entries(grouped).map(([uid, items]) => {
              const contact = acceptedContacts.find((c) => c.uid === uid);
              const name = contact?.profile?.displayName || "Unknown";
              const latest = items[items.length - 1];
              return (
                <div
                  key={uid}
                  onClick={() => openStory(items, uid)}
                  style={{ flexShrink: 0, width: 158, marginRight: 10, borderRadius: 14, border: `2px solid ${isViewed(uid) ? t.border : t.primary}`, overflow: "hidden", background: t.surface, cursor: "pointer", boxSizing: "border-box" }}
                >
                  <div style={{ position: "relative", paddingBottom: "120%", background: "#000" }}>
                    {latest.mediaURL ? (
                      latest.mediaType === "video" ? (
                        forceStaticPreview ? (
                          <img src={latest.posterURL || latest.mediaURL} alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <video src={latest.previewURL || latest.mediaURL} poster={latest.posterURL || undefined} muted autoPlay loop playsInline preload="metadata" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        )
                      ) : (
                        <img src={latest.mediaURL} alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                      )
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
                        forceStaticPreview ? (
                          <img src={latest.posterURL || latest.mediaURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <video src={latest.previewURL || latest.mediaURL} poster={latest.posterURL || undefined} muted autoPlay loop playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        )
                      ) : <img src={latest.mediaURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
              const viewed = isViewed(uid);
              return (
                <div key={uid} onClick={() => openStory(items, uid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: t.surface }}>
                  <Avatar photoURL={contact?.profile?.photoURL} name={name} uid={uid} size={42} hasActiveStatus statusViewed={viewed} blockStatus={blockStatus} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                    <div style={{ fontSize: 12, color: t.textMuted }}>{items.length} update{items.length > 1 ? "s" : ""} · {timeAgo(latest.createdAt)}</div>
                  </div>
                    <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "#000", flexShrink: 0 }}>
                    {latest.mediaURL ? (
                      latest.mediaType === "video" ? (
                        forceStaticPreview ? (
                          <img src={latest.posterURL || latest.mediaURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <video src={latest.previewURL || latest.mediaURL} poster={latest.posterURL || undefined} muted autoPlay loop playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        )
                      ) : <img src={latest.mediaURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                        forceStaticPreview ? (
                          <img src={latest.posterURL || latest.mediaURL} alt="" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                         <video src={latest.previewURL || latest.mediaURL} poster={latest.posterURL || undefined} muted autoPlay loop playsInline preload="metadata" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        )
                      ) : (
                        <img src={latest.mediaURL} alt="" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
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
                        <video src={latest.previewURL || latest.mediaURL} poster={latest.posterURL || undefined} muted autoPlay loop playsInline preload="metadata" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />

                    ) : (
                      <img src={latest.mediaURL} alt="" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover" }} />
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
          onNext={() => advanceToNextOwner(viewStoryOwner.ownerUid)}
        />
      )}

      {viewerModalStatusId && (
        <StatusViewerModal statusId={viewerModalStatusId} contacts={acceptedContacts} onClose={() => setViewerModalStatusId(null)} t={t} />
      )}

      {/* Shared in-app camera (identical to the chats top-bar camera).
          Portaled to document.body so it always renders on top of every screen
          in the stack (previously it was nested inside the status screen, which
          left it hidden behind other mounted screens). */}
      {cameraCapture && createPortal(
        <CameraCapture
          t={t}
          myUid={myUid}
          acceptedContacts={acceptedContacts}
          chats={chats}
          target={cameraCapture.target}
          onClose={() => setCameraCapture(null)}
          onCaptured={({ blob, type, caption }) => {
            setPostMedia(blob);
            setPostMediaType(type);
            setPostMode("media");
            setWaitForVideo(type === "video");
            if (caption) setPostText((prev) => (prev ? prev + " " + caption : caption));
          }}
        />,
        document.body
      )}

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
                    <div onClick={() => setCameraCapture({ target: "builder" })} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
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
                    <div style={{ width: "100%", maxWidth: "none", height: "min(62vh, 520px)", borderRadius: 10, overflow: "hidden", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {postMediaType === "video" ? (
                        <video src={URL.createObjectURL(postMedia)} controls playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : (
                        <img src={URL.createObjectURL(postMedia)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      )}
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

            {/* Duration slider */}
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

            {/* Text overlay for media mode */}
            {postMode === "media" && (postMedia || postImages.length > 0) && (
              <div style={{ marginBottom: 12 }}>
                <input
                  value={textOverlay}
                  onChange={(e) => setTextOverlay(e.target.value)}
                  placeholder="Add text overlay on media…"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, boxSizing: "border-box", fontFamily: "inherit" }}
                />
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
    </div>
  );
}
