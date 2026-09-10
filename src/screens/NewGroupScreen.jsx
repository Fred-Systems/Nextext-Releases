import React, { useState, useRef } from "react";
import { ChevronLeft, Check, Camera } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { useGlobalSettings, resolveHideCameraButtons } from "../firebase/config-settings";
import { createGroupChat } from "../firebase/chats";
import { uploadChatFile } from "../supabase/media";

export default function NewGroupScreen({ myUid, contacts, onBack, onCreated }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const hideCameras = resolveHideCameraButtons(globalSettings);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [groupPhoto, setGroupPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const photoInputRef = useRef(null);

  const toggle = (uid) => setSelected((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : [...s, uid]));

  const handlePhotoPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setGroupPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleCreate = async () => {
    setError("");
    setBusy(true);
    try {
      let photoURL = null;
      if (groupPhoto) {
        const result = await uploadChatFile("group-photo-temp", myUid, groupPhoto, { compress: true });
        photoURL = result.url;
      }
      const chatId = await createGroupChat(myUid, selected, name.trim(), { groupPhotoURL: photoURL });
      onCreated(chatId);
    } catch (e) {
      setError("Couldn't create group: " + e.message);
    }
    setBusy(false);
  };

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 45 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 18 }}>New Group</span>
      </div>
      <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <div onClick={() => photoInputRef.current?.click()} style={{ position: "relative", cursor: "pointer", flexShrink: 0 }}>
          <input ref={photoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoPick} />
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: photoPreview ? "transparent" : t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {photoPreview ? (
              <img src={photoPreview} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              !hideCameras && <Camera size={22} color={t.primary} />
            )}
          </div>
          {!hideCameras && (
          <div style={{ position: "absolute", bottom: 0, right: 0, width: 20, height: 20, borderRadius: "50%", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${t.bg}` }}>
            <Camera size={10} color="#fff" />
          </div>
          )}
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 15, boxSizing: "border-box" }} />
      </div>
      <div style={{ padding: "0 16px 8px" }}>
        <div style={{ fontSize: 12, color: t.textMuted }}>Only your accepted contacts can be added.</div>
      </div>
      {error && <div style={{ padding: "0 16px", color: "#FF3B30", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
        {contacts.length === 0 && <div style={{ color: t.textMuted, fontSize: 13 }}>You don't have any contacts yet.</div>}
        {contacts.map((c) => (
          <div key={c.uid} onClick={() => toggle(c.uid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer" }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: t.primary }}>
              {(c.profile?.displayName || "?")[0]}
            </div>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: t.text }}>{c.profile?.displayName}</span>
            <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${t.primary}`, background: selected.includes(c.uid) ? t.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {selected.includes(c.uid) && <Check size={14} color="#fff" />}
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: 16 }}>
        <button disabled={!name.trim() || selected.length === 0 || busy} onClick={handleCreate} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", background: (!name.trim() || !selected.length) ? t.border : t.primary, color: (!name.trim() || !selected.length) ? t.textMuted : t.bubbleMeText, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
          {busy ? "Creating…" : `Create Group ${selected.length ? `(${selected.length + 1} members)` : ""}`}
        </button>
      </div>
    </div>
  );
}
