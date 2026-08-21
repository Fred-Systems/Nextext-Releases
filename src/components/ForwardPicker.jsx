import React, { useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Check, Forward } from "lucide-react";
import Avatar from "./Avatar";
import { getContactDisplayName } from "../firebase/contacts";
import { AI_CONTACT_UID } from "../firebase/ai";

// Bottom-sheet picker for forwarding a message to several targets at once.
// Lists the user's accepted contacts plus their own "My notes" self-chat.
// `contacts` are the user's accepted contacts. onForward(targets) receives the
// selected rows as [{ uid, displayName }]. `myProfile` is the current user's
// own profile ({ displayName, photoURL }) so the self row shows the real name.
export default function ForwardPicker({ t, myUid, contacts, myProfile, onClose, onForward }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState({});

  const rows = (contacts || [])
    .filter((c) => c.status === "accepted" && c.uid !== AI_CONTACT_UID)
    .filter((c) => c.uid !== myUid)
    .filter((c) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (getContactDisplayName(c) || "").toLowerCase().includes(q);
    })
    .sort((a, b) => getContactDisplayName(a).localeCompare(getContactDisplayName(b)));

  const selfRow = {
    uid: myUid,
    displayName: `${myProfile?.displayName || "Me"} (You)`,
    photoURL: myProfile?.photoURL || null,
  };
  const finalRows = [selfRow, ...rows];

  const toggle = (uid) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[uid]) delete next[uid];
      else next[uid] = true;
      return next;
    });
  };

  const selectedUids = Object.keys(selected);

  const confirm = () => {
    if (!selectedUids.length) return;
    const targets = finalRows.filter((r) => selected[r.uid]);
    try { onForward(targets); } catch { /* handled upstream */ }
  };

  const rowName = (r) => {
    if (r.uid === myUid) return r.displayName;
    return getContactDisplayName(r);
  };
  const rowPhoto = (r) => r.photoURL || (r.uid === myUid ? null : r.profile?.photoURL || null);

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2147481400 }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: t.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, zIndex: 2147481401, maxHeight: "78vh", display: "flex", flexDirection: "column", padding: "16px 18px calc(20px + var(--safe-bottom))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: t.text }}>Forward to</span>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.4 }}>
          Pick one or more chats. The message keeps a small "Forwarded" badge.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, marginBottom: 10 }}>
          <Search size={16} color={t.textMuted} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: t.text, fontSize: 14 }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {finalRows.length === 0 ? (
            <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, padding: "26px 0" }}>
              No contacts to forward to yet.
            </div>
          ) : (
            finalRows.map((r) => (
              <div
                key={r.uid}
                onClick={() => toggle(r.uid)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderRadius: 10, cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: selected[r.uid] ? t.primaryLight : "transparent" }}
              >
                <Avatar uid={r.uid} name={rowName(r)} photoURL={rowPhoto(r)} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: selected[r.uid] ? 700 : 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {rowName(r)}
                    {r.uid === myUid && <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 500, marginLeft: 6 }}>My notes</span>}
                  </div>
                </div>
                {selected[r.uid] && <Check size={18} color={t.primary} />}
              </div>
            ))
          )}
        </div>
        <button
          onClick={confirm}
          disabled={!selectedUids.length}
          style={{ marginTop: 12, width: "100%", padding: "12px 0", borderRadius: 12, border: "none", background: selectedUids.length ? t.primary : t.border, color: selectedUids.length ? t.bubbleMeText : t.textMuted, fontWeight: 700, fontSize: 15, cursor: selectedUids.length ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          <Forward size={16} /> Forward{selectedUids.length ? ` (${selectedUids.length})` : ""}
        </button>
      </div>
    </>,
    document.body
  );
}
