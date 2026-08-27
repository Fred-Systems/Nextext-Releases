import React, { useState, useRef, useEffect } from "react";
import { FlipHorizontal2, Check, Users } from "lucide-react";
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

// Reusable in-app camera, identical to the one on the chats top bar.
// target: "chat" | "status" | "builder"
//   - chat/status: after capture, shows the "Send to…" sheet (chat list + Post on Status)
//   - builder: after capture, hands the media back via onCaptured and closes
export default function CameraCapture({
  t,
  myUid,
  acceptedContacts = [],
  chats = [],
  target = "chat",
  onClose,
  onPostStatus,
  onCaptured,
}) {
  const [showCamera, setShowCamera] = useState(true);
  const [mode, setMode] = useState("photo");
  const [facing, setFacing] = useState("environment");
  const [filterIdx, setFilterIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [captured, setCaptured] = useState(null); // { type, blob, url, ext, mime }
  const [previewStep, setPreviewStep] = useState(false);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState([]);
  const [posting, setPosting] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const pinchRef = useRef(null);

  const openCamera = async (forceFacing) => {
    setError("");
    setShowCamera(true);
    setZoom(1);
    const useFacing = forceFacing || facing;
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
      const wantsVideo = mode === "video";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: useFacing },
        audio: wantsVideo,
      });
      streamRef.current = stream;
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          if (wantsVideo) videoRef.current.muted = false;
          videoRef.current.play().catch(() => {});
        }
      }, 30);
    } catch {
      setError("Camera access denied or unavailable.");
    }
  };

  useEffect(() => {
    openCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, []);

  const switchFacing = async () => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    // Release the camera fully before reopening to avoid "access denied" on
    // older WebViews that hold the device handle briefly after stop().
    await new Promise((r) => setTimeout(r, 150));
    openCamera(next);
  };
  const cycleFilter = () => setFilterIdx((i) => (i + 1) % GLOBAL_CAMERA_FILTERS.length);
  const zoomBy = (d) => setZoom((z) => Math.min(4, Math.max(1, Math.round((z + d) * 10) / 10)));

  const onTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchRef.current = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, zoom };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches && e.touches.length === 2 && pinchRef.current) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      setZoom(Math.min(4, Math.max(1, pinchRef.current.zoom * (d / pinchRef.current.dist))));
      if (e.cancelable) e.preventDefault();
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    const cw = canvas.width, ch = canvas.height;
    const f = GLOBAL_CAMERA_FILTERS[filterIdx]?.css;
    if (f) ctx.filter = f;
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
      setPreviewStep(true);
    }, "image/jpeg", 0.92);
  };

  const startRecording = () => {
    if (!streamRef.current || recording) return;
    chunksRef.current = [];
    let recorder;
    try { recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" }); }
    catch { try { recorder = new MediaRecorder(streamRef.current); } catch { return; } }
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      if (!blob.size) return;
      const url = URL.createObjectURL(blob);
      stopStream();
      setCaptured({ type: "video", blob, url, ext: "webm", mime: blob.type });
      setCaption("");
      setPreviewStep(true);
    };
    recorder.start();
    setRecording(true);
  };
  const stopRecording = () => {
    setRecording(false);
    if (recorderRef.current && recorderRef.current.state === "recording") recorderRef.current.stop();
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
  };

  const closeAll = () => {
    stopStream();
    if (captured?.url) URL.revokeObjectURL(captured.url);
    onClose && onClose();
  };

  const discard = () => {
    if (captured?.url) URL.revokeObjectURL(captured.url);
    setCaptured(null);
    setPreviewStep(false);
    setCaption("");
    setSelected([]);
    if (target === "builder") { closeAll(); return; }
    openCamera();
  };

  const toggleRecipient = (chat) => {
    setSelected((prev) => {
      const key = chat.id || chat.type;
      if (prev.some((p) => (p.id || p.type) === key)) return prev.filter((p) => (p.id || p.type) !== key);
      return [...prev, chat];
    });
  };

  const doPostStatus = async () => {
    if (!captured || !myUid) return;
    setPosting(true);
    try {
      const file = new File([captured.blob], `status-${Date.now()}.${captured.ext}`, { type: captured.mime });
      const result = await uploadChatFile(`status-${myUid}`, myUid, file, { compress: captured.type !== "video" });
      let durationMs = null;
      if (captured.type === "video") {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = captured.url;
        await new Promise((res) => {
          v.onloadedmetadata = () => { durationMs = Math.round(v.duration * 1000); res(); };
          v.onerror = () => res();
        });
      }
      if (onPostStatus) {
        onPostStatus({ mediaURL: result.url, mediaType: captured.type, caption: caption.trim() || null, durationMs: durationMs || 8000 });
      } else {
        await postStatus(myUid, {
          text: caption.trim() || null,
          mediaURL: result.url,
          mediaType: captured.type,
          backgroundColor: null,
          fontFamily: null,
          durationMs: durationMs || 8000,
          textOverlay: caption.trim() || null,
          waitForVideo: captured.type === "video",
        });
      }
      setPosting(false);
      closeAll();
    } catch {
      setPosting(false);
    }
  };

  const sendToSelected = async () => {
    const targets = selected;
    if (!targets.length || !captured) return;
    setSelected([]);
    const media = captured;
    const url = media.url;
    closeAll();
    for (const targetChat of targets) {
      let chatId = targetChat.id;
      if (targetChat.type !== "group") {
        const otherUid = targetChat.participants?.find((p) => p !== myUid);
        chatId = await getOrCreateDirectChat(myUid, otherUid);
      }
      const file = new File([media.blob], `camera-${Date.now()}.${media.ext}`, { type: media.mime });
      try {
        const result = await uploadChatFile(chatId, myUid, file, { compress: media.type !== "video" });
        const participants = targetChat.participants || [];
        await sendMediaMessage(chatId, myUid, media.type, result, participants, {});
      } catch { /* keep going */ }
    }
    if (url) URL.revokeObjectURL(url);
  };

  const sendToSingle = async (targetChat) => {
    if (!captured || !myUid) return;
    const media = captured;
    const url = media.url;
    closeAll();
    let chatId = targetChat.id;
    if (targetChat.type !== "group") {
      const otherUid = targetChat.participants?.find((p) => p !== myUid);
      chatId = await getOrCreateDirectChat(myUid, otherUid);
    }
    const file = new File([media.blob], `camera-${Date.now()}.${media.ext}`, { type: media.mime });
    try {
      const result = await uploadChatFile(chatId, myUid, file, { compress: media.type !== "video" });
      await sendMediaMessage(chatId, myUid, media.type, result, targetChat.participants || [], {});
    } catch { /* silent */ }
    if (url) URL.revokeObjectURL(url);
  };

  // BUILDER target: capture hands media straight back to caller.
  if (target === "builder" && captured && previewStep) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 2147483000, display: "flex", flexDirection: "column" }}>
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
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.3)", fontSize: 14, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "0 16px calc(env(safe-area-inset-bottom, 0px) + 24px)", flexShrink: 0 }}>
          <div onClick={discard} style={{ flex: 1, padding: 13, borderRadius: 12, border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>Retake</div>
          <div onClick={() => { onCaptured && onCaptured({ blob: captured.blob, type: captured.type, ext: captured.ext, mime: captured.mime, caption: caption.trim() }); closeAll(); }} style={{ flex: 1, padding: 13, borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>Add to post</div>
        </div>
      </div>
     );
  }

  // LIVE CAMERA
  if (showCamera && !captured) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 2147483000, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", flexShrink: 0 }}>
          <span onClick={closeAll} style={{ color: "#fff", fontSize: 15, cursor: "pointer" }}>Cancel</span>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Camera</span>
          <span style={{ width: 50 }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 10, padding: "6px 12px", flexShrink: 0 }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.12)", borderRadius: 20, overflow: "hidden" }}>
            {["photo", "video"].map((m) => (
              <span key={m} onClick={() => setMode(m)} style={{ padding: "6px 16px", fontSize: 13, fontWeight: 700, color: mode === m ? "#000" : "#fff", background: mode === m ? "#fff" : "transparent", borderRadius: 20, cursor: "pointer", textTransform: "capitalize" }}>{m}</span>
            ))}
          </div>
          <span onClick={cycleFilter} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.12)", borderRadius: 16, cursor: "pointer" }}>{GLOBAL_CAMERA_FILTERS[filterIdx]?.label || "None"}</span>
          <span onClick={switchFacing} title="Flip camera" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer" }}><FlipHorizontal2 size={18} color="#fff" /></span>
          <span onClick={() => zoomBy(-0.2)} title="Zoom out" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer", fontSize: 20, fontWeight: 700, color: "#fff" }}>−</span>
          <span onClick={() => zoomBy(0.2)} title="Zoom in" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer", fontSize: 18, fontWeight: 700, color: "#fff" }}>+</span>
        </div>
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
          <video ref={videoRef} autoPlay playsInline muted={mode !== "video"} style={{ width: "100%", height: "100%", maxHeight: "70vh", objectFit: "contain", transform: `${facing === "user" ? "scaleX(-1) " : ""}scale(${zoom})`, transformOrigin: "center center", filter: GLOBAL_CAMERA_FILTERS[filterIdx]?.css }} />
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

  // PREVIEW (caption + Retake / Status / Send) — chat & status targets
  if (captured && previewStep) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 2147483000, display: "flex", flexDirection: "column" }}>
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
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.3)", fontSize: 14, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} />
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "0 16px calc(env(safe-area-inset-bottom, 0px) + 24px)", flexShrink: 0 }}>
          <div onClick={() => { setPreviewStep(false); openCamera(); }} style={{ flex: 1, padding: 13, borderRadius: 12, border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>Retake</div>
          <div onClick={doPostStatus} style={{ flex: 1, padding: 13, borderRadius: 12, border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer", opacity: posting ? 0.6 : 1 }}>{posting ? "Posting…" : "Status"}</div>
          <div onClick={() => setPreviewStep(false)} style={{ flex: 1, padding: 13, borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>Send</div>
        </div>
      </div>
     );
  }

  // SEND TO… (chat list + Post on Status) — chat & status targets
  if (captured && !previewStep) {
    return (
      <div style={{ position: "fixed", inset: 0, background: t.bg, zIndex: 2147483000, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
          <span onClick={discard} style={{ color: t.text, fontSize: 15, cursor: "pointer" }}>Cancel</span>
          <span style={{ color: t.text, fontWeight: 700, fontSize: 16 }}>Send to…</span>
          <span style={{ width: 50 }} />
        </div>
        <div style={{ padding: 16, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          {captured.type === "video"
            ? <video src={captured.url} style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover" }} />
            : <img src={captured.url} alt="Captured" style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover" }} />}
        </div>
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div onClick={doPostStatus} style={{ padding: "12px 14px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer", opacity: posting ? 0.6 : 1 }}>{posting ? "Posting…" : "Post on Status"}</div>
        </div>
        <div className="nx-scroll" style={{ flex: 1, paddingBottom: 140, overflowY: "auto" }}>
          {acceptedContacts.length === 0 && <div style={{ padding: 20, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No contacts to send to.</div>}
          {acceptedContacts.map((c) => {
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
            <div onClick={() => setSelected([])} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${t.border}`, color: t.text, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>Clear</div>
            <div onClick={sendToSelected} style={{ flex: 1, padding: "12px 14px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>Send to {selected.length}</div>
          </div>
        )}
      </div>
     );
  }

  return null;
}
