import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Plus, Camera, X, Video, Type, Palette, Eye, Trash2, Play, Pause, RefreshCw, Mic } from "lucide-react";
import { useTheme, FONTS } from "../theme/ThemeContext";
import { postStatus, useStatuses, viewStatus, useStatusViewers, deleteStatus } from "../firebase/status";
import { useContacts } from "../firebase/contacts";
import { uploadChatFile } from "../supabase/media";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import Avatar from "../components/Avatar";
import StatusStoryViewer from "./StatusStoryViewer";

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
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
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

export default function StatusScreen({ myUid, myName, onBack, onStoryViewerChange, initialViewStatuses, statusOrigin, onConsumeInitialView }) {
  const { t } = useTheme();
  const { contacts } = useContacts(myUid);
  const [blockStatus, setBlockStatus] = useState(false);
  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      setBlockStatus(!!snap.data()?.restrictions?.blockStatus);
    });
    return unsub;
  }, [myUid]);
  const [showPost, setShowPost] = useState(false);
  const [postText, setPostText] = useState("");
  const [postMedia, setPostMedia] = useState(null);
  const [postMediaType, setPostMediaType] = useState(null);
  const [bgColorIdx, setBgColorIdx] = useState(0);
  const [fontIdx, setFontIdx] = useState(0);
  const [postMode, setPostMode] = useState("text");
  const [posting, setPosting] = useState(false);
  const [viewStoryOwner, setViewStoryOwner] = useState(null);
  const [viewedMap, setViewedMap] = useState(() => getStoredViewed());
  const [showCamera, setShowCamera] = useState(false);
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
    setPreviewZoom(1);
    setShowZoomHint(false);
    setPostError("");
    setShowPost(true);
  };

  const handlePost = async () => {
    if (postMode === "text" && !postText.trim()) return;
    if (postMode === "media" && !postMedia && postImages.length === 0) {
      setPostError("Please select an image, video, or record something.");
      return;
    }
    setPosting(true);
    setPostError("");
    try {
      // Handle voice-note status — a recorded audio blob with optional caption
      // (and optional background image). Uploaded the same way chat voice
      // notes are (Supabase `chat-media` bucket) and posted as mediaType
      // "voice" so the viewer can play it back inline.
      if (postMode === "media" && voiceBlob) {
        const voiceFile = new File([voiceBlob], `status-voice-${Date.now()}.webm`, { type: voiceBlob.type || "audio/webm" });
        const voiceResult = await uploadChatFile(`status-${myUid}`, myUid, voiceFile, { compress: false });
        await postStatus(myUid, {
          text: postText.trim() || null,
          mediaURL: voiceResult.url,
          mediaType: "voice",
          backgroundColor: null,
          fontFamily: null,
          durationMs: voiceDurationMs || durationSeconds * 1000,
          textOverlay: textOverlay.trim() || null,
        });
      }
      // Handle multiple images - send as separate status updates
      if (postMode === "media" && postImages.length > 0 && !voiceBlob) {
        for (let i = 0; i < postImages.length; i++) {
          const img = postImages[i];
          const file = new File([img], `status-${Date.now()}-${i}.jpg`, { type: "image/jpeg" });
          const result = await uploadChatFile(`status-${myUid}`, myUid, file, { compress: true });
          await postStatus(myUid, {
            text: postText.trim() || null,
            mediaURL: result.url,
            mediaType: "image",
            backgroundColor: null,
            fontFamily: null,
            durationMs: durationSeconds * 1000,
            textOverlay: textOverlay.trim() || null,
          });
        }
        setPostImages([]);
      }

      // Handle single video or single image from postMedia
      if (postMode === "media" && postMedia && !voiceBlob) {
        const isVideo = postMediaType === "video";
        const ext = isVideo ? "mp4" : "jpg";
        const mime = isVideo ? "video/mp4" : "image/jpeg";
        const file = new File([postMedia], `status-${Date.now()}.${ext}`, { type: mime });
        const result = await uploadChatFile(`status-${myUid}`, myUid, file, { compress: !isVideo });
        let durationMs = null;
        if (isVideo) {
          durationMs = await getVideoDuration(postMedia);
        }
        let bgAudioURL = null;
        let bgAudioVol = null;
        let vidVol = null;
        if (bgAudioFile) {
          const audioFile = new File([bgAudioFile], `status-audio-${Date.now()}.mp3`, { type: bgAudioFile.type || "audio/mpeg" });
          const audioResult = await uploadChatFile(`status-${myUid}`, myUid, audioFile, { compress: false });
          bgAudioURL = audioResult.url;
          bgAudioVol = bgAudioVolume;
          vidVol = muteOriginal ? 0 : videoVolume;
        }
        await postStatus(myUid, {
          text: postText.trim() || null,
          mediaURL: result.url,
          mediaType: isVideo ? "video" : "image",
          backgroundColor: null,
          fontFamily: null,
          durationMs: durationMs || durationSeconds * 1000,
          textOverlay: textOverlay.trim() || null,
          bgAudioURL,
          bgAudioVolume: bgAudioVol,
          videoVolume: vidVol,
          waitForVideo: isVideo && waitForVideo,
        });
      }

      // Handle text status (with optional background audio)
      if (postMode === "text") {
        let bgAudioURL = null;
        let bgAudioVol = null;
        if (bgAudioFile) {
          const audioFile = new File([bgAudioFile], `status-audio-${Date.now()}.mp3`, { type: bgAudioFile.type || "audio/mpeg" });
          const audioResult = await uploadChatFile(`status-${myUid}`, myUid, audioFile, { compress: false });
          bgAudioURL = audioResult.url;
          bgAudioVol = bgAudioVolume;
        }
        await postStatus(myUid, {
          text: postText.trim(),
          mediaURL: null,
          mediaType: null,
          backgroundColor: STATUS_BG_COLORS[bgColorIdx],
          fontFamily: FONTS[fontIdx].value,
          durationMs: durationSeconds * 1000,
          textOverlay: null,
          bgAudioURL,
          bgAudioVolume: bgAudioVol,
          videoVolume: null,
        });
      }

      setPostText("");
      setPostMedia(null);
      setPostMediaType(null);
      setPostImages([]);
      setTextOverlay("");
      setBgAudioFile(null);
      setVoiceBlob(null);
      setVoiceDurationMs(0);
      setIsVoiceRecording(false);
      setPostError("");
      setShowPost(false);
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
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
        cameraStreamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: captureMode === "video",
      });
      cameraStreamRef.current = stream;
      setCameraFacing(facing);
      setCameraMode(captureMode);
      setShowCamera(true);
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      if (captureMode === "video") {
        cameraRecordingRef.current = new MediaRecorder(stream, { mimeType: "video/webm" });
        const chunks = [];
        cameraRecordingRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        cameraRecordingRef.current.onstop = async () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          const file = new File([blob], `status-cam-${Date.now()}.webm`, { type: "video/webm" });
          setPostMedia(file);
          setPostMediaType("video");
          setPostMode("media");
          setShowCamera(false);
          stopCameraStream();
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

  const capturePhotoFromCamera = () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `status-cam-${Date.now()}.jpg`, { type: "image/jpeg" });
      setPostMedia(file);
      setPostMediaType("image");
      setPostMode("media");
      setShowCamera(false);
      stopCameraStream();
    }, "image/jpeg", 0.92);
  };

  const stopCameraStream = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
      cameraStreamRef.current = null;
    }
    if (cameraTimerRef.current) { clearTimeout(cameraTimerRef.current); cameraTimerRef.current = null; }
  };

  const stopVoiceRecording = () => {
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg;codecs=opus" });
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
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        setVoiceBlob(blob);
        setVoiceDurationMs(Date.now() - startTime);
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
    // Record view for each status in this story (fire-and-forget)
    if (ownerUid !== myUid) {
      items.forEach((s) => viewStatus(s.id, myUid));
    }
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
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "calc(16px + var(--safe-top)) 16px 16px", gap: 12, background: t.surface, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 18 }}>Status</span>
      </div>

      <div className="nx-scroll" style={{ flex: 1, paddingBottom: 70, minHeight: 0 }}>
        <SectionHeader label="My Status" />
        <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 16px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ position: "relative" }}>
            <Avatar name={myName} uid={myUid} size={50} />
            <div onClick={(e) => { e.stopPropagation(); openPostSheet("text"); }} style={{ position: "absolute", bottom: -2, right: -2, width: 22, height: 22, borderRadius: "50%", background: t.accent, border: `2px solid ${t.bg}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Plus size={13} color="#fff" />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>My Status</div>
            <div style={{ fontSize: 12.5, color: t.textMuted }}>
              {myStatuses.length > 0 ? `${myStatuses.length} update${myStatuses.length > 1 ? "s" : ""}` : "Tap + to add status update"}
            </div>
          </div>
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
        {Object.entries(grouped).map(([uid, items]) => {
          const contact = acceptedContacts.find((c) => c.uid === uid);
          const name = contact?.profile?.displayName || "Unknown";
          const latest = items[items.length - 1];
          return (
            <div
              key={uid}
              onClick={() => openStory(items, uid)}
              style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}
            >
              <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
                <SegmentedRing count={items.length} allViewed={isViewed(uid)} size={50} />
                <div style={{ position: "absolute", top: 3, left: 3 }}>
                  <Avatar photoURL={contact?.profile?.photoURL} name={name} uid={uid} size={44} hasActiveStatus statusViewed={isViewed(uid)} blockStatus={blockStatus} onStatusView={() => openStory(items, uid)} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>{name}</div>
                <div style={{ fontSize: 12.5, color: t.textMuted }}>
                  {items.length} update{items.length > 1 ? "s" : ""} · {timeAgo(latest.createdAt)}
                </div>
              </div>
              {latest.mediaURL && (
                <div style={{ width: 38, height: 38, borderRadius: 6, overflow: "hidden", flexShrink: 0, border: `1px solid ${t.border}` }}>
                  {latest.mediaType === "video" ? (
                    <video src={latest.mediaURL} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <img src={latest.mediaURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                </div>
              )}
              {!latest.mediaURL && latest.backgroundColor && (
                <div style={{ width: 38, height: 38, borderRadius: 6, flexShrink: 0, background: latest.backgroundColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Type size={14} color="#fff" />
                </div>
              )}
            </div>
          );
        })}

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
        />
      )}

      {viewerModalStatusId && (
        <StatusViewerModal statusId={viewerModalStatusId} contacts={acceptedContacts} onClose={() => setViewerModalStatusId(null)} t={t} />
      )}

      {/* Camera overlay */}
      {showCamera && createPortal(
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#000", zIndex: 2147482000, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "calc(12px + var(--safe-top)) 16px 12px", minHeight: 44, flexShrink: 0 }}>
            <X size={22} color="#fff" onClick={() => { setShowCamera(false); stopCameraStream(); }} style={{ cursor: "pointer" }} />
            <div onClick={flipCamera} style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <RefreshCw size={20} color="#fff" />
            </div>
          </div>
          <video
            ref={(el) => {
              cameraVideoRef.current = el;
              if (el && cameraStreamRef.current && !el.srcObject) {
                el.srcObject = cameraStreamRef.current;
                el.play().catch(() => {});
              }
            }}
            autoPlay
            playsInline
            muted
            style={{ flex: 1, width: "100%", height: "100%", objectFit: "contain", minHeight: 0, background: "#000" }}
          />
          {cameraError && <div style={{ position: "absolute", bottom: 100, left: 0, right: 0, textAlign: "center", color: "#FF3B30", fontSize: 13, fontWeight: 600 }}>{cameraError}</div>}
          <div style={{ position: "absolute", bottom: "calc(28px + var(--safe-bottom))", left: 0, right: 0, display: "flex", justifyContent: "center", gap: "min(28px, 7vw)", zIndex: 10 }}>
            <div onClick={capturePhotoFromCamera} style={{ width: "min(64px, 16vw)", height: "min(64px, 16vw)", borderRadius: "50%", border: "4px solid #fff", background: "rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Camera size={26} color="#fff" />
            </div>
            <div
              onClick={() => {
                if (cameraRecordingRef.current && cameraRecordingRef.current.state === "recording") {
                  cameraRecordingRef.current.stop();
                } else {
                  startCamera("video");
                }
              }}
              style={{ width: "min(64px, 16vw)", height: "min(64px, 16vw)", borderRadius: "50%", border: "4px solid #FF3B30", background: cameraRecordingRef.current?.state === "recording" ? "rgba(255,59,48,0.3)" : "rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Video size={26} color="#FF3B30" />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Post status sheet */}
      {showPost && createPortal(
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", zIndex: 2147481000, display: "flex", alignItems: "flex-end" }} onClick={() => { setShowPost(false); setPostMedia(null); setPostText(""); setPostMode("text"); }}>
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
                  <div onClick={() => startCamera("photo")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                    <Camera size={16} color={t.primary} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.primary }}>Camera</span>
                  </div>
                  <div onClick={() => { try { startVoiceRecording(); } catch (e) { setPostError(e?.message || "Could not start voice recording."); } }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, background: t.primary, cursor: "pointer", border: `1px solid ${t.primary}` }}>
                    <Mic size={16} color={t.bubbleMeText} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.bubbleMeText }}>🎙️ Voice Note</span>
                  </div>
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
              disabled={posting || (postMode === "text" && !postText.trim()) || (postMode === "media" && !postMedia && postImages.length === 0)}
              style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: ((postMode === "text" && postText.trim()) || (postMode === "media" && (postMedia || postImages.length > 0))) ? t.primary : t.border, color: ((postMode === "text" && postText.trim()) || (postMode === "media" && (postMedia || postImages.length > 0))) ? t.bubbleMeText : t.textMuted, fontWeight: 700, fontSize: 15, cursor: ((postMode === "text" && postText.trim()) || (postMode === "media" && (postMedia || postImages.length > 0))) ? "pointer" : "not-allowed" }}
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
