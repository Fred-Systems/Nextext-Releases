import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, Camera, Plus, MessageSquare, UserPlus, X, Info, ShieldCheck, ShieldOff, Bot, CheckCircle, Clock } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import {
  getOrCreateDirectChat, addMembersToGroup, updateGroupProfile,
  isGroupAdmin, getUsersByUids, setGroupNickname, setGroupAdmin, leaveGroupChat,
} from "../firebase/chats";
import { useContacts, sendContactRequest } from "../firebase/contacts";
import { uploadChatFile } from "../supabase/media";
import Avatar from "../components/Avatar";
import { AI_CONTACT_UID, useGroupAIRequestHook, requestGroupAI, cancelGroupAIRequest, removeGroupAI } from "../firebase/ai";

export default function GroupInfoScreen({ myUid, chatId, onBack, onOpenChat, onOpenContactProfile }) {
  const { t } = useTheme();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [myUser, setMyUser] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nickDraft, setNickDraft] = useState("");
  const [nickSaving, setNickSaving] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const photoInputRef = useRef(null);
  const { contacts } = useContacts(myUid);
  // NexText AI injection request state for this group (readable by group admins).
  const aiRequest = useGroupAIRequestHook(chatId);
  const [aiBusy, setAiBusy] = useState(false);

  // Live group document.
  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, "chats", chatId), (snap) => {
      const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      setGroup(data);
      if (data) setNameDraft(data.groupName || "");
    });
    return unsub;
  }, [chatId]);

  // Live own user document (for per-user nickname override).
  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      setMyUser(snap.exists() ? snap.data() : null);
    });
    return unsub;
  }, [myUid]);

  // Pull the entire list of human user participants and their profiles.
  useEffect(() => {
    let cancelled = false;
    const participants = group?.participants || [];
    if (participants.length === 0) { setMembers([]); return; }
    getUsersByUids(participants)
      .then((rows) => { if (!cancelled) setMembers(rows); })
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, [group?.participants]);

  useEffect(() => {
    if (myUser && nickDraft === "") setNickDraft(myUser.groupNicknames?.[chatId] || "");
  }, [myUser, nickDraft, chatId]);

  if (!group) {
    return (
      <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px", background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
          <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
          <span style={{ color: t.text, fontWeight: 700, fontSize: 16 }}>Group Info</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: t.textMuted, fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  const isAdmin = isGroupAdmin(group, myUid);
  const myNickname = myUser?.groupNicknames?.[chatId] || "";
  const displayName = isAdmin ? (group.groupName || "Group") : (myNickname || group.groupName || "Group");

  const hasAIInGroup = (group.participants || []).includes(AI_CONTACT_UID);

  const doRequestAI = async () => {
    setAiBusy(true);
    try {
      await requestGroupAI(chatId, group.groupName || "Group", myUid, myUser?.displayName || myUser?.username || "unknown");
    } catch { /* silent */ }
    setAiBusy(false);
  };

  const doCancelRequestAI = async () => {
    setAiBusy(true);
    try { await cancelGroupAIRequest(chatId); } catch { /* silent */ }
    setAiBusy(false);
  };

  const doRemoveAI = async () => {
    if (!window.confirm("Remove NexText AI from this group? It will stop replying immediately.")) return;
    setAiBusy(true);
    try { await removeGroupAI(chatId); } catch { /* silent */ }
    setAiBusy(false);
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !isAdmin) return;
    try {
      const result = await uploadChatFile(`group-${chatId}`, myUid, file, { compress: true });
      await updateGroupProfile(chatId, { groupPhotoURL: result.url });
    } catch { /* silent */ }
  };

  const saveName = async () => {
    if (!isAdmin) return;
    setNameSaving(true);
    try { await updateGroupProfile(chatId, { groupName: nameDraft.trim() || "Group" }); } catch { /* silent */ }
    setNameSaving(false);
  };

  const saveNick = async () => {
    setNickSaving(true);
    try { await setGroupNickname(myUid, chatId, nickDraft.trim()); } catch { /* silent */ }
    setNickSaving(false);
  };

  const startChat = async (member) => {
    try {
      const id = await getOrCreateDirectChat(myUid, member.uid);
      onOpenChat(
        { id, type: "direct", participants: [myUid, member.uid] },
        member.uid,
        { uid: member.uid, profile: member.profile }
      );
    } catch { /* silent */ }
  };

  const addContact = (member) => {
    sendContactRequest(myUid, member.uid).catch(() => {});
  };

  const availableContacts = (contacts || []).filter(
    (c) => !(group.participants || []).includes(c.uid)
  );

  const doAddMember = async (uid) => {
    try {
      await addMembersToGroup(chatId, [uid]);
      setShowAddMember(false);
    } catch { /* silent */ }
  };

  // Any member (not just the creator/admin) can leave the group.
  const doLeaveGroup = async () => {
    if (!window.confirm("Leave this group? You'll stop receiving its messages and it will disappear from your chat list.")) return;
    try { await leaveGroupChat(chatId, myUid); } catch { /* silent */ }
    onBack();
  };

  // Promote a member to group admin, or revoke it. The creator can never be
  // demoted, and no admin can demote themselves.
  const toggleAdmin = async (member) => {
    if (!isAdmin || !member?.uid) return;
    if (member.uid === myUid) return;
    if (group.createdBy === member.uid) return;
    const currentlyAdmin = isGroupAdmin(group, member.uid);
    try {
      await setGroupAdmin(chatId, member.uid, !currentlyAdmin);
    } catch { /* silent */ }
  };

  return (
      <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px", background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
          <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 16, flex: 1 }}>Group Info</span>
        {isAdmin && <span style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>Admin</span>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* Group identity card */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 18px" }}>
          <div style={{ position: "relative" }}>
            {group.groupPhotoURL ? (
              <img src={group.groupPhotoURL} alt="" style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }} />
            ) : (
              <div style={{ width: 96, height: 96, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>
                <Info size={40} color={t.primary} />
              </div>
            )}
            {isAdmin && (
              <div onClick={() => photoInputRef.current?.click()} style={{ position: "absolute", bottom: 0, right: 0, width: 30, height: 30, borderRadius: "50%", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "2px solid #fff" }}>
                <Camera size={15} color="#fff" />
              </div>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />
          </div>

          {isAdmin ? (
            <div style={{ width: "100%", marginTop: 12 }}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Group name"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 15, boxSizing: "border-box", background: t.surface, color: t.text, textAlign: "center", fontWeight: 600 }}
              />
              <button onClick={saveName} disabled={nameSaving} style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: nameSaving ? "default" : "pointer" }}>
                {nameSaving ? "Saving…" : "Save Group Name"}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 12, fontWeight: 700, fontSize: 17, color: t.text, textAlign: "center" }}>{displayName}</div>
          )}

          <div style={{ marginTop: 4, fontSize: 12.5, color: t.textMuted }}>{(group.participants || []).length} members</div>

          {/* Per-user nickname override (available to everyone) */}
          <div style={{ width: "100%", marginTop: 14, padding: "12px 14px", borderRadius: 12, background: t.surface, border: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 6 }}>Your nickname for this group (overrides the name above on your screen only)</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={nickDraft}
                onChange={(e) => setNickDraft(e.target.value)}
                placeholder="e.g. Study Squad"
                style={{ flex: 1, padding: "9px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, boxSizing: "border-box", background: t.bg, color: t.text }}
              />
              <button onClick={saveNick} disabled={nickSaving} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: nickSaving ? "default" : "pointer" }}>
                {nickSaving ? "…" : "Save"}
              </button>
            </div>
          </div>
        </div>

        {/* Members list */}
        <div style={{ fontWeight: 700, fontSize: 14, color: t.text, margin: "6px 2px 8px" }}>Members</div>
        <div style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, overflow: "hidden" }}>
          {members.map((m, idx) => {
            const name = m.profile?.displayName || m.profile?.username || "User";
            return (
              <div key={m.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: idx === 0 ? "none" : `1px solid ${t.border}` }}>
                <Avatar
                  photoURL={m.profile?.photoURL}
                  name={name}
                  uid={m.uid}
                  size={42}
                  onViewProfile={onOpenContactProfile ? () => onOpenContactProfile(m.uid, { uid: m.uid, profile: m.profile }) : undefined}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                  {isGroupAdmin(group, m.uid) && <div style={{ fontSize: 11.5, color: t.primary, fontWeight: 600 }}>Admin</div>}
                </div>
                {isAdmin && m.uid !== myUid && group.createdBy !== m.uid && (
                  <div
                    onClick={() => toggleAdmin(m)}
                    title={isGroupAdmin(group, m.uid) ? "Revoke admin" : "Make admin"}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 10, background: isGroupAdmin(group, m.uid) ? t.primaryLight : t.bg, cursor: "pointer" }}
                  >
                    {isGroupAdmin(group, m.uid) ? <ShieldOff size={15} color={t.textMuted} /> : <ShieldCheck size={15} color={t.primary} />}
                    <span style={{ fontWeight: 700, fontSize: 12, color: isGroupAdmin(group, m.uid) ? t.textMuted : t.primary }}>
                      {isGroupAdmin(group, m.uid) ? "Remove admin" : "Make admin"}
                    </span>
                  </div>
                )}
                <div onClick={() => startChat(m)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                  <MessageSquare size={15} color={t.primary} />
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: t.primary }}>Start Chat</span>
                </div>
                <div onClick={() => addContact(m)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                  <UserPlus size={15} color={t.primary} />
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: t.primary }}>Add Contact</span>
                </div>
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <div style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, padding: 14, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Bot size={17} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>NexText AI</span>
              {hasAIInGroup && <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 8, background: "#E5F9E7", color: "#28A745", fontWeight: 700 }}>ACTIVE</span>}
            </div>

            {hasAIInGroup ? (
              <>
                <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.5, marginBottom: 10 }}>
                  NexText AI is live in this group. It replies whenever a message starts with <strong>"Hey NexText"</strong> or ends with a <strong>question mark</strong>.
                </div>
                <button onClick={doRemoveAI} disabled={aiBusy} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: "#FFE5E5", color: "#FF3B30", fontWeight: 700, fontSize: 13, cursor: aiBusy ? "default" : "pointer" }}>
                  {aiBusy ? "Working…" : "Remove NexText AI from group"}
                </button>
              </>
            ) : aiRequest?.status === "pending" ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#856404", fontWeight: 600, marginBottom: 8 }}>
                  <Clock size={14} /> Request pending — awaiting NexText admin approval.
                </div>
                <button onClick={doCancelRequestAI} disabled={aiBusy} style={{ width: "100%", padding: 11, borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontWeight: 700, fontSize: 13, cursor: aiBusy ? "default" : "pointer" }}>
                  {aiBusy ? "Working…" : "Cancel request"}
                </button>
              </>
            ) : aiRequest?.status === "approved" || aiRequest?.status === "removed" ? (
              <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.5 }}>
                {aiRequest.status === "approved"
                  ? "NexText AI was approved for this group but isn't active yet — ask the NexText admin to check, or request it again below."
                  : "NexText AI was removed from this group. You can request it again anytime."}
                <button onClick={doRequestAI} disabled={aiBusy} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: aiBusy ? "default" : "pointer", marginTop: 10 }}>
                  {aiBusy ? "Working…" : "Request NexText AI again"}
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.5, marginBottom: 10 }}>
                  Ask the NexText admin to add the official NexText AI assistant to this group. Once approved, it joins the chat and replies when a message starts with <strong>"Hey NexText"</strong> or ends with a <strong>question mark</strong>.
                </div>
                <button onClick={doRequestAI} disabled={aiBusy} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: aiBusy ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <CheckCircle size={15} /> {aiBusy ? "Working…" : "Request NexText AI in this group"}
                </button>
              </>
            )}
          </div>
        )}

        {isAdmin && (
          <div
            onClick={() => setShowAddMember(true)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, padding: 13, borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
          >
            <Plus size={18} /> Add Member
          </div>
        )}

        <div
          onClick={doLeaveGroup}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, padding: 13, borderRadius: 12, background: "#FFE5E5", color: "#FF3B30", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
        >
          <X size={18} /> Leave Group
        </div>
      </div>

      {/* Add Member sheet */}
      {showAddMember && (
        <div onClick={() => setShowAddMember(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "70%", overflowY: "auto", padding: 16, boxShadow: "0 -4px 20px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: t.text }}>Add Member</span>
              <X size={22} color={t.textMuted} onClick={() => setShowAddMember(false)} style={{ cursor: "pointer" }} />
            </div>
            {availableContacts.length === 0 ? (
              <div style={{ color: t.textMuted, fontSize: 14, padding: "20px 0", textAlign: "center" }}>No contacts available to add.</div>
            ) : (
              availableContacts.map((c) => (
                <div key={c.uid} onClick={() => doAddMember(c.uid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 4px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                  <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName || "User"} uid={c.uid} size={40} />
                  <span style={{ fontWeight: 600, color: t.text, fontSize: 14.5, flex: 1 }}>{c.profile?.displayName || c.profile?.username || "User"}</span>
                  <Plus size={18} color={t.primary} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
