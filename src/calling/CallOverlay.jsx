import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, SwitchCamera, Volume2 } from "lucide-react";
import { useCall } from "./CallContext";
import Avatar from "../components/Avatar";

function formatDuration(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

export default function CallOverlay() {
  const ringCtxRef = useRef(null);
  const ringOscRef = useRef(null);
  const ringGainRef = useRef(null);
  const ringIntervalRef = useRef(null);
  const startRingtone = (incoming) => {
    try {
      if (ringCtxRef.current) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      ringCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = incoming ? 520 : 480;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      ringOscRef.current = osc;
      ringGainRef.current = gain;
      let on = false;
      const tick = () => {
        if (!ringGainRef.current) return;
        try {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          if (on) {
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
            osc.frequency.setValueAtTime(incoming ? 520 : 480, now);
          } else {
            gain.gain.setValueAtTime(0.22, now);
            gain.gain.linearRampToValueAtTime(0.0001, now + 0.02);
            // gap
          }
        } catch {}
        on = !on;
      };
      tick();
      ringIntervalRef.current = setInterval(tick, incoming ? 900 : 1100);
    } catch {}
  };
  const stopRingtone = () => {
    try {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
      if (ringGainRef.current) {
        try { ringGainRef.current.gain.linearRampToValueAtTime(0.0001, ringCtxRef.current.currentTime + 0.05); } catch {}
      }
      setTimeout(() => {
        try { if (ringOscRef.current) { ringOscRef.current.stop(); ringOscRef.current.disconnect(); } } catch {}
        try { if (ringCtxRef.current) { ringCtxRef.current.close(); } } catch {}
        ringOscRef.current = null;
        ringGainRef.current = null;
        ringCtxRef.current = null;
      }, 120);
    } catch {}
  };
  useEffect(() => () => { stopRingtone(); }, []);
  // Auto ringtone based on callState
  const {
    isCallingEnabled, activeCallId, callData, currentIncoming,
    localStream, remoteStream, callState, callType, isMuted, isCameraOff, error, connectedAt,
    otherName, otherPhoto, otherUid,
    acceptCall, declineCall, cancelCall, endCall, toggleMute, toggleCamera, switchCamera,
  } = useCall();

  useEffect(() => {
    const shouldRing = callState === "calling" || callState === "ringing";
    if (shouldRing) startRingtone(callState === "ringing");
    else stopRingtone();
    return () => { if (!shouldRing) stopRingtone(); };
  }, [callState]);

  const [elapsed, setElapsed] = useState(0);
  const [dragPos, setDragPos] = useState({ x: 14, y: 80 });
  const draggingRef = useRef(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const incoming = currentIncoming;
  const showIncoming = !!incoming && !activeCallId;
  const showActive = !!activeCallId;

  // Attach streams to video elements
  useEffect(() => { if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream; }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current && remoteStream) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // Duration timer
  useEffect(() => {
    if (callState !== "connected" || !connectedAt) { setElapsed(0); return; }
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - connectedAt)/1000)), 1000);
    return () => clearInterval(iv);
  }, [callState, connectedAt]);

  // Prevent background scroll while call overlay is active
  useEffect(() => {
    const shouldLock = showIncoming || showActive;
    if (shouldLock) {
      const prevOverflow = document.body.style.overflow;
      const prevTouch = document.body.style.touchAction;
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      return () => { document.body.style.overflow = prevOverflow; document.body.style.touchAction = prevTouch; };
    }
  }, [showIncoming, showActive]);

  if (!isCallingEnabled) return null;
  if (!showIncoming && !showActive) return null;

  const quickReplies = ["I'll call you back in a minute.", "Call me back in 15 minutes.", "I'm busy right now.", "Give me a few minutes."];
  const sendQuickReply = async (text) => {
    if (!incoming || !text) return;
    try {
      const { getOrCreateDirectChat } = await import("../firebase/chats");
      const { collection, addDoc, serverTimestamp, doc, updateDoc } = await import("firebase/firestore");
      const { db } = await import("../firebase/config");
      const { user } = await import("../firebase/useAuth");
      // Derive myUid from context's user
      const myUid = incoming.calleeUid;
      const otherUid = incoming.callerUid;
      const chatId = await getOrCreateDirectChat(myUid, otherUid);
      await addDoc(collection(db, "chats", chatId, "messages"), {
        senderId: myUid,
        senderName: "You",
        type: "text",
        text,
        mediaURL: null, mediaThumbURL: null, mediaDurationSeconds: null, mediaSizeBytes: null,
        mediaExpiresAt: null, mediaExpired: false, mediaSavedBy: [],
        fileName: null, fileExtension: null, fileSizeBytes: null,
        gifURL: null, gifSourceProvider: null,
        scheduledFor: null, isScheduled: false,
        sentAt: serverTimestamp(), deliveredTo: [], readBy: [],
        deletedForEveryone: false, deletedForSelf: [],
        editedAt: null, editHistory: [], editWindowExpiresAt: null,
        disappearing: null, screenshotDetected: false, replyTo: null,
        reactions: {}, poll: null,
      });
      await updateDoc(doc(db, "chats", chatId), { lastMessage: { text, senderId: myUid, sentAt: serverTimestamp(), type: "text" } });
      declineCall(incoming.id);
    } catch {}
  };

  // Incoming call UI — full-screen portal (explicit top/left/right/bottom for Chrome 83 WebView, no inset)
  if (showIncoming) {
    return createPortal(
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100vh", zIndex: 2147483647, background: "rgba(22,21,18,0.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", paddingTop: "calc(32px + env(safe-area-inset-top))", paddingBottom: "calc(32px + env(safe-area-inset-bottom))", color: "#fff", boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ width: 96, height: 96, borderRadius: "50%", background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", animation: "callPulse 1.6s ease-in-out infinite", border: "2px solid rgba(59,130,246,0.35)" }}>
          <Avatar photoURL={incoming.calleePhoto && incoming.callerPhoto ? incoming.callerPhoto : incoming.callerPhoto || incoming.calleePhoto} name={incoming.callerName} uid={incoming.callerUid} size={72} />
        </div>
        <div style={{ marginTop: 18, fontSize: 22, fontWeight: 800, color: "#fff", textAlign: "center" }}>{incoming.callerName || "Unknown"}</div>
        <div style={{ marginTop: 6, fontSize: 13.5, color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", gap: 6 }}>
          {incoming.type === "video" ? <Video size={14} color="rgba(255,255,255,0.7)" /> : <Phone size={14} color="rgba(255,255,255,0.7)" />}
          Incoming {incoming.type === "video" ? "video" : "voice"} call
          {incoming.type === "video" && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.12)", padding: "2px 6px", borderRadius: 6 }}>camera will turn on</span>}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 36 }}>
          <button onClick={() => declineCall(incoming.id)} aria-label="Decline call" style={{ width: 64, height: 64, borderRadius: "50%", border: "none", background: "#FF3B30", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 16px rgba(255,59,48,0.4)" }}>
            <PhoneOff size={26} color="#fff" />
          </button>
          <button onClick={() => acceptCall(incoming.id)} aria-label="Accept call" style={{ width: 64, height: 64, borderRadius: "50%", border: "none", background: "#34C759", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 16px rgba(52,199,89,0.4)" }}>
            <Phone size={26} color="#fff" />
          </button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:22, width:"100%", maxWidth:280 }}>
          {quickReplies.map(txt=>(
            <button key={txt} onClick={()=>sendQuickReply(txt)} style={{ padding:"10px 14px", borderRadius:10, border:"1px solid rgba(255,255,255,0.2)", background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>{txt}</button>
          ))}
        </div>
        <style>{`@keyframes callPulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59,130,246,0.35); } 70% { transform: scale(1.02); box-shadow: 0 0 0 18px rgba(59,130,246,0); } 100% { transform: scale(1); } }`}</style>
      </div>,
      document.body
    );
  }

  // Active / outgoing call UI
  const isVideo = callType === "video";
  const showVideo = isVideo && !isCameraOff && callState === "connected";
  const statusText = (
    callState === "calling" ? "Calling…" :
    callState === "ringing" ? "Ringing…" :
    callState === "connecting" ? "Establishing secure connection…" :
    callState === "connected" ? formatDuration(elapsed) :
    callState === "reconnecting" ? "Reconnecting…" :
    callState === "busy" ? "User is busy" :
    callState === "declined" ? "Declined" :
    callState === "missed" ? "Missed" :
    callState === "failed" ? (error || "Connection failed") :
    callState === "ended" ? "Ended" :
    error || callState
  );

  const onDragStart = (e) => {
    draggingRef.current = true;
    const startX = (e.touches ? e.touches[0].clientX : e.clientX) - dragPos.x;
    const startY = (e.touches ? e.touches[0].clientY : e.clientY) - dragPos.y;
    const onMove = (ev) => {
      if (!draggingRef.current) return;
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      setDragPos({ x: Math.max(8, Math.min(window.innerWidth - 110, cx - startX)), y: Math.max(60, Math.min(window.innerHeight - 140, cy - startY)) });
    };
    const onUp = () => { draggingRef.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("touchmove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchend", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
  };

  return createPortal(
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100vh", zIndex: 2147483647, background: "#161512", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Remote video / avatar background */}
      <div style={{ flex: 1, position: "relative", background: "#0f0e0d", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {showVideo ? (
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 24 }}>
            <div style={{ width: 112, height: 112, borderRadius: "50%", background: "rgba(59,130,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Avatar photoURL={otherPhoto} name={otherName} uid={otherUid} size={96} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{otherName || "Unknown"}</div>
              <div style={{ marginTop: 6, fontSize: 13.5, color: error ? "#FF6B6B" : "rgba(255,255,255,0.65)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {callState === "connected" ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34C759", display: "inline-block", animation: "callPulse 1.2s infinite" }} /> : null}
                {statusText}
              </div>
              {callState !== "connected" && !error && <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{isVideo ? "Video call" : "Voice call"}</div>}
            </div>
          </div>
        )}
        {/* Local PiP */}
        {localStream && isVideo && (
          <div
            onMouseDown={onDragStart} onTouchStart={onDragStart}
            style={{ position: "absolute", left: dragPos.x, top: dragPos.y, width: 108, height: 144, borderRadius: 12, overflow: "hidden", background: "#000", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 8px 24px rgba(0,0,0,0.45)", cursor: "grab", touchAction: "none" }}
          >
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
            {isCameraOff && <div style={{ position: "absolute", inset: 0, background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center" }}><VideoOff size={18} color="rgba(255,255,255,0.5)" /></div>}
          </div>
        )}
        {/* Hidden remote audio element for voice calls */}
        <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />
        {/* Top bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(to bottom, rgba(0,0,0,0.45), transparent)", color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: callState === "connected" ? "#34C759" : "#FF9500", display: "inline-block" }} />
            {callState === "connected" ? "Connected" : callState === "calling" ? "Calling" : callState === "ringing" ? "Ringing" : callState}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{otherName}</div>
        </div>
        {/* Connection status banner */}
        {error && callState !== "failed" && (
          <div style={{ position: "absolute", bottom: 92, left: 16, right: 16, background: "rgba(255,59,48,0.9)", color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, textAlign: "center" }}>{error}</div>
        )}
      </div>
      {/* Controls */}
      <div style={{ background: "#262421", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 18px", paddingBottom: "calc(16px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
        {callState === "calling" || callState === "ringing" ? (
          <button onClick={cancelCall} aria-label="Cancel call" style={{ width: 56, height: 56, borderRadius: "50%", border: "none", background: "#FF3B30", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <PhoneOff size={22} color="#fff" />
          </button>
        ) : (
          <>
            <button onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"} style={{ width: 52, height: 52, borderRadius: "50%", border: "none", background: isMuted ? "#FF3B30" : "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {isMuted ? <MicOff size={20} color="#fff" /> : <Mic size={20} color="#fff" />}
            </button>
            <button onClick={toggleCamera} aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"} style={{ width: 52, height: 52, borderRadius: "50%", border: "none", background: isCameraOff ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {isCameraOff ? <VideoOff size={20} color="#fff" /> : <Video size={20} color="#fff" />}
            </button>
            {isVideo && (
              <button onClick={switchCamera} aria-label="Switch camera" style={{ width: 52, height: 52, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <SwitchCamera size={20} color="#fff" />
              </button>
            )}
            <button onClick={endCall} aria-label="End call" style={{ width: 62, height: 62, borderRadius: "50%", border: "none", background: "#FF3B30", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 12px rgba(255,59,48,0.35)" }}>
              <PhoneOff size={24} color="#fff" />
            </button>
            <button aria-label="Speaker" onClick={() => { /* browser handles via audio element; native could toggle via plugin */ }} style={{ width: 52, height: 52, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: 0.9 }}>
              <Volume2 size={20} color="#fff" />
            </button>
          </>
        )}
      </div>
      <style>{`@keyframes callPulse { 0%{transform:scale(1)} 50%{transform:scale(1.04)} 100%{transform:scale(1)} }`}</style>
    </div>,
    document.body
  );
}
