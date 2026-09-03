import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Camera, X, Send, MessageCircle, Image as ImageIcon, ChevronLeft } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";

// Cross-screen handoff: a photo captured from the ChatList camera button that
// targets a chat is stashed here so the ConversationScreen can send it on mount
// (we can't pass a File through onOpenChat easily). Exported as a mutable module
// variable with a setter so consumers can clear it after use.
export let pendingCameraFile = null;
export const setPendingCameraFile = (f) => { pendingCameraFile = f; };

// Opens the device's native camera (Capacitor) and resolves with a File, or
// null if the user cancelled / the camera errored. Falls back to a hidden
// <input type="file" capture="environment"> so it keeps working in the browser.
export async function openNativeCamera() {
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
      if (!photo || !photo.dataUrl) return null;
      const dataUrl = photo.dataUrl;
      const comma = dataUrl.indexOf(",");
      const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      let bin;
      try { bin = atob(b64); } catch { return null; }
      const len = bin.length;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], "camera.jpg", { type: "image/jpeg" });
    } catch {
      return null;
    }
  }

  // Web / dev fallback: let the browser's native capture picker supply a File.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
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
    const onFocus = () => { setTimeout(() => finish(null), 0); };
    input.onchange = () => finish(input.files && input.files[0] ? input.files[0] : null);
    window.addEventListener("focus", onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

// The chooser sheet. Opens, captures a photo via the native camera, then offers
// where to route it. Pass whichever of onSendStatus / onSendChat / onSendChatTo
// are relevant for the screen that opened it. `chats` should be an array of
// { id, name } so the "Pick a chat" list can render.
export function NativeCameraSheet({ open, onClose, onSendStatus, onSendChat, onSendChatTo, chats = [] }) {
  const { t } = useTheme();
  const [step, setStep] = useState("capturing"); // "capturing" | "chooser" | "pick"
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("capturing");
    setBusy(false);
    setPendingFile(null);
    (async () => {
      const file = await openNativeCamera();
      if (cancelled) return;
      if (!file) { onClose(); return; }
      setPendingFile(file);
      setStep("chooser");
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const runSend = async (fn, file) => {
    if (!fn || !file) return;
    setBusy(true);
    try { await fn(file); } finally { setBusy(false); onClose(); }
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

  const renderChooser = () => (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Send photo to</span>
        <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
      </div>
      {onSendStatus && optionBtn(<ImageIcon size={18} color={t.bubbleMeText} />, "Send to Status", () => runSend(onSendStatus, pendingFile), true)}
      {onSendChat && optionBtn(<Send size={18} color={t.text} />, "Send to this chat", () => runSend(onSendChat, pendingFile))}
      {onSendChatTo && optionBtn(<MessageCircle size={18} color={t.text} />, "Pick a chat", () => setStep("pick"))}
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
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 90, display: "flex", alignItems: "flex-end" }} onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 390, margin: "0 auto", background: t.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "18px 18px 26px", boxSizing: "border-box" }}>
        {step === "capturing" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "24px 0" }}>
            <Camera size={34} color={t.primary} />
            <span style={{ color: t.textMuted, fontSize: 14 }}>Opening camera…</span>
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
