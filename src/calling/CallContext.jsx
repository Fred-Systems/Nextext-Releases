import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "../firebase/useAuth";
import { useGlobalSettings } from "../firebase/config-settings";
import { resolveIceServers } from "./iceConfig";
import * as CallService from "../firebase/calls";

const CallContext = createContext(null);
export function useCall() { return useContext(CallContext); }

function getOtherParticipant(call, myUid) {
  if (!call) return null;
  return call.callerUid === myUid ? call.calleeUid : call.callerUid;
}
function getOtherName(call, myUid) {
  if (!call) return "Unknown";
  return call.callerUid === myUid ? (call.calleeName || "Unknown") : (call.callerName || "Unknown");
}
function getOtherPhoto(call, myUid) {
  if (!call) return null;
  return call.callerUid === myUid ? call.calleePhoto : call.callerPhoto;
}

export function CallProvider({ children }) {
  const { user, userDoc } = useAuth();
  const myUid = user?.uid || null;
  const globalSettings = useGlobalSettings();
  const isCallingEnabled = globalSettings == null ? true : globalSettings?.calling?.enabled !== false;

  const [activeCallId, setActiveCallId] = useState(null);
  const [callData, setCallData] = useState(null);
  const [incomingCalls, setIncomingCalls] = useState([]); // array of ringing calls where I am callee
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callState, setCallState] = useState("idle"); // idle, calling, ringing, accepted, connecting, connected, reconnecting, ended, declined, missed, failed, busy
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callType, setCallType] = useState("voice"); // voice | video
  const [error, setError] = useState("");
  const [connectedAt, setConnectedAt] = useState(null);
  const [ringingStartedAt, setRingingStartedAt] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callUnsubRef = useRef(null);
  const candidatesUnsubRef = useRef(null);
  const incomingUnsubRef = useRef(null);
  const ringTimerRef = useRef(null);
  const isCallerRef = useRef(false);
  const hasSetRemoteOfferRef = useRef(false);
  const pendingCandidatesRef = useRef([]);
  const activeCallIdRef = useRef(null);
  const sharedAudioCtxRef = useRef(null); // primed on user gesture for ringtone
  useEffect(() => { activeCallIdRef.current = activeCallId; }, [activeCallId]);

  // Derived: current incoming call to show (first ringing where I am callee and not already in active call)
  const currentIncoming = incomingCalls.length > 0 && !activeCallId ? incomingCalls[0] : null;

  // Cleanup helpers
  const stopTracks = useCallback((stream) => {
    if (!stream) return;
    try { stream.getTracks().forEach((t) => { try { t.stop(); } catch {} }); } catch {}
  }, []);
  const cleanupPeer = useCallback(() => {
    if (pcRef.current) {
      try { pcRef.current.ontrack = null; pcRef.current.onicecandidate = null; pcRef.current.onconnectionstatechange = null; pcRef.current.oniceconnectionstatechange = null; } catch {}
      try { pcRef.current.close(); } catch {}
      pcRef.current = null;
    }
    if (callUnsubRef.current) { try { callUnsubRef.current(); } catch {} callUnsubRef.current = null; }
    if (candidatesUnsubRef.current) { try { candidatesUnsubRef.current(); } catch {} candidatesUnsubRef.current = null; }
    clearTimeout(ringTimerRef.current);
    hasSetRemoteOfferRef.current = false;
    pendingCandidatesRef.current = [];
  }, []);

  const cleanupCall = useCallback(() => {
    cleanupPeer();
    stopTracks(localStreamRef.current);
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    remoteStreamRef.current = null;
    setActiveCallId(null);
    setCallData(null);
    setCallState("idle");
    setCallType("voice");
    setIsMuted(false);
    setIsCameraOff(false);
    setError("");
    setConnectedAt(null);
    setRingingStartedAt(null);
    isCallerRef.current = false;
  }, [cleanupPeer, stopTracks]);

  // Incoming calls listener (only when enabled and signed in)
  useEffect(() => {
    if (!myUid || !isCallingEnabled) {
      if (incomingUnsubRef.current) { try { incomingUnsubRef.current(); } catch {} incomingUnsubRef.current = null; }
      setIncomingCalls([]);
      return;
    }
    incomingUnsubRef.current = CallService.listenToIncomingCalls(myUid, (arr) => {
      // If already in a call, mark new ringing calls as busy (so caller gets busy)
      if (activeCallIdRef.current) {
        arr.forEach((c) => {
          // Only mark if still ringing/calling (arr already filtered)
          CallService.markBusy(c.id).catch(() => {});
        });
        setIncomingCalls([]);
        return;
      }
      setIncomingCalls(arr);
    });
    return () => { if (incomingUnsubRef.current) { try { incomingUnsubRef.current(); } catch {} incomingUnsubRef.current = null; } };
  }, [myUid, isCallingEnabled]);

  // Active call document listener
  useEffect(() => {
    if (!activeCallId) return;
    callUnsubRef.current = CallService.listenToCall(activeCallId, (data) => {
      if (!data) { setError("Call ended"); setCallState("ended"); setTimeout(() => cleanupCall(), 1500); return; }
      setCallData(data);
      // Map Firestore state to local callState (with connecting/connected derived from peer)
      const s = data.state;
      if (s === "ringing" || s === "calling") {
        if (!ringingStartedAt) setRingingStartedAt(Date.now());
        setCallState(isCallerRef.current ? "calling" : "ringing");
      } else if (s === "accepted") {
        setCallState("connecting");
      } else if (["ended", "declined", "missed", "failed", "busy", "cancelled"].includes(s)) {
        setCallState(s);
        // Stop after terminal
        setTimeout(() => cleanupCall(), 1500);
      }
      // Ring timeout for caller
      if (s === "ringing" && isCallerRef.current && !ringTimerRef.current) {
        ringTimerRef.current = setTimeout(async () => {
          try { await CallService.markMissed(activeCallId); } catch {}
          setCallState("missed");
          setTimeout(() => cleanupCall(), 1500);
        }, CallService.RING_TIMEOUT_MS);
      }
      if (s !== "ringing") { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    }, () => setError("Call connection lost"));
    return () => { if (callUnsubRef.current) { try { callUnsubRef.current(); } catch {} callUnsubRef.current = null; } };
  }, [activeCallId, cleanupCall, ringingStartedAt]);

  // Handle remote offer/answer and ICE after callData changes
  useEffect(() => {
    if (!activeCallId || !pcRef.current) return;
    const pc = pcRef.current;
    // If I am callee and offer arrived, set remote description and create answer
    if (!isCallerRef.current && callData?.offer && !hasSetRemoteOfferRef.current) {
      hasSetRemoteOfferRef.current = true;
      console.log("[calling] callee: offer received, setting remote description...");
      (async () => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
          console.log("[calling] callee: remote description set, creating answer...");
          // Drain pending candidates
          for (const c of pendingCandidatesRef.current) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await CallService.updateCallAnswer(activeCallId, { type: answer.type, sdp: answer.sdp });
          console.log("[calling] callee: answer sent for", activeCallId);
          setCallState("connecting");
        } catch (e) {
          console.error("[calling] setRemoteOffer failed", e);
          setError("Failed to connect");
          setCallState("failed");
        }
      })();
    }
    // If I am caller and answer arrived
    if (isCallerRef.current && callData?.answer && pc.signalingState === "have-local-offer") {
      console.log("[calling] caller: answer received, setting remote description...");
      (async () => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(callData.answer));
          for (const c of pendingCandidatesRef.current) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
          }
          pendingCandidatesRef.current = [];
          setCallState("connecting");
        } catch (e) {
          console.error("[calling] setRemoteAnswer failed", e);
        }
      })();
    }
  }, [callData, activeCallId]);

  // Candidates listener for active call
  useEffect(() => {
    if (!activeCallId || !pcRef.current) return;
    candidatesUnsubRef.current = CallService.listenToCallCandidates(activeCallId, (cands) => {
      const pc = pcRef.current;
      if (!pc) return;
      for (const c of cands) {
        if (c.fromUid === myUid) continue; // my own candidates
        const init = { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment };
        if (!init.candidate) continue;
        if (!pc.remoteDescription) {
          pendingCandidatesRef.current.push(init);
        } else {
          pc.addIceCandidate(new RTCIceCandidate(init)).catch(() => {});
        }
      }
    });
    return () => { if (candidatesUnsubRef.current) { try { candidatesUnsubRef.current(); } catch {} candidatesUnsubRef.current = null; } };
  }, [activeCallId, myUid]);

  const createPeer = useCallback((iceServers) => {
    const pc = new RTCPeerConnection({ iceServers });
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate && activeCallId) {
        CallService.addIceCandidate(activeCallId, ev.candidate.toJSON(), myUid).catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") { setCallState("connected"); setConnectedAt(Date.now()); setError(""); }
      else if (s === "connecting") setCallState("connecting");
      else if (s === "failed") { setCallState("failed"); setError("Connection failed"); }
      else if (s === "disconnected") setCallState("reconnecting");
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") { setError("Unable to establish a direct connection. Please try again."); }
    };
    return pc;
  }, [activeCallId, myUid]);

  const getMedia = useCallback(async (type) => {
    const constraints = type === "video" ? { audio: true, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } } : { audio: true, video: false };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (e) {
      const msg = e?.name === "NotAllowedError" ? (type === "video" ? "Camera and microphone permission is required to make a video call." : "Microphone permission is required to make a voice call.") : (e?.message || "Could not access microphone/camera.");
      const err = new Error(msg);
      err.code = e?.name;
      throw err;
    }
  }, []);

  const startCall = useCallback(async ({ calleeUid, calleeName, calleePhoto, type = "voice" }) => {
    if (!myUid) throw new Error("Not signed in");
    if (!isCallingEnabled) throw new Error("Calling is disabled");
    // Only block if there is a genuinely active call (not stale). Check both local state and Firestore-recency.
    const nowActive = activeCallIdRef.current && callState !== "idle" && !["ended","declined","missed","cancelled","failed","busy"].includes(callState);
    if (nowActive) throw new Error("Already in a call");
    // If local state is stale (ended but not yet cleaned), force cleanup first
    if (activeCallIdRef.current && ["ended","declined","missed","cancelled","failed","busy"].includes(callState)) {
      cleanupCall();
    }
    setError("");
    isCallerRef.current = true;
    setCallType(type);
    setCallState("calling");
    // Prime a shared AudioContext NOW while we're inside the user-gesture tap
    // so the ringtone can start immediately without hitting mobile autoplay policy.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !sharedAudioCtxRef.current) {
        const ctx = new Ctx();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        sharedAudioCtxRef.current = ctx;
      }
    } catch {}
    const callerName = userDoc?.displayName || userDoc?.username || "Unknown";
    const callerPhoto = userDoc?.photoURL || null;
    let callId;
    try {
      callId = await CallService.createCall({ callerUid: myUid, calleeUid, type, callerName, calleeName: calleeName || calleeUid, callerPhoto, calleePhoto: calleePhoto || null });
    } catch (e) {
      setCallState(e.code === "BUSY" ? "busy" : "failed");
      setError(e.message);
      setTimeout(() => { setCallState("idle"); setError(""); }, 2500);
      throw e;
    }
    setActiveCallId(callId);
    setRingingStartedAt(Date.now());
    console.log("[calling] startCall: call created", callId, "-> getting media");
    // Get media and create peer
    let stream;
    try {
      stream = await getMedia(type);
    } catch (e) {
      await CallService.markFailed(callId, e.message).catch(() => {});
      setCallState("failed");
      setError(e.message);
      // Clear stale active call so next attempt is not blocked
      setTimeout(() => cleanupCall(), 1200);
      throw e;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsCameraOff(type === "voice");
    const iceServers = resolveIceServers(globalSettings);
    const pc = createPeer(iceServers);
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === "video" });
    await pc.setLocalDescription(offer);
    await CallService.updateCallOffer(callId, { type: offer.type, sdp: offer.sdp });
    // Caller now in calling/ringing until callee answers
    return callId;
  }, [myUid, userDoc, isCallingEnabled, activeCallId, getMedia, createPeer, globalSettings]);

  const acceptCall = useCallback(async (callId) => {
    const id = callId || activeCallId || currentIncoming?.id;
    console.log("[calling] acceptCall:", id, { activeCallId, currentIncoming: currentIncoming?.id });
    if (!id) return;
    if (activeCallId && activeCallId !== id) { // busy
      try { await CallService.markBusy(id); } catch {}
      return;
    }
    setError("");
    isCallerRef.current = false;
    const data = callData && callData.id === id ? callData : (currentIncoming && currentIncoming.id === id ? currentIncoming : null);
    const type = data?.type || "voice";
    setCallType(type);
    setActiveCallId(id);
    setCallState("connecting");
    // Prime AudioContext in the user gesture (answer tap) for incoming ringtone.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !sharedAudioCtxRef.current) {
        const ctx = new Ctx();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        sharedAudioCtxRef.current = ctx;
      }
    } catch {}
    let stream;
    try {
      stream = await getMedia(type);
    } catch (e) {
      await CallService.declineCall(id, myUid).catch(() => {});
      setError(e.message);
      setCallState("failed");
      throw e;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsCameraOff(type === "voice");
    const iceServers = resolveIceServers(globalSettings);
    const pc = createPeer(iceServers);
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    try { await CallService.acceptCall(id); } catch {}
    // Offer handling will happen via callData listener (setRemoteDescription + answer)
  }, [activeCallId, currentIncoming, callData, myUid, getMedia, createPeer, globalSettings]);

  const declineCall = useCallback(async (callId) => {
    const id = callId || currentIncoming?.id || activeCallId;
    if (!id) return;
    try { await CallService.declineCall(id, myUid); } catch {}
    if (activeCallId === id) cleanupCall();
    else setIncomingCalls((prev) => prev.filter((c) => c.id !== id));
  }, [activeCallId, currentIncoming, myUid, cleanupCall]);

  const cancelCall = useCallback(async () => {
    if (!activeCallId) return;
    try { await CallService.cancelCall(activeCallId, myUid); } catch {}
    cleanupCall();
  }, [activeCallId, myUid, cleanupCall]);

  const endCall = useCallback(async () => {
    const id = activeCallId;
    if (!id) { cleanupCall(); return; }
    const dur = connectedAt ? Math.round((Date.now() - connectedAt) / 1000) : null;
    try { await CallService.endCall(id, myUid, dur); } catch {}
    cleanupCall();
  }, [activeCallId, myUid, connectedAt, cleanupCall]);

  const toggleMute = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    s.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((v) => !v);
  }, []);
  const toggleCamera = useCallback(async () => {
    const s = localStreamRef.current;
    if (!s) return;
    const vt = s.getVideoTracks()[0];
    if (vt) { vt.enabled = !vt.enabled; setIsCameraOff(!vt.enabled); return; }
    // No video track — upgrade to video: get new stream and renegotiate
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (pcRef.current && newVideoTrack) {
        const sender = pcRef.current.getSenders().find((sen) => sen.track?.kind === "video");
        if (sender) await sender.replaceTrack(newVideoTrack);
        else pcRef.current.addTrack(newVideoTrack, newStream);
        // Merge into local stream
        s.addTrack(newVideoTrack);
        setIsCameraOff(false);
        setCallType("video");
        // Renegotiate if needed: create new offer
        if (pcRef.current.signalingState === "stable") {
          const offer = await pcRef.current.createOffer();
          await pcRef.current.setLocalDescription(offer);
          await CallService.updateCallOffer(activeCallId, { type: offer.type, sdp: offer.sdp });
        }
      }
    } catch (e) { setError(e.message); }
  }, [activeCallId]);

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current) return;
    const currentFacing = localStreamRef.current.getVideoTracks()[0]?.getSettings?.().facingMode;
    const nextFacing = currentFacing === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing }, audio: true });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldTrack) { try { oldTrack.stop(); } catch {} localStreamRef.current.removeTrack(oldTrack); }
      localStreamRef.current.addTrack(newVideoTrack);
      if (pcRef.current) {
        const sender = pcRef.current.getSenders().find((sen) => sen.track?.kind === "video");
        if (sender) await sender.replaceTrack(newVideoTrack);
      }
      // Keep audio tracks
      newStream.getAudioTracks().forEach((t) => { if (!localStreamRef.current.getAudioTracks().some((a) => a.id === t.id)) localStreamRef.current.addTrack(t); });
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    } catch (e) { setError("Could not switch camera"); }
  }, []);

  // If enabled flag flips off while in call, don't crash — just show ended and cleanup after
  useEffect(() => {
    if (!isCallingEnabled && activeCallId) {
      setError("Calling has been disabled by admin");
      setTimeout(() => cleanupCall(), 2000);
    }
  }, [isCallingEnabled, activeCallId, cleanupCall]);

  // Cleanup on unmount / sign out
  useEffect(() => () => { cleanupCall(); }, [cleanupCall]);
  useEffect(() => { if (!myUid) cleanupCall(); }, [myUid, cleanupCall]);

  const value = {
    isCallingEnabled,
    activeCallId, callData, incomingCalls, currentIncoming,
    localStream, remoteStream,
    callState, callType, isMuted, isCameraOff, error, connectedAt,
    otherUid: callData ? getOtherParticipant(callData, myUid) : (currentIncoming ? getOtherParticipant(currentIncoming, myUid) : null),
    otherName: callData ? getOtherName(callData, myUid) : (currentIncoming ? getOtherName(currentIncoming, myUid) : null),
    otherPhoto: callData ? getOtherPhoto(callData, myUid) : (currentIncoming ? getOtherPhoto(currentIncoming, myUid) : null),
    startCall, acceptCall, declineCall, cancelCall, endCall,
    toggleMute, toggleCamera, switchCamera,
    cleanupCall,
    sharedAudioCtxRef,
  };
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
