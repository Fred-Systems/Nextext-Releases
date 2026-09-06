import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Camera, X, Send, MessageCircle, Image as ImageIcon, ChevronLeft, Video, Megaphone } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";

// Cross-screen handoff: a photo captured from the ChatList camera button that
// targets a chat is stashed here so the ConversationScreen can send it on mount
// (we can't pass a File through onOpenChat easily). Exported as a mutable module
// variable with a setter so consumers can clear it after use.
export let pendingCameraFile = null;
export const setPendingCameraFile = (f) => { pendingCameraFile = f; };

// Cross-screen handoff for Status: a capture routed to "Post to Status" is
// stashed here and announced via a window event so the Status tab can open the
// NEW Status Builder (StatusScreen.routeNativeFile) with the File. ChatList
// also opens the same builder locally as the immediate path; this export keeps
// the StatusScreen-side wiring available without a second editing flow.
export let pendingStatusFile = null;
export const setPendingStatusFile = (f) => { pendingStatusFile = f; };
export function requestStatusBuilderFile(file) {
  setPendingStatusFile(file || null);
  try {
    window.dispatchEvent(new CustomEvent("nextext:open-status-builder", { detail: { at: Date.now() } }));
  } catch { /* noop */ }
}

// Hidden <input type="file"> helper. With `capture` set, mobile browsers open
// the device's native camera (photo) or video recorder (video). Resolves with
// the chosen File, or null on cancel / error.
function pickFile(accept, capture) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.capture = capture;
    input.style.display = "none";
    let done = false;
    const cleanup = () => {
      window.removeEventListener("focus", onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    const finish = (file) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(file || null);
    };
    // When the OS camera/picker closes, the window regains focus. Only treat
    // that as a CANCEL if the input actually has no file selected — otherwise
    // (the normal "photo chosen" path) the `change` event has already populated
    // input.files, so we must NOT cancel. Guarding on input.files.length avoids
    // the focus-before-change race that silently discarded captures (the picker
    // would flash open and immediately close). The delay is deliberately long
    // (800ms): on real devices the `change` event can arrive well after focus
    // when the user presses checkmark/confirm on a large photo/video — a short
    // timer would misread the confirm as a cancel, drop the file, and force a
    // second camera session with Send/Post never appearing.
    const onFocus = () => {
      setTimeout(() => {
        if (!done && (!input.files || input.files.length === 0)) finish(null);
      }, 800);
    };
    input.onchange = () => finish(input.files && input.files[0] ? input.files[0] : null);
    // Modern browsers fire `cancel` when the picker is dismissed without a
    // choice — treat it as cancel directly instead of waiting on focus.
    try { input.oncancel = () => finish(null); } catch { /* older browsers */ }
    window.addEventListener("focus", onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

// Opens the device's native camera (Capacitor) for a PHOTO and resolves with a
// File, or null if the user cancelled / the camera errored. Falls back to a
// hidden <input type="file" accept="image/*" capture="environment"> so it keeps
// working in the browser.
async function openNativePhoto() {
  const CameraPlugin = window.Capacitor?.Plugins?.Camera;
  if (CameraPlugin && typeof CameraPlugin.getPhoto === "function") {
    try {
      const photo = await CameraPlugin.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: "DATA_URL",
        source: "CAMERA",
        correctOrientation: true,
      });
      if (photo && photo.dataUrl) {
        const dataUrl = photo.dataUrl;
        const comma = dataUrl.indexOf(",");
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        let bin;
        try { bin = atob(b64); } catch { bin = null; }
        if (bin) {
          const len = bin.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
          return new File([u8], "camera.jpg", { type: "image/jpeg" });
        }
      }
    } catch (e) {
      // A permission denial must surface guidance, NOT silently fall through to
      // the file-input path (which would just hit the same denial and look
      // like the picker "flashed and closed"). Other errors still fall through
      // to the <input capture> fallback below.
      const msg = e?.message || "";
      if (/denied|permission|not allowed/i.test(msg)) {
        const err = new Error(
          "Camera permission was denied. Allow camera access in your browser or system settings, then try again."
        );
        err.code = "PERMISSION_DENIED";
        throw err;
      }
      // Plugin unavailable/errored — fall through to the file-input path.
    }
  }
  // Fallback: hidden <input capture> opens the device camera on mobile WebViews
  // where the Capacitor Camera plugin isn't registered or was rejected.
  return pickFile("image/*", "environment");
}

