import { useState, useRef, useEffect } from "react";
import { Camera, Users, Check, X } from "lucide-react";
import Avatar from "./Avatar";
import { uploadChatFile } from "../supabase/media";
import { sendMediaMessage, getOrCreateDirectChat } from "../firebase/chats";
import { postStatus } from "../firebase/status";

const GLOBAL_CAMERA_FILTERS = [
  { id: "none", label: "None", css: "" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.05)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.85)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.8) contrast(1.1)" },
  { id: "cool", label: "Cool", css: "hue-rotate(180deg) saturate(1.2)" },
  { id: "warm", label: "Warm", css: "sepia(0.35) saturate(1.4) hue-rotate(-15deg)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.6) brightness(0.9)" },
  { id: "pop", label: "Pop", css: "saturate(2) contrast(1.3)" },
  { id: "vintage", label: "Vintage", css: "sepia(0.55) contrast(1.2) saturate(1.3) brightness(1.05)" },
  { id: "bw", label: "B&W", css: "grayscale(1) brightness(1.1)" },
];

export default function GlobalCamera({ t, myUid, chats, contacts, hideNav, onClose, onOpenChat }) {
  const [step, setStep] = useState("camera"); // "camera" | "preview" | "send"
  const [mode, setMode] = useState("photo"); // "photo" | "video"
  const [facing, setFacing] = useState("environment");
  const [filter, setFilter] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [postingStatus, setPostingStatus] = useState(false);
  const [captured, setCaptured] = useState(null); // { type, blob, url, ext, mime }
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState([]);
  const [disappearing, setDisappearing] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const pinchStartRef = useRef(null);

  const openCamera = async () => {
    setError("");
    setZoom(1);
    try {
      const wantsVideo = mode === "video";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: wantsVideo,
      });
      streamRef.current = stream;
      setStep("camera");
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          if (wantsVideo) videoRef.current.muted = false;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setError("Camera access denied or unavailable.");
    }
  };

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    openCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
      if (captured?.url) URL.revokeObjectURL(captured.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchFacing = () => {
    setFacing((f) => (f === "environment" ? "user" : "environment"));
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setTimeout(() => openCamera(), 50);
  };

  const onTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchStartRef.current = {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        zoom,
      };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches && e.touches.length === 2 && pinchStartRef.current) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = d / pinchStartRef.current.dist;
      setZoom(Math.min(4, Math.max(1, pinchStartRef.current.zoom * ratio)));
      if (e.cancelable) e.preventDefault();
    }
  };

  const cycleFilter = () => setFilter((i) => (i + 1) % GLOBAL_CAMERA_FILTERS.length);

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    const cw = canvas.width, ch = canvas.height;
    const filterCss = GLOBAL_CAMERA_FILTERS[filter]?.css;
    if (filterCss) ctx.filter = filterCss;
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    if (facing === "user") ctx.scale(-1, 1);
    ctx.scale(zoom, zoom);
    ctx.translate(-cw / 2, -ch / 2);
    ctx.drawImage(video, 0, 0);
    ctx.restore();
    ctx.filter = "none";
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      stopStream();
      setCaptured({ type: "image", blob, url, ext: "jpg", mime: "image/jpeg" });
      setCaption("");
      setStep("preview");
    }, "image/jpeg", 0.92);
  };

  const startRecording = () => {
    if (!streamRef.current || recording) return;
    recordedChunksRef.current = [];
    let recorder;
    try {
      recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
    } catch {
      try { recorder = new MediaRecorder(streamRef.current); } catch { return; }
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "video/webm" });
      if (!blob.size) return;
      const url = URL.createObjectURL(blob);
      setCaptured({ type: "video", blob, url, ext: "webm", mime: blob.type });
      setCaption("");
      setStep("preview");
      stopStream();
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  };

  const stopRecording = () => {
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const stopStream = () => {
    if (recording && mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
      setRecording(false);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
  };

  const discard = () => {
    if (captured?.url) URL.revokeObjectURL(captured.url);
    setCaptured(null);
    setCaption("");
    setSelected([]);
    setPostingStatus(false);
    setZoom(1);
    openCamera();
  };

  const toggleRecipient = (chat) => {
    setSelected((prev) => {
      const key = chat.id || chat.type;
      if (prev.some((p) => (p.id || p.type) === key)) return prev.filter((p) => (p.id || p.type) !== key);
      return [...prev, chat];
    });
  };

  const sendToChat = async (target) => {
    if (!captured || !myUid) return;
    const media = captured;
    let chatId = target.id;
    if (target.type !== "group") {
      const otherUid = target.participants?.find((p) => p !== myUid);
      chatId = await getOrCreateDirectChat(myUid, otherUid);
    }
    const file = new File([media.blob], `camera-${Date.now()}.${media.ext}`, { type: media.mime });
    try {
      const result = await uploadChatFile(chatId, myUid, file, { compress: media.type !== "video" });
      const participants = target.participants || [];
      await sendMediaMessage(chatId, myUid, media.type, result, participants, { disappearing: disappearing ? { viewOnce: true } : null });
      if (target.id && onOpenChat) onOpenChat(target);
    } catch { /* keep going */ }
  };

  const sendToSelected = async () => {
    const targets = selected;
    if (!targets.length || !captured) return;
    setSelected([]);
    const media = captured;
    if (media?.url) URL.revokeObjectURL(media.url);
    setCaptured(null);
    for (const target of targets) {
      let chatId = target.id;
      if (target.type !== "group") {
        const otherUid = target.participants?.find((p) => p !== myUid);
        chatId = await getOrCreateDirectChat(myUid, otherUid);
      }
      const file = new File([media.blob], `camera-${Date.now()}.${media.ext}`, { type: media.mime });
      try {
        const result = await uploadChatFile(chatId, myUid, file, { compress: media.type !== "video" });
        await sendMediaMessage(chatId, myUid, media.type, result, target.participants || [], { disappearing: disappearing ? { viewOnce: true } : null });
      } catch { /* keep going */ }
    }
    onClose();
  };

  const postToStatus = async () => {
    if (!captured || !myUid) return;
    setPostingStatus(true);
    try {
      const media = captured;
      const file = new File([media.blob], `status-${Date.now()}.${media.ext}`, { type: media.mime });
      const result = await uploadChatFile(`status-${myUid}`, myUid, file, { compress: media.type !== "video" });
      let durationMs = null;
      if (media.type === "video") {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = media.url;
        await new Promise((res) => {
          v.onloadedmetadata = () => { durationMs = Math.round(v.duration * 1000); res(); };
          v.onerror = () => res();
        });
      }
      await postStatus(myUid, {
        text: caption.trim() || null,
        mediaURL: result.url,
        storagePath: result.storagePath,
        mediaType: media.type,
        backgroundColor: null,
        fontFamily: null,
        durationMs: durationMs || 8000,
        textOverlay: caption.trim() || null,
        waitForVideo: media.type === "video",
      });
      if (captured?.url) URL.revokeObjectURL(captured.url);
      setCaptured(null);
      onClose();
    } catch {
      setPostingStatus(false);
    }
  };

  const close = () => {
    stopStream();
    if (captured?.url) URL.revokeObjectURL(captured.url);
    onClose();
  };

  if (step === "camera") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 2147481000, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", flexShrink: 0 }}>
          <span onClick={close} style={{ color: "#fff", fontSize: 15, cursor: "pointer" }}>Cancel</span>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Camera</span>
          <span style={{ width: 50 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "6px 12px", flexShrink: 0 }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.12)", borderRadius: 20, overflow: "hidden" }}>
            {["photo", "video"].map((m) => (
              <span
                key={m}
                onClick={() => { setMode(m); if (streamRef.current) { streamRef.current.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; } setTimeout(() => openCamera(), 50); }}
                style={{ padding: "6px 16px", fontSize: 13, fontWeight: 700, color: mode === m ? "#000" : "#fff", background: mode === m ? "#fff" : "transparent", borderRadius: 20, cursor: "pointer", textTransform: "capitalize" }}
              >{m}</span>
            ))}
          </div>
          <span onClick={cycleFilter} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.12)", borderRadius: 16, cursor: "pointer" }}>
            {GLOBAL_CAMERA_FILTERS[filter]?.label || "None"}
          </span>
          <span onClick={() => setDisappearing((d) => !d)} title="Disappearing (view once)" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: disappearing ? "#FF3B30" : "rgba(255,255,255,0.12)", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#fff" }}>1×</span>
          <span onClick={switchFacing} title="Flip camera" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer" }}>
            <Camera size={18} color="#fff" />
          </span>
          <span onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.2) * 10) / 10))} title="Zoom out" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer", fontSize: 20, fontWeight: 700, color: "#fff" }}>−</span>
          <span onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.2) * 10) / 10))} title="Zoom in" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer", fontSize: 18, fontWeight: 700, color: "#fff" }}>+</span>
        </div>
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}
        >
          <video ref={videoRef} autoPlay playsInline muted={mode !== "video"} style={{ width: "100%", height: "100%", maxHeight: "70vh", objectFit: "contain", transform: `${facing === "user" ? "scaleX(-1) " : ""}scale(${zoom})`, transformOrigin: "center center", filter: GLOBAL_CAMERA_FILTERS[filter]?.css }} />
        </div>
        {error && <div style={{ color: "#FF3B30", fontSize: 13, textAlign: "center", padding: 8, flexShrink: 0 }}>{error}</div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 16px calc(env(safe-area-inset-bottom, 0px) + 28px)", flexShrink: 0 }}>
          {mode === "photo" ? (
            <div onClick={capturePhoto} style={{ width: 64, height: 64, borderRadius: "50%", border: "4px solid #fff", background: "rgba(255,255,255,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#fff" }} />
            </div>
          ) : (
            <div onClick={recording ? stopRecording : startRecording} style={{ width: 64, height: 64, borderRadius: "50%", border: "4px solid #fff", background: recording ? "#FF3B30" : "rgba(255,255,255,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <div style={{ width: recording ? 26 : 52, height: recording ? 26 : 52, borderRadius: recording ? 6 : "50%", background: "#fff" }} />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 2147481000, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", flexShrink: 0 }}>
          <span onClick={discard} style={{ color: "#fff", fontSize: 15, cursor: "pointer" }}>Discard</span>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Preview</span>
          <span style={{ width: 50 }} />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
          {captured.type === "video"
            ? <video src={captured.url} controls style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            : <img src={captured.url} alt="captured" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
        </div>
        <div style={{ padding: "12px 16px", flexShrink: 0 }}>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption…"
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "0 16px 24px", flexShrink: 0 }}>
          <div onClick={() => { setCaption(""); discard(); }} style={{ flex: 1, padding: 13, borderRadius: 12, border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
            Retake
          </div>
          <div onClick={postToStatus} style={{ flex: 1, padding: 13, borderRadius: 12, border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer", opacity: postingStatus ? 0.6 : 1 }}>
            {postingStatus ? "Posting…" : "Status"}
          </div>
          <div onClick={() => setStep("send")} style={{ flex: 1, padding: 13, borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
            Send
          </div>
        </div>
      </div>
    );
  }

  // step === "send"
  return (
    <div style={{ position: "fixed", inset: 0, background: t.bg, zIndex: 2147481000, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <span onClick={discard} style={{ color: t.text, fontSize: 15, cursor: "pointer" }}>Cancel</span>
        <span style={{ color: t.text, fontWeight: 700, fontSize: 16 }}>Send to…</span>
        <span style={{ width: 50 }} />
      </div>
      <div style={{ padding: 16, borderBottom: `1px solid ${t.border}` }}>
        {captured.type === "video"
          ? <video src={captured.url} style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover" }} />
          : <img src={captured.url} alt="Captured" style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover" }} />}
      </div>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${t.border}` }}>
        <div onClick={postToStatus} style={{ padding: "12px 14px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer", opacity: postingStatus ? 0.6 : 1 }}>
          {postingStatus ? "Posting…" : "Post on Status"}
        </div>
      </div>
      <div className="nx-scroll" style={{ flex: 1, paddingBottom: hideNav ? 80 : 140 }}>
        {contacts.length === 0 && <div style={{ padding: 20, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No contacts to send to.</div>}
        {contacts.map((c) => {
          const otherUid = c.uid;
          const chatForContact = chats.find((ch) => ch.type !== "group" && ch.participants?.includes(myUid) && ch.participants?.includes(otherUid));
          const sel = selected.some((p) => (p.id || p.type) === (chatForContact?.id || `direct:${otherUid}`));
          return (
            <div key={c.uid} onClick={() => toggleRecipient(chatForContact || { id: `direct:${otherUid}`, type: "direct", participants: [myUid, otherUid] })} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: sel ? t.primaryLight : "transparent" }}>
              <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={42} />
              <span style={{ fontSize: 15, fontWeight: 600, color: t.text, flex: 1 }}>{c.profile?.displayName}</span>
              {sel && <Check size={18} color={t.primary} />}
            </div>
          );
        })}
        {chats.filter((c) => c.type === "group").map((c) => {
          const sel = selected.some((p) => (p.id || p.type) === c.id);
          return (
            <div key={c.id} onClick={() => toggleRecipient(c)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: sel ? t.primaryLight : "transparent" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={20} color={t.primary} /></div>
              <span style={{ fontSize: 15, fontWeight: 600, color: t.text, flex: 1 }}>{c.groupName}</span>
              {sel && <Check size={18} color={t.primary} />}
            </div>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div style={{ display: "flex", gap: 10, padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)", borderTop: `1px solid ${t.border}`, background: t.surface, flexShrink: 0 }}>
          <div onClick={() => setSelected([])} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${t.border}`, color: t.text, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
            Clear
          </div>
          <div onClick={sendToSelected} style={{ flex: 1, padding: "12px 14px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
            Send to {selected.length}
          </div>
        </div>
      )}
    </div>
  );
}
