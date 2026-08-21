import React, { useState, useRef, useEffect, useCallback } from "react";
import { AudioLines, Square, Loader2, Mic } from "lucide-react";
import { transcribeVoiceNote } from "../firebase/ai";
import { getMicrophoneStream } from "../media/microphone";
import { base64ToBlob } from "../media/base64";
const NextextNative = typeof window !== "undefined" ? window.Capacitor?.Plugins?.NextextNative : null;

// How often (ms) we cut a native recording chunk and send it to Groq Whisper
// for transcription. Smaller = more "live" but more API calls (Groq free tier
// is ~20 req/min for audio, so we stay comfortably under with 4s chunks).
const LIVE_CHUNK_MS = 4000;
// If no speech is detected for this long, auto-stop the dictation.
const SILENCE_MS = 2500;

function triggerHaptic(type = "light") {
  try {
    if (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) {
      const { Haptics, ImpactStyle } = window.Capacitor.Plugins;
      if (Haptics?.impact) {
        Haptics.impact({ style: ImpactStyle.Light });
        return;
      }
    }
    if (navigator.vibrate) navigator.vibrate(type === "light" ? 10 : 30);
  } catch {}
}

export default function VoiceToTextButton({ myUid, onResult, onAutoSend, autoSend = false, size = 42, color = "#7C5CFF", composerHeight = 1, useRealtime = true }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false); // mid-chunk transcription in flight
  const [error, setError] = useState("");
  const [interimText, setInterimText] = useState("");
  const [level, setLevel] = useState(0); // 0..1 live amplitude (native)

  const recordingRef = useRef(false);
  const recorderActiveRef = useRef(false);
  const busyRef = useRef(false);
  const chunkTimerRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const fullTextRef = useRef("");
  const stopRef = useRef(null);
  const autoSendRef = useRef(autoSend);
  autoSendRef.current = autoSend;
  const onAutoSendRef = useRef(onAutoSend || (() => {}));
  onAutoSendRef.current = onAutoSend || (() => {});
  // Live transcription preview is OFF by default; opt in via Settings
  // (nextext_stt_show_interim === "on").
  const showInterim = typeof window !== "undefined" && localStorage.getItem("nextext_stt_show_interim") === "on";

  // When auto-send is enabled, after dictation ends we wait a short grace period
  // (countdown) before actually sending, so the user can tap Cancel and keep the
  // dictated text in the composer to edit instead of sending immediately.
  const AUTO_SEND_DELAY_MS = 3000;
  const [pendingSend, setPendingSend] = useState(null);
  const pendingTimerRef = useRef(null);
  const pendingTextRef = useRef("");
  const clearPending = useCallback(() => {
    if (pendingTimerRef.current) { clearInterval(pendingTimerRef.current); pendingTimerRef.current = null; }
    pendingTextRef.current = "";
    setPendingSend(null);
  }, []);
  const cancelAutoSend = useCallback(() => {
    const text = pendingTextRef.current;
    clearPending();
    if (text) onResult(text, { live: true });
  }, [clearPending, onResult]);
  const scheduleAutoSend = useCallback((text) => {
    clearPending();
    pendingTextRef.current = text;
    let left = Math.ceil(AUTO_SEND_DELAY_MS / 1000);
    setPendingSend({ left });
    pendingTimerRef.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        const t = pendingTextRef.current;
        clearPending();
        if (t) onAutoSendRef.current(t);
      } else {
        setPendingSend({ left });
      }
    }, 1000);
  }, [clearPending, onAutoSendRef]);

  const isNative = !!(NextextNative && typeof NextextNative.startVoiceRecording === "function" && window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform());

  // Subscribe to native amplitude events for a live waveform + silence detection.
  useEffect(() => {
    if (!isNative || !NextextNative.addListener) return;
    let sub;
    try {
      sub = NextextNative.addListener("voiceLevel", (d) => {
        const v = typeof d?.level === "number" ? d.level : 0;
        setLevel(v);
        // Only treat this as speech activity (and reset the auto-stop timer) when
        // the level clearly indicates real voice, not ambient room noise. The
        // native peak-amplitude is noisy, so a low threshold (e.g. 0.04) made the
        // silence timer reset forever on background hum and the mic never
        // auto-stopped. 0.12 ~ a soft but real voice floor.
        if (v > 0.12) resetSilence();
      });
    } catch {}
    return () => { try { sub?.remove && sub.remove(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative]);

  // Auto-dismiss transient error toasts.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), 4500);
    return () => clearTimeout(id);
  }, [error]);

  const resetSilence = useCallback(() => {
    if (!recordingRef.current) return;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (recordingRef.current && stopRef.current) stopRef.current();
    }, SILENCE_MS);
  }, []);

  const clearChunkTimer = () => {
    if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; }
  };

  const stopRecorderNative = useCallback(async () => {
    if (!recorderActiveRef.current) return null;
    recorderActiveRef.current = false;
    setLevel(0);
    return NextextNative.stopVoiceRecording();
  }, []);

  const stop = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    clearChunkTimer();
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setRecording(false);
    triggerHaptic("light");
    if (isNative) {
      const res = await stopRecorderNative();
      if (res && res.base64) {
        try {
          setBusy(true);
          const blob = base64ToBlob(res.base64, res.mimeType || "audio/mp4");
          const text = await transcribeVoiceNote(myUid, blob);
          if (text && text.trim()) { fullTextRef.current += (fullTextRef.current ? " " : "") + text.trim(); onResult(text.trim(), { live: true }); }
        } catch (err) {
          if (!(err?.rateLimit)) setError(String(err?.message || "Transcription failed."));
        } finally {
          setBusy(false);
        }
      }
      setLevel(0);
    } else {
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
    }
    // Auto-send the full accumulated dictation if the user enabled it.
    const finalText = fullTextRef.current.trim();
    if (autoSendRef.current && finalText) scheduleAutoSend(finalText);
  }, [isNative, onResult, stopRecorderNative, scheduleAutoSend]);
  stopRef.current = stop;

  const captureChunk = useCallback(async () => {
    if (!recordingRef.current) return;
    let res = null;
    try {
      res = await stopRecorderNative();
    } catch (e) {
      res = null;
    }
    if (res && res.base64) {
      busyRef.current = true;
      setBusy(true);
      try {
        const blob = base64ToBlob(res.base64, res.mimeType || "audio/mp4");
        const text = await transcribeVoiceNote(myUid, blob);
        if (text && text.trim()) {
          fullTextRef.current += (fullTextRef.current ? " " : "") + text.trim();
          if (showInterim) setInterimText(text.trim());
          onResult(text.trim(), { live: true });
        }
      } catch (err) {
        if (!(err?.rateLimit)) setError(String(err?.message || "Transcription failed."));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }
    if (recordingRef.current) startNativeLive();
  }, [myUid, onResult, stopRecorderNative, showInterim]);

  const startNativeLive = useCallback(async () => {
    if (!recordingRef.current) return;
    try {
      await NextextNative.startVoiceRecording();
      recorderActiveRef.current = true;
      clearChunkTimer();
      chunkTimerRef.current = setTimeout(() => { captureChunk(); }, LIVE_CHUNK_MS);
      resetSilence();
    } catch (err) {
      setError(String(err?.message || "Could not start microphone."));
      recordingRef.current = false;
      setRecording(false);
    }
  }, [captureChunk, resetSilence]);

  const startNative = useCallback(async () => {
    recordingRef.current = true;
    fullTextRef.current = "";
    setInterimText("");
    setError("");
    setRecording(true);
    triggerHaptic("light");
    resetSilence();
    try {
      await NextextNative.startVoiceRecording();
      recorderActiveRef.current = true;
      clearChunkTimer();
      chunkTimerRef.current = setTimeout(() => { captureChunk(); }, LIVE_CHUNK_MS);
    } catch (err) {
      setError(String(err?.message || "Could not start microphone."));
      recordingRef.current = false;
      setRecording(false);
    }
  }, [captureChunk, resetSilence]);

  // Web Speech API realtime (desktop browsers only).
  const startWebRealtime = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return false;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript + " ";
        else interimTranscript += transcript;
      }
      if (interimTranscript) { if (showInterim) setInterimText(interimTranscript); }
      if (finalTranscript) {
        const t = finalTranscript.trim();
        if (t) { fullTextRef.current += (fullTextRef.current ? " " : "") + t; if (showInterim) setInterimText(""); onResult(t, { live: true }); }
        resetSilence();
      }
    };
    recognition.onerror = (err) => {
      if (err.error !== "no-speech" && err.error !== "aborted") {
        try { recognition.stop(); } catch {}
        startWebMediaRecorder();
      }
    };
    recognition.onend = () => {
      if (recordingRef.current) { try { recognition.start(); } catch {} }
      else { setRecording(false); }
    };
    recognition.start();
    recognitionRef.current = recognition;
    recordingRef.current = true;
    fullTextRef.current = "";
    setInterimText("");
    setRecording(true);
    resetSilence();
    return true;
  }, [onResult, resetSilence, showInterim]);

  const recognitionRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recorderRef = useRef(null);

  const startWebMediaRecorder = useCallback(async () => {
    try {
      const stream = await getMicrophoneStream({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const Recorder = window.MediaRecorder || (window.webkitMediaRecorder && window.webkitMediaRecorder);
      if (!Recorder) throw new Error("Recording not supported on this device.");
      const mimeCandidates = ["audio/mp4", "audio/m4a", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      let recMime = "";
      for (const c of mimeCandidates) {
        try { if (Recorder.isTypeSupported && Recorder.isTypeSupported(c)) { recMime = c; break; } } catch {}
      }
      const rec = recMime ? new Recorder(stream, { mimeType: recMime }) : new Recorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        try {
          setBusy(true);
          const blob = new Blob(chunksRef.current, { type: recMime || "audio/mp4" });
          const text = await transcribeVoiceNote(myUid, blob);
          if (text) { fullTextRef.current = text.trim(); onResult(text.trim(), { live: true }); }
        } catch (err) {
          setError(String(err?.message || "Transcription failed."));
        } finally {
          setBusy(false);
          if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
          setRecording(false);
          recordingRef.current = false;
          const finalText = fullTextRef.current.trim();
          if (autoSendRef.current && finalText) scheduleAutoSend(finalText);
        }
      };
      rec.start();
      recordingRef.current = true;
      fullTextRef.current = "";
      setInterimText("");
      setRecording(true);
      resetSilence();
    } catch (err) {
      const msg = String(err?.message || "Could not start microphone.");
      setError(msg.includes("NotAllowed") || msg.includes("Permission") ? "Microphone permission denied. Allow in system settings." : msg);
      recordingRef.current = false;
      setRecording(false);
    }
  }, [myUid, onResult, resetSilence]);

  const start = useCallback(async () => {
    setError("");
    setInterimText("");
    clearPending();
    if (recordingRef.current) return;
    triggerHaptic("light");
    if (isNative) { await startNative(); return; }
    if (useRealtime && startWebRealtime()) return;
    await startWebMediaRecorder();
  }, [isNative, useRealtime, startNative, startWebRealtime, startWebMediaRecorder]);

  const toggle = useCallback(() => {
    triggerHaptic("light");
    if (recordingRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(() => () => {
    clearChunkTimer();
    if (pendingTimerRef.current) clearInterval(pendingTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recorderActiveRef.current && isNative) { try { NextextNative.cancelVoiceRecording(); } catch {} }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); }
  }, [isNative]);

  const dim = Math.max(30, Math.round(size * composerHeight));
  const bars = 7;

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <button
        onClick={toggle}
        disabled={busy}
        title={recording ? "Tap to stop — transcribing live" : "Speak to message"}
        style={{
          width: dim, height: dim, borderRadius: "50%",
          background: recording ? "#FF3B30" : (busy ? color : "transparent"),
          border: `1px solid ${recording ? "#FF3B30" : color}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: busy ? "wait" : "pointer", flexShrink: 0, opacity: busy ? 0.7 : 1,
          transition: "background 0.15s, border-color 0.15s, transform 0.08s",
        }}
        onMouseDown={() => { if (!busy) triggerHaptic("light"); }}
        onTouchStart={() => { if (!busy) triggerHaptic("light"); }}
      >
        {busy ? <Loader2 size={Math.max(16, Math.round(18 * composerHeight))} color={color} className="nx-spin" />
          : recording ? <Square size={Math.max(14, Math.round(16 * composerHeight))} color="#fff" fill="#fff" />
          : <AudioLines size={Math.max(16, Math.round(18 * composerHeight))} color={color} />}
      </button>
      {recording && (
        <div style={{ position: "absolute", top: -dim * 0.7, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 3, alignItems: "center", height: dim * 0.45 }}>
          {[...Array(bars)].map((_, i) => {
            const v = isNative ? level : (busy ? 0.5 : 0.2);
            const h = Math.max(4, dim * 0.4 * (0.25 + 0.75 * Math.abs(Math.sin((i + 1) * 1.3 + v * 6) * (0.4 + v))));
            return (
              <div key={i} style={{ width: 3, height: h, background: color, borderRadius: 2, transition: "height 0.08s linear" }} />
            );
          })}
        </div>
      )}
      {recording && showInterim && interimText ? (
        <div style={{
          position: "absolute", bottom: dim + 6, left: "50%", transform: "translateX(-50%)",
          maxWidth: 240, background: "rgba(0,0,0,0.82)", color: "#fff", fontSize: 12.5,
          padding: "6px 10px", borderRadius: 10, whiteSpace: "pre-wrap", wordBreak: "break-word",
          textAlign: "center", lineHeight: 1.3, boxShadow: "0 4px 16px rgba(0,0,0,0.3)", zIndex: 50,
        }}>{interimText}</div>
      ) : null}
      {error ? (
        <div style={{
          position: "absolute", bottom: dim + 6, left: "50%", transform: "translateX(-50%)",
          maxWidth: 240, background: "#FF3B30", color: "#fff", fontSize: 12,
          padding: "6px 10px", borderRadius: 10, textAlign: "center", lineHeight: 1.3, zIndex: 50,
        }}>{error}</div>
      ) : null}
      {pendingSend ? (
        <div style={{
          position: "absolute", bottom: dim + 6, left: "50%", transform: "translateX(-50%)",
          display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.88)", color: "#fff",
          padding: "7px 10px", borderRadius: 12, fontSize: 12.5, zIndex: 60, whiteSpace: "nowrap",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}>
          <span>Auto-sending in {pendingSend.left}s</span>
          <button onClick={cancelAutoSend} style={{ background: color, color: "#fff", border: "none", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
        </div>
      ) : null}
    </div>
  );
}
