import React, { useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, MessageSquare, Check } from "lucide-react";
import Avatar from "./Avatar";
import { getContactDisplayName } from "../firebase/contacts";
import { AI_CONTACT_UID } from "../firebase/ai";

// Bottom-sheet picker for sharing contact cards.
// mode="forward-to": pick a target chat to forward `shared` into (profile flow).
// mode="pick-contact": pick which of your contacts to share into the current
//   chat (composer + flow).
// `contacts` are the user's accepted contacts. onShare(target) hands back the
// chosen row (the forwarded-to target in forward-to mode, the contact to send
// in pick-contact mode).
export default function ContactSharePicker({ t, myUid, contacts, shared, mode = "forward-to", onClose, onShare }) {
  const [query, setQuery] = useState("");
  const [sentTo, setSentTo] = useState(null);

  const rows = (contacts || [])
    .filter((c) => c.status === "accepted" && c.uid !== AI_CONTACT_UID)
    .filter((c) => mode === "forward-to" ? (c.uid !== myUid && c.uid !== shared?.uid) : true)
    .filter((c) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (getContactDisplayName(c) || "").toLowerCase().includes(q);
    })
    .sort((a, b) => getContactDisplayName(a).localeCompare(getContactDisplayName(b)));

  const handlePick = (target) => {
    if (sentTo === target.uid) return;
    setSentTo(target.uid);
    try { onShare(target); } catch { /* handled upstream */ }
  };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2147481300 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: t.surface, borderRadius: "18px 18px 0 0", zIndex: 2147481301, padding: "16px 18px calc(20px + var(--safe-bottom))", maxHeight: "72vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: t.text }}>
            {mode === "forward-to" ? "Forward contact to" : "Share a contact"}
          </span>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.4 }}>
          {mode === "forward-to"
            ? `${shared?.name || "This contact"} will be shared as a contact card.`
            : "Pick a contact to send as a contact card in this chat."}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, marginBottom: 10 }}>
          <Search size={16} color={t.textMuted} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "forward-to" ? "Search contacts" : "Search your contacts"}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: t.text, fontSize: 14 }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {rows.length === 0 ? (
            <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, padding: "26px 0" }}>
              {sentTo ? "Contact shared ✓" : "No contacts to share with yet."}
            </div>
          ) : (
            rows.map((c) => (
              <div
                key={c.uid}
                onClick={() => handlePick(c)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderRadius: 10, cursor: "pointer", borderBottom: `1px solid ${t.border}` }}
              >
                <Avatar photoURL={c.profile?.photoURL} name={getContactDisplayName(c)} uid={c.uid} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getContactDisplayName(c)}</div>
                </div>
                {sentTo === c.uid ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: t.primary }}>
                    <Check size={14} /> Sent
                  </span>
                ) : (
                  <MessageSquare size={16} color={t.textMuted} />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