// Capacitor's Camera plugin can't record video, so we open the OS video
// recorder through a hidden <input type="file" accept="video/*" capture>. The
// chosen File (typically video/mp4) is resolved. Web/dev fallback is identical.
async function openNativeVideo() {
  return pickFile("video/*", "environment");
}

// Opens the device's native capturer. `type` is "photo" (default) or "video".
// Always resolves with a File (image/jpeg or video/mp4) or null on cancel.
export async function openNativeCamera(type = "photo") {
  return type === "video" ? openNativeVideo() : openNativePhoto();
}

// The chooser sheet. Opens, asks whether to capture a PHOTO or VIDEO, then
// captures via the device's native camera/recorder, then offers where to route
// it. Pass whichever of onSendStatus / onSendChat / onSendChatTo /
// onStatusBuilder are relevant for the screen that opened it. `chats` should be
// an array of { id, name, isGroup } so the "Pick a chat" list can render.
//
// Status routing: "Post to Status" prefers onStatusBuilder (the NEW Status
// Builder via StatusScreen.routeNativeFile or the caller's local builder) and
// falls back to onSendStatus (legacy direct post) only when no builder handler
// is provided — there is a single Post button, never two competing flows.
export function NativeCameraSheet({ open, onClose, onSendStatus, onSendChat, onSendChatTo, onStatusBuilder, chats = [] }) {
  const { t } = useTheme();
  const [step, setStep] = useState("type"); // "type" | "capturing" | "chooser" | "pick"
  // Sheet state machine: IDLE(closed) → CAMERA_OPEN(capturing) → CAPTURED +
  // PREVIEW(chooser/pick) → SEND | POST_STATUS(runSend). CAPTURED/PREVIEW can
  // NEVER auto-return to CAMERA_OPEN: the only path back is the explicit
  // Retake button in the chooser (or the in-capturing mode switch). Capture
  // completions and focus/resume events never call startCapture.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // single-flight guard: `busy` state is stale across rapid taps
  const seqRef = useRef(0); // capture session id: stale OS-camera resolutions are ignored
  const openEdgeRef = useRef(false); // true while handling one open session: effect never refires mid-session
  const [pendingFile, setPendingFile] = useState(null);
  const [captureType, setCaptureType] = useState("photo");
  const [captureError, setCaptureError] = useState("");
  const [previewURL, setPreviewURL] = useState(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) {
      // Sheet closed: poison any in-flight capture AND reset the edge latch so
      // the next open starts exactly one fresh session.
      seqRef.current++;
      busyRef.current = false;
      openEdgeRef.current = false;
      return;
    }
    // Parent re-renders (focus/visibility bumps, list updates) must NOT restart
    // the capture while a session is already running or a file is captured —
    // only the closed→open EDGE starts a session. This is the reopen-loop fix:
    // previously any remount/re-fire re-invoked startCapture and stacked a
    // second OS camera session behind the first confirm.
    if (openEdgeRef.current) return;
    openEdgeRef.current = true;
    cancelledRef.current = false;
    setBusy(false);
    busyRef.current = false;
    setPendingFile(null);
    setCaptureError("");
    setCaptureType("photo");
    // On a device with the Capacitor Camera plugin, skip the Photo/Video chooser
    // and open the camera immediately (photo by default). The user can switch to
    // video from the sheet if they back out of the OS camera. In the browser (no
    // plugin) we keep the chooser because a file <input> can't be auto-opened
    // without a user gesture.
    if (window.Capacitor?.Plugins?.Camera?.getPhoto) {
      setStep("capturing");
      startCapture("photo");
    } else {
      setStep("type");
    }
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Object URL for the captured file preview. Revoked whenever the file
  // changes or the sheet closes so we never leak blob URLs.
  useEffect(() => {
    if (!pendingFile) { setPreviewURL(null); return; }
    let url = null;
    try { url = URL.createObjectURL(pendingFile); } catch { url = null; }
    setPreviewURL(url);
    return () => { try { if (url) URL.revokeObjectURL(url); } catch {} };
  }, [pendingFile]);

  if (!open) return null;

  const startCapture = async (type) => {
    // Ref guard (NOT the `busy` state): two rapid taps before re-render would
    // both see stale `busy === false` and stack two OS camera sessions — the
    // second session surfacing right after the first confirm (the reopen loop).
    if (busyRef.current) return;
    busyRef.current = true;
    const mySeq = ++seqRef.current;
    setBusy(true);
    setCaptureError("");
    setCaptureType(type);
    setStep("capturing");
    let file = null;
    let permDenied = false;
    try {
      file = await openNativeCamera(type);
    } catch (e) {
      file = null;
      permDenied = e?.code === "PERMISSION_DENIED";
      if (!cancelledRef.current && mySeq === seqRef.current) {
        setCaptureError(
          e?.code === "PERMISSION_DENIED" && e?.message
            ? e.message
            : "Couldn't open the camera. Allow camera access in your browser or system settings, then try again."
        );
      }
    }
    // A newer session (retake / close / reopen) superseded this one, or the
    // sheet unmounted: drop the stale resolution — it must never overwrite the
    // current file or restart the camera.
    if (cancelledRef.current || mySeq !== seqRef.current) { setBusy(false); busyRef.current = false; return; }
    setBusy(false);
    busyRef.current = false;
    if (!file || file.size === 0) {
      // Cancel OR empty clip: back to the chooser with guidance. NEVER
      // auto-reopen — the user explicitly taps Photo/Video/Retake to retry.
      if (file && file.size === 0 && !permDenied) {
        setCaptureError("That capture was empty — nothing was saved. Try again.");
      }
      setStep("type");
      return;
    }
    setPendingFile(file);
    setStep("chooser");
  };

  const runSend = async (fn, file) => {
    if (!fn || !file) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setCaptureError("");
    // The File is passed directly (already stashed in state) — the sheet only
    // closes AFTER the handler resolves, so Send/Post can never close the
    // sheet before the file is stashed.
    try { await fn(file); } catch { setCaptureError("Couldn't send that capture. Please try again."); setBusy(false); busyRef.current = false; return; }
    setBusy(false);
    busyRef.current = false;
    onClose();
  };

  const optionBtn = (icon, label, onClick, primary) => (
    <div
      onClick={busy ? undefined : onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: busy ? "default" : "pointer",
        borderRadius: 12, background: primary ? t.primary : t.primaryLight, marginBottom: 10,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <span style={{ fontWeight: 600, fontSize: 15, color: primary ? t.bubbleMeText : t.text }}>{label}</span>
    </div>
  );

  const renderType = () => (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Capture</span>
        <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
      </div>
      {optionBtn(<Camera size={18} color={t.bubbleMeText} />, "Photo", () => startCapture("photo"), true)}
      {optionBtn(<Video size={18} color={t.bubbleMeText} />, "Video", () => startCapture("video"), true)}
      {captureError && <div style={{ color: "#FF3B30", fontSize: 12.5, fontWeight: 600, textAlign: "center", padding: "4px 8px 8px", lineHeight: 1.5 }}>{captureError}</div>}
      <div style={{ color: t.textMuted, fontSize: 12, textAlign: "center", lineHeight: 1.5, padding: "0 8px" }}>
        If the camera doesn't open, allow camera access in your browser or system settings, then try again.
      </div>
      <div onClick={onClose} style={{ textAlign: "center", padding: "12px", color: t.textMuted, fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Cancel</div>
    </>
  );

  const isPendingVideo = (pendingFile?.type || "").startsWith("video");
  const pendingSize = pendingFile?.size
    ? pendingFile.size > 1048576
      ? `${(pendingFile.size / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(pendingFile.size / 1024))} KB`
    : "";
  // Single Post entry point: the NEW Status Builder when a builder handler is
  // wired (StatusScreen.routeNativeFile chain), legacy direct post otherwise.
  const statusFn = onStatusBuilder || onSendStatus;

  const renderChooser = () => (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>{isPendingVideo ? "Video captured" : "Photo captured"}</span>
        <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
      </div>
      {previewURL && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: 10, borderRadius: 12, background: t.bg }}>
          {isPendingVideo
            ? <video src={previewURL} style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", background: "#000" }} />
            : <img src={previewURL} alt="Captured" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", background: "#000" }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{isPendingVideo ? "Video" : "Photo"}{pendingSize ? ` • ${pendingSize}` : ""}</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Choose where to send it below.</div>
          </div>
        </div>
      )}
      {statusFn && optionBtn(<Megaphone size={18} color={t.bubbleMeText} />, "Post to Status", () => runSend(statusFn, pendingFile), true)}
      {onSendChat && optionBtn(<Send size={18} color={t.text} />, "Send to this chat", () => runSend(onSendChat, pendingFile))}
      {onSendChatTo && optionBtn(<MessageCircle size={18} color={t.text} />, "Pick a chat", () => setStep("pick"))}
      {captureError && <div style={{ color: "#FF3B30", fontSize: 12.5, fontWeight: 600, textAlign: "center", padding: "4px 8px", lineHeight: 1.5 }}>{captureError}</div>}
      <div onClick={onClose} style={{ textAlign: "center", padding: "12px", color: t.textMuted, fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Cancel</div>
    </>
  );

  const renderPick = () => (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <ChevronLeft size={22} color={t.text} onClick={() => setStep("chooser")} style={{ cursor: "pointer" }} />
        <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Choose a chat</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {chats.length === 0 && <div style={{ padding: 20, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No chats yet.</div>}
        {chats.map((c) => (
          <div
            key={c.id}
            onClick={() => !busy && runSend((file) => onSendChatTo(file, c.id), pendingFile)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 8px", cursor: busy ? "default" : "pointer", borderBottom: `1px solid ${t.border}`, opacity: busy ? 0.6 : 1 }}
          >
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {c.isGroup ? <MessageCircle size={18} color={t.primary} /> : <ImageIcon size={18} color={t.primary} />}
            </div>
            <span style={{ fontWeight: 600, fontSize: 15, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          </div>
        ))}
      </div>
    </>
  );

  return createPortal(
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2147483640, display: "flex", alignItems: "flex-end" }} onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 390, margin: "0 auto", background: t.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "18px 18px 26px", boxSizing: "border-box" }}>
        {step === "type" && renderType()}
        {step === "capturing" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "24px 0" }}>
            <Camera size={34} color={t.primary} />
            <span style={{ color: t.textMuted, fontSize: 14 }}>Opening camera…</span>
            <div
              onClick={() => startCapture(captureType === "photo" ? "video" : "photo")}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              {captureType === "photo" ? <Video size={16} color={t.primary} /> : <Camera size={16} color={t.primary} />}
              {captureType === "photo" ? "Switch to Video" : "Switch to Photo"}
            </div>
            <div onClick={onClose} style={{ color: t.textMuted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</div>
          </div>
        )}
        {step === "chooser" && renderChooser()}
        {step === "pick" && renderPick()}
      </div>
    </div>,
    document.body
  );
}

export default NativeCameraSheet;
