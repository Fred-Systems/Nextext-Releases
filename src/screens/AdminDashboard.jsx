import React, { useState, useEffect } from "react";
import { ChevronLeft, ShieldCheck, Search, Megaphone, Trash2, Send, Users, Bot, Power, CheckCircle, UserPlus, EyeOff, UserMinus, SlidersHorizontal, Share2, Terminal, Camera, Mic, Zap, Lock, Tag, Globe, Compass, FileText, KeyRound } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { collection, query, where, getDocs, limit as fbLimit, doc, updateDoc, onSnapshot, addDoc, serverTimestamp, deleteDoc, orderBy, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { AI_CONTACT_UID, PERSONALITIES } from "../firebase/ai";
import { getOrCreateDirectChat } from "../firebase/chats";
import { ensureGlobalSettingsExist, useGlobalSettings, updateGlobalSettings } from "../firebase/config-settings";
import { getPreWarmConfig, setPreWarmEnabled } from "../firebase/prewarm";
import { getUserMessageStats, formatActiveTime, formatBytes } from "../firebase/stats";
import { ensureSystemConfig, useSystemConfigHook, setSystemConfig, useAIRequestsHook, approveAIRequest, approveAllAIRequests, GROQ_MODEL_OPTIONS, GROQ_LIVE_MODEL_OPTIONS, AI_MODE_OPTIONS, useGroupAIRequestsHook, approveGroupAIRequest, rejectGroupAIRequest } from "../firebase/ai";

export default function AdminDashboard({ myUid, onBack }) {
  const { t } = useTheme();
  const [tab, setTab] = useState("users");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserStats, setSelectedUserStats] = useState(null);
  const [selectedUserStatsLoading, setSelectedUserStatsLoading] = useState(false);
  const [reports, setReports] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [systemMsg, setSystemMsg] = useState("");
  const [systemMsgSent, setSystemMsgSent] = useState(false);
  const [error, setError] = useState("");
  const [clearedMsg, setClearedMsg] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [allUsersLoading, setAllUsersLoading] = useState(false);
  const [expiryInput, setExpiryInput] = useState("");
  const [expiryNever, setExpiryNever] = useState(false);
  const [allGroups, setAllGroups] = useState([]);
  const [allGroupsLoading, setAllGroupsLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMemberNames, setGroupMemberNames] = useState({});
  const [groupActionStatus, setGroupActionStatus] = useState("");
  const [groupAIName, setGroupAIName] = useState("NexText AI");
  const [groupAIPersonality, setGroupAIPersonality] = useState("default");
  const settings = useGlobalSettings();
  const sysConfig = useSystemConfigHook();
  const [preWarmOn, setPreWarmOn] = useState(false);
  useEffect(() => {
    getPreWarmConfig().then((c) => setPreWarmOn(!!c.preWarmEnabled)).catch(() => {});
  }, []);
  const [aiModeDraft, setAiModeDraft] = useState(sysConfig?.aiMode || "old");
  const [aiLiveDraft, setAiLiveDraft] = useState(sysConfig?.aiLiveModel || "groq/compound");
  const [aiSaved, setAiSaved] = useState(false);
  // Keep the draft in sync with the saved config. sysConfig loads asynchronously
  // (often after this component first renders), so initializing the draft from it
  // once left the selector stuck on "old" even after "live" was saved — reopening
  // the panel would reset the selection. Re-sync whenever the saved values change.
  useEffect(() => {
    if (sysConfig?.aiMode) setAiModeDraft(sysConfig.aiMode);
    if (sysConfig?.aiLiveModel) setAiLiveDraft(sysConfig.aiLiveModel);
  }, [sysConfig?.aiMode, sysConfig?.aiLiveModel]);
  const aiRequests = useAIRequestsHook();
  const groupAIRequests = useGroupAIRequestsHook();

  useEffect(() => { ensureGlobalSettingsExist(); ensureSystemConfig(); }, []);

  useEffect(() => {
    if (settings) {
      if (settings.mediaExpiryDays === null || settings.mediaExpiryDays === undefined) {
        setExpiryNever(true);
        setExpiryInput("");
      } else {
        setExpiryNever(false);
        setExpiryInput(String(settings.mediaExpiryDays));
      }
    }
  }, [settings]);

  useEffect(() => {
    if (tab !== "reports") return;
    const unsub = onSnapshot(collection(db, "reports"), (snap) => setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [tab]);

  useEffect(() => {
    if (tab !== "feedback") return;
    const unsub = onSnapshot(collection(db, "feedback"), (snap) => setFeedback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [tab]);

  useEffect(() => {
    if (tab !== "directory") return;
    setAllUsersLoading(true);
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setAllUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
      setAllUsersLoading(false);
    }, () => setAllUsersLoading(false));
    return unsub;
  }, [tab]);

  useEffect(() => {
    if (tab !== "groups") return;
    setAllGroupsLoading(true);
    const q = query(collection(db, "chats"), where("type", "==", "group"));
    const unsub = onSnapshot(q, (snap) => {
      setAllGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setAllGroupsLoading(false);
    }, () => setAllGroupsLoading(false));
    return unsub;
  }, [tab]);

  const runSearch = async (val) => {
    setSearch(val);
    if (val.trim().length < 2) { setResults([]); return; }
    try {
      const q = query(collection(db, "users"), where("usernameLower", ">=", val.toLowerCase()), where("usernameLower", "<=", val.toLowerCase() + "\uf8ff"), fbLimit(10));
      const snap = await getDocs(q);
      setResults(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
    } catch (e) {
      setError("Search failed: " + e.message);
    }
  };

  const setBanType = async (uid, banType) => {
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), { "moderation.banType": banType, "moderation.bannedAt": serverTimestamp(), "moderation.bannedBy": myUid });
    } catch (e) {
      setError("Couldn't update ban status: " + e.message);
    }
  };

  const clearParentalControls = async (uid) => {
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), {
        restrictions: {
          allowedContacts: "all", blockMedia: false, blockVoiceNotes: false,
          blockStatus: false, blockGroups: false, blockLinks: false,
          dailyTimeLimitMinutes: null, pinHash: null,
        },
      });
      setClearedMsg(true);
      setTimeout(() => setClearedMsg(false), 2200);
    } catch (e) {
      setError("Couldn't reset: " + e.message);
    }
  };

  const toggleBlockNameChange = async (uid, currentlyBlocked) => {
    setError("");
    try {
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      const curRestrictions = snap.data()?.restrictions || {};
      await updateDoc(ref, { restrictions: { ...curRestrictions, blockNameChange: !currentlyBlocked } });
    } catch (e) {
      setError("Couldn't update name-change setting: " + e.message);
    }
  };

  const [broadcastSending, setBroadcastSending] = useState(false);

  const sendSystemMessage = async () => {
    setError("");
    setBroadcastSending(true);
    try {
      // 1. Save the broadcast record in systemMessages
      await addDoc(collection(db, "systemMessages"), { text: systemMsg.trim(), createdAt: serverTimestamp(), createdBy: myUid, pinned: true });

      // 2. Deliver the message into each user's direct chat with the admin
      const usersSnap = await getDocs(query(collection(db, "users")));
      const recipientUids = usersSnap.docs.map((d) => d.id).filter((uid) => uid !== myUid);

      // Process in batches of 100 to avoid overwhelming Firestore
      for (let i = 0; i < recipientUids.length; i += 100) {
        const chunk = recipientUids.slice(i, i + 100);
        await Promise.all(chunk.map(async (recipientUid) => {
          try {
            const chatId = await getOrCreateDirectChat(myUid, recipientUid);
            const chatRef = doc(db, "chats", chatId);
            await addDoc(collection(db, "chats", chatId, "messages"), {
              senderId: myUid,
              senderName: "NexText Support",
              type: "text",
              text: systemMsg.trim(),
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
            await updateDoc(chatRef, {
              lastMessage: { text: systemMsg.trim(), senderId: myUid, sentAt: serverTimestamp(), type: "text" },
            });
          } catch { /* skip individual failures */ }
        }));
      }

      setSystemMsg("");
      setSystemMsgSent(true);
      setTimeout(() => setSystemMsgSent(false), 2000);
    } catch (e) {
      setError("Couldn't send: " + e.message);
    }
    setBroadcastSending(false);
  };

  const handleExpirySave = () => {
    if (expiryNever) {
      updateGlobalSettings({ mediaExpiryDays: null }, myUid);
    } else {
      const days = parseInt(expiryInput, 10);
      if (!isNaN(days) && days >= 0) {
        updateGlobalSettings({ mediaExpiryDays: days }, myUid);
      }
    }
  };

  const deleteFeedback = async (id) => {
    setError("");
    try {
      await deleteDoc(doc(db, "feedback", id));
    } catch (e) {
      setError("Couldn't delete feedback: " + e.message);
    }
  };

  const [aiResetStatus, setAiResetStatus] = useState("");

  const toggleUserAIAccess = async (uid, currentVal) => {
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), { aiApproved: !currentVal });
    } catch (e) {
      setError("Couldn't update AI access: " + e.message);
    }
  };

  const toggleUserHideAISettings = async (uid, currentVal) => {
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), { hideAISettings: !currentVal });
    } catch (e) {
      setError("Couldn't update AI settings visibility: " + e.message);
    }
  };

  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [postingAnn, setPostingAnn] = useState(false);
  const handlePostAnnouncement = async () => {
    if (!annTitle.trim() || !annBody.trim()) return;
    setPostingAnn(true);
    setError("");
    try {
      const list = (settings?.announcements || []).slice();
      list.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: annTitle.trim(),
        body: annBody.trim(),
        authorName: settings?.adminName || "Admin",
        createdAt: Date.now(),
      });
      await updateGlobalSettings({ announcements: list }, myUid);
      setAnnTitle("");
      setAnnBody("");
    } catch (e) {
      setError("Couldn't post announcement: " + e.message);
    } finally {
      setPostingAnn(false);
    }
  };
  const handleDeleteAnnouncement = async (id) => {
    setError("");
    try {
      const list = (settings?.announcements || []).filter((a) => a.id !== id);
      await updateGlobalSettings({ announcements: list }, myUid);
    } catch (e) {
      setError("Couldn't delete announcement: " + e.message);
    }
  };

  const resetAllAIAccess = async () => {
    if (!window.confirm("Nuclear option: Revoke AI access for ALL users and wipe all pending requests? This cannot be undone.")) return;
    setError("");
    setAiResetStatus("Resetting…");
    try {
      const usersSnap = await getDocs(query(collection(db, "users")));
      let userErrors = 0;
      await Promise.all(usersSnap.docs.map(async (d) => {
        try { await updateDoc(d.ref, { aiApproved: false }); } catch { userErrors++; }
      }));

      const requestsSnap = await getDocs(query(collection(db, "aiRequests")));
      let reqErrors = 0;
      await Promise.all(requestsSnap.docs.map(async (d) => {
        try { await deleteDoc(d.ref); } catch { reqErrors++; }
      }));

      const parts = [];
      parts.push(`${usersSnap.docs.length - userErrors}/${usersSnap.docs.length} users revoked`);
      parts.push(`${requestsSnap.docs.length - reqErrors}/${requestsSnap.docs.length} requests deleted`);
      setAiResetStatus("Done — " + parts.join(", "));
      setTimeout(() => setAiResetStatus(""), 4000);
    } catch (e) {
      setError("Reset failed: " + e.message);
      setAiResetStatus("");
    }
  };

  const resolveGroupMemberNames = async (participantUids) => {
    const missing = participantUids.filter((uid) => !(uid in groupMemberNames) && uid !== AI_CONTACT_UID);
    if (missing.length === 0) return;
    const entries = await Promise.all(
      missing.map(async (uid) => {
        if (uid === AI_CONTACT_UID) return [uid, "NexText AI"];
        try {
          const snap = await getDoc(doc(db, "users", uid));
          return [uid, snap.data()?.displayName || "Unknown"];
        } catch { return [uid, "Unknown"]; }
      })
    );
    setGroupMemberNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  };

  const injectAIIntoGroup = async (groupId) => {
    setError("");
    setGroupActionStatus("Injecting AI…");
    try {
      const chatRef = doc(db, "chats", groupId);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) { setGroupActionStatus("Group not found"); return; }
      const data = chatSnap.data();
      const participants = data.participants || [];
      if (participants.includes(AI_CONTACT_UID)) {
        setGroupActionStatus("AI already in this group");
        setTimeout(() => setGroupActionStatus(""), 3000);
        return;
      }
      await updateDoc(chatRef, {
        participants: [...participants, AI_CONTACT_UID],
        groupAIName: groupAIName.trim() || "NexText AI",
        groupAIPersonality: groupAIPersonality,
      });
      setGroupActionStatus("AI injected successfully");
      setTimeout(() => setGroupActionStatus(""), 3000);
    } catch (e) {
      setError("Couldn't inject AI: " + e.message);
      setGroupActionStatus("");
    }
  };

  const evictMemberFromGroup = async (groupId, memberUid) => {
    if (!window.confirm("Remove this member from the group?")) return;
    setError("");
    setGroupActionStatus("Evicting member…");
    try {
      const chatRef = doc(db, "chats", groupId);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) { setGroupActionStatus("Group not found"); return; }
      const data = chatSnap.data();
      const participants = (data.participants || []).filter((uid) => uid !== memberUid);
      await updateDoc(chatRef, { participants });
      setGroupActionStatus("Member evicted");
      if (selectedGroup?.id === groupId) {
        setSelectedGroup((prev) => prev ? { ...prev, participants } : null);
      }
      setTimeout(() => setGroupActionStatus(""), 3000);
    } catch (e) {
      setError("Couldn't evict member: " + e.message);
      setGroupActionStatus("");
    }
  };

  const evictAIFromGroup = async (groupId) => {
    if (!window.confirm("Evict NexText AI ('nextext-ai-system') from this group? This will immediately silence the bot.")) return;
    setError("");
    setGroupActionStatus("Evicting AI…");
    try {
      const chatRef = doc(db, "chats", groupId);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) { setGroupActionStatus("Group not found"); return; }
      const data = chatSnap.data();
      const participants = (data.participants || []).filter((uid) => uid !== AI_CONTACT_UID);
      await updateDoc(chatRef, { participants });
      setGroupActionStatus("AI evicted from group");
      if (selectedGroup?.id === groupId) {
        setSelectedGroup((prev) => prev ? { ...prev, participants } : null);
      }
      setTimeout(() => setGroupActionStatus(""), 3000);
    } catch (e) {
      setError("Couldn't evict AI: " + e.message);
      setGroupActionStatus("");
    }
  };

  const sendFeedbackAutoReply = async (feedbackItem) => {
    setError("");
    try {
      const chatId = [myUid, feedbackItem.fromUid].sort().join("_");
      const chatRef = doc(db, "chats", chatId);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) {
        await getOrCreateDirectChat(myUid, feedbackItem.fromUid);
      }
      await addDoc(collection(db, "chats", chatId, "messages"), {
        senderId: myUid,
        type: "text",
        text: "Thank you for your feedback!",
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
        senderName: "NexText Support",
      });
      await updateDoc(chatRef, {
        lastMessage: { text: "Thank you for your feedback!", senderId: myUid, sentAt: serverTimestamp(), type: "text" },
      });
    } catch (e) {
      setError("Couldn't send reply: " + e.message);
    }
  };

  // Fetch per-user message statistics whenever an admin opens a user's detail.
  useEffect(() => {
    if (!selectedUser?.uid) { setSelectedUserStats(null); return; }
    let cancelled = false;
    setSelectedUserStatsLoading(true);
    getUserMessageStats(selectedUser.uid)
      .then((s) => { if (!cancelled) { setSelectedUserStats(s); setSelectedUserStatsLoading(false); } })
      .catch(() => { if (!cancelled) setSelectedUserStatsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedUser?.uid]);

  if (selectedUser) {
    return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 46, display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
          <ChevronLeft size={22} color={t.text} onClick={() => setSelectedUser(null)} style={{ cursor: "pointer" }} />
          <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>{selectedUser.displayName}</span>
        </div>
        <div className="nx-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: t.textMuted }}>Username</div><div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 10 }}>@{selectedUser.username}</div>
            <div style={{ fontSize: 13, color: t.textMuted }}>Email</div><div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 10 }}>{selectedUser.email}</div>
            {Array.isArray(selectedUser.emailHistory) && selectedUser.emailHistory.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 4 }}>Previous emails</div>
                {[...selectedUser.emailHistory].reverse().map((h, i) => (
                  <div key={i} style={{ fontSize: 13, color: t.text, padding: "3px 0" }}>{h.email}</div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 13, color: t.textMuted }}>Ban status</div><div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{selectedUser.moderation?.banType || "none"}</div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 10 }}>Message statistics</div>
            {selectedUserStatsLoading && <div style={{ fontSize: 12.5, color: t.textMuted }}>Loading statistics…</div>}
            {!selectedUserStatsLoading && selectedUserStats && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 13, color: t.textMuted }}>Total messages</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{selectedUserStats.total}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 13, color: t.textMuted }}>Sent</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{selectedUserStats.sent}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 13, color: t.textMuted }}>Received</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{selectedUserStats.received}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 13, color: t.textMuted }}>Chats</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{selectedUserStats.chats}</span>
                </div>
                {selectedUserStats.mediaSizeBytes && (selectedUserStats.mediaSizeBytes.sent + selectedUserStats.mediaSizeBytes.recv > 0) && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
                    <span style={{ fontSize: 13, color: t.textMuted }}>Media sent / recv</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{formatBytes(selectedUserStats.mediaSizeBytes.sent)} / {formatBytes(selectedUserStats.mediaSizeBytes.recv)}</span>
                  </div>
                )}
              </div>
            )}
            {!selectedUserStatsLoading && !selectedUserStats && <div style={{ fontSize: 12.5, color: t.textMuted }}>Statistics unavailable.</div>}
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 10 }}>Moderation</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedUser.uid === myUid && (
                <div style={{ fontSize: 12.5, color: t.textMuted, fontStyle: "italic", marginBottom: 4 }}>You cannot moderate your own account.</div>
              )}
              <button onClick={() => setBanType(selectedUser.uid, "shadow")} disabled={selectedUser.uid === myUid} style={{ padding: 11, borderRadius: 10, border: "none", background: selectedUser.uid === myUid ? t.border : "#FF9500", color: selectedUser.uid === myUid ? t.textMuted : "#fff", fontWeight: 700, cursor: selectedUser.uid === myUid ? "not-allowed" : "pointer" }}>Shadow ban (invisible, can't message)</button>
              <button onClick={() => setBanType(selectedUser.uid, "full")} disabled={selectedUser.uid === myUid} style={{ padding: 11, borderRadius: 10, border: "none", background: selectedUser.uid === myUid ? t.border : "#FF3B30", color: selectedUser.uid === myUid ? t.textMuted : "#fff", fontWeight: 700, cursor: selectedUser.uid === myUid ? "not-allowed" : "pointer" }}>Full ban (can't sign in)</button>
              <button onClick={() => setBanType(selectedUser.uid, "none")} disabled={selectedUser.uid === myUid} style={{ padding: 11, borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 700, cursor: selectedUser.uid === myUid ? "not-allowed" : "pointer" }}>Clear ban</button>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Parental Controls Recovery</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              If a parent has lost their PIN or account access, this clears all
              restrictions and the PIN on this account entirely, so they can start fresh.
            </div>
            <button onClick={() => clearParentalControls(selectedUser.uid)} style={{ width: "100%", padding: 11, borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 700, cursor: "pointer" }}>
              Reset parental controls for this account
            </button>
            {clearedMsg && <div style={{ color: t.primary, fontSize: 12.5, marginTop: 8, textAlign: "center" }}>Done — restrictions cleared.</div>}
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Name change</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Block this user from changing their display name or username. Their old names are kept in chat history and shown below.
            </div>
            <button
              onClick={() => toggleBlockNameChange(selectedUser.uid, !!selectedUser.restrictions?.blockNameChange)}
              disabled={selectedUser.uid === myUid}
              style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: selectedUser.restrictions?.blockNameChange ? "#FFE5E5" : t.bg, color: selectedUser.restrictions?.blockNameChange ? "#FF3B30" : t.text, fontWeight: 700, cursor: selectedUser.uid === myUid ? "not-allowed" : "pointer" }}
            >
              {selectedUser.restrictions?.blockNameChange ? "Unblock name changes" : "Block name changes"}
            </button>
            {Array.isArray(selectedUser.nameHistory) && selectedUser.nameHistory.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, marginBottom: 6 }}>Previous names ({selectedUser.nameHistory.length})</div>
                {[...selectedUser.nameHistory].reverse().map((h, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: t.text, padding: "7px 0", borderTop: `1px solid ${t.border}` }}>
                    <div style={{ fontWeight: 600 }}>{h.displayName || "?"} <span style={{ color: t.textMuted, fontWeight: 400 }}>@{h.username || "?"}</span></div>
                    {h.changedAt?.toDate ? (
                      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>changed {h.changedAt.toDate().toLocaleString()}</div>
                    ) : (
                      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>changed (unknown time)</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 46 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <ShieldCheck size={18} color={t.text} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>Admin Dashboard</span>
      </div>
      <div style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${t.border}`, flexShrink: 0, WebkitOverflowScrolling: "touch" }}>
        {[["users", "Users"], ["directory", "Directory"], ["groups", "Groups"], ["reports", "Reports"], ["feedback", "Feedback"], ["broadcast", "Broadcast"], ["system", "System"], ["ai", "AI"]].map(([key, label]) => (
          <div key={key} onClick={() => setTab(key)} style={{ flex: "0 0 auto", textAlign: "center", padding: "12px 14px", fontSize: 11, fontWeight: 600, color: tab === key ? t.primary : t.textMuted, borderBottom: tab === key ? `2px solid ${t.primary}` : "2px solid transparent", cursor: "pointer", whiteSpace: "nowrap" }}>{label}</div>
        ))}
      </div>
      {error && <div style={{ color: "#FF3B30", fontSize: 12.5, padding: "8px 16px" }}>{error}</div>}

      {tab === "users" && (
        <>
          <div style={{ padding: "14px 16px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", background: t.surface, borderRadius: 12, padding: "10px 12px", gap: 8 }}>
              <Search size={16} color={t.textMuted} />
              <input value={search} onChange={(e) => runSearch(e.target.value)} placeholder="Search by username…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14, color: t.text }} />
            </div>
          </div>
          {settings && (
            <div style={{ padding: "0 16px 10px" }}>
              <div style={{ background: t.surface, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Media auto-delete after</div>
                <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8 }}>Set how many days before media is automatically removed.</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <input
                    type="number"
                    min="0"
                    value={expiryInput}
                    onChange={(e) => { setExpiryInput(e.target.value); setExpiryNever(false); }}
                    disabled={expiryNever}
                    placeholder="Days"
                    style={{ width: 70, padding: "6px 8px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, background: expiryNever ? t.border : t.bg, color: t.text, outline: "none" }}
                  />
                  <span style={{ fontSize: 12.5, color: t.textMuted }}>{expiryInput && !expiryNever ? `day${parseInt(expiryInput, 10) !== 1 ? "s" : ""}` : ""}</span>
                  <div style={{ flex: 1 }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: t.text, cursor: "pointer" }}>
                    <input type="checkbox" checked={expiryNever} onChange={(e) => { setExpiryNever(e.target.checked); if (e.target.checked) setExpiryInput(""); }} style={{ accentColor: t.primary }} />
                    Never
                  </label>
                </div>
                <button onClick={handleExpirySave} style={{ width: "100%", padding: 8, borderRadius: 8, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Save</button>
              </div>
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
            {results.map((u) => (
              <div key={u.uid} onClick={() => setSelectedUser(u)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 4px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: t.primary }}>{u.displayName?.[0]}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: t.text }}>{u.displayName} <span style={{ color: t.textMuted, fontWeight: 400 }}>@{u.username}</span></div>
                  <div style={{ fontSize: 12, color: t.textMuted }}>{u.email}</div>
                </div>
                {u.moderation?.banType && u.moderation.banType !== "none" && <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 8, background: "#FFE5E5", color: "#FF3B30", fontWeight: 700 }}>{u.moderation.banType}</span>}
              </div>
            ))}
            {search.trim().length >= 2 && results.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, padding: 20, textAlign: "center" }}>No users found.</div>}
          </div>
        </>
      )}

      {tab === "directory" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Users size={16} color={t.primary} />
            <span style={{ fontSize: 13, color: t.textMuted }}>All registered users ({allUsers.length})</span>
          </div>
          {allUsersLoading && <div style={{ color: t.textMuted, fontSize: 13, padding: 20, textAlign: "center" }}>Loading…</div>}
          {!allUsersLoading && allUsers.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No users found.</div>}
          {allUsers.map((u) => (
            <div key={u.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 4px", borderBottom: `1px solid ${t.border}` }}>
              <div onClick={() => setSelectedUser(u)} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, cursor: "pointer", minWidth: 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: t.primary }}>{u.displayName?.[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.displayName} <span style={{ color: t.textMuted, fontWeight: 400 }}>@{u.username}</span></div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>{u.email}{u.role === "admin" ? " · Admin" : ""}</div>
                </div>
                {u.moderation?.banType && u.moderation.banType !== "none" && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 6, background: "#FFE5E5", color: "#FF3B30", fontWeight: 700 }}>{u.moderation.banType}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div onClick={(e) => { e.stopPropagation(); toggleUserAIAccess(u.uid, !!u.aiApproved); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.aiApproved ? "#E5F9E7" : t.bg, border: `1px solid ${u.aiApproved ? "#28A745" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <Bot size={12} color={u.aiApproved ? "#28A745" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.aiApproved ? "#28A745" : t.textMuted }}>{u.aiApproved ? "AI On" : "AI Off"}</span>
                </div>
                <div onClick={(e) => { e.stopPropagation(); toggleUserHideAISettings(u.uid, !!u.hideAISettings); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.hideAISettings ? "#FFF3CD" : t.bg, border: `1px solid ${u.hideAISettings ? "#856404" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <EyeOff size={12} color={u.hideAISettings ? "#856404" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.hideAISettings ? "#856404" : t.textMuted }}>{u.hideAISettings ? "AI Settings Hidden" : "AI Settings Visible"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "groups" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {selectedGroup ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <ChevronLeft size={18} color={t.primary} onClick={() => setSelectedGroup(null)} style={{ cursor: "pointer" }} />
                <Users size={16} color={t.primary} />
                <span style={{ fontSize: 14, fontWeight: 700, color: t.text, flex: 1 }}>{selectedGroup.groupName || "Unnamed Group"}</span>
              </div>
              <div style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 4 }}>Members ({selectedGroup.participants?.length || 0})</div>
                {(selectedGroup.participants || []).map((uid) => {
                  const name = uid === AI_CONTACT_UID ? "NexText AI 🤖" : (groupMemberNames[uid] || "Loading…");
                  return (
                    <div key={uid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.border}` }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: uid === AI_CONTACT_UID ? "linear-gradient(135deg, #7C5CFF, #53BDEB)" : t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: uid === AI_CONTACT_UID ? "#fff" : t.primary }}>
                        {uid === AI_CONTACT_UID ? "🤖" : name[0]}
                      </div>
                      <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>{name}</div>
                      {uid === AI_CONTACT_UID ? (
                        <div onClick={() => evictAIFromGroup(selectedGroup.id)} style={{ padding: "4px 10px", borderRadius: 8, background: "#FFE5E5", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                          <UserMinus size={12} color="#FF3B30" />
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#FF3B30" }}>Evict AI</span>
                        </div>
                      ) : (
                        <div onClick={() => evictMemberFromGroup(selectedGroup.id, uid)} style={{ padding: "4px 10px", borderRadius: 8, background: "#FFE5E5", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                          <UserMinus size={12} color="#FF3B30" />
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#FF3B30" }}>Evict</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: t.text, marginBottom: 8 }}>AI Injection Settings</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>Customize the AI name and personality for this group before injecting.</div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>AI Display Name</div>
                  <input value={groupAIName} onChange={(e) => setGroupAIName(e.target.value)} placeholder="NexText AI" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, boxSizing: "border-box", background: t.bg, color: t.text }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>Personality</div>
                  <select value={groupAIPersonality} onChange={(e) => setGroupAIPersonality(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, cursor: "pointer" }}>
                    {Object.entries(PERSONALITIES).map(([key, p]) => (
                      <option key={key} value={key}>{p.icon} {p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button onClick={() => injectAIIntoGroup(selectedGroup.id)} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Bot size={15} /> {selectedGroup.participants?.includes(AI_CONTACT_UID) ? "AI Already Injected" : "Inject AI into Group"}
              </button>
              {groupActionStatus && <div style={{ fontSize: 12, color: t.primary, fontWeight: 600, marginTop: 8, textAlign: "center" }}>{groupActionStatus}</div>}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Users size={16} color={t.primary} />
                <span style={{ fontSize: 13, color: t.textMuted }}>All group chats ({allGroups.length})</span>
              </div>
              {allGroupsLoading && <div style={{ color: t.textMuted, fontSize: 13, padding: 20, textAlign: "center" }}>Loading…</div>}
              {!allGroupsLoading && allGroups.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No group chats found.</div>}
              {allGroups.map((g) => (
                <div key={g.id} onClick={() => { setSelectedGroup(g); resolveGroupMemberNames(g.participants || []); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Users size={18} color={t.primary} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.groupName || "Unnamed Group"}</div>
                    <div style={{ fontSize: 11.5, color: t.textMuted }}>{g.participants?.length || 0} members · {g.createdAt?.toDate ? g.createdAt.toDate().toLocaleDateString() : "unknown date"}</div>
                  </div>
                  {g.participants?.includes(AI_CONTACT_UID) && (
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: "#E5F9E7", color: "#28A745", fontWeight: 700 }}>AI Active</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "reports" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {reports.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No reports.</div>}
          {reports.map((r) => (
            <div key={r.id} style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 4 }}>{r.reason}</div>
              <div style={{ fontSize: 11, color: t.textMuted }}>{r.status}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "feedback" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {feedback.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No feedback yet.</div>}
          {feedback.map((f) => (
            <div key={f.id} style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>@{f.fromUsername || "unknown"}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => sendFeedbackAutoReply(f)} title="Send auto-reply" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${t.border}`, background: t.primaryLight, color: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Send size={13} /></button>
                  <button onClick={() => deleteFeedback(f.id)} title="Delete feedback" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: "#FF3B30", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Trash2 size={13} /></button>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: t.text }}>{f.message}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "broadcast" && (
        <div style={{ flex: 1, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Megaphone size={16} color={t.primary} />
            <span style={{ fontSize: 13, color: t.textMuted }}>Sends an announcement banner to every user's chat list.</span>
          </div>
          {systemMsgSent ? (
            <div style={{ background: t.primaryLight, borderRadius: 12, padding: 14, color: t.primary, fontWeight: 600 }}>Sent to all users.</div>
          ) : (
            <>
              <textarea value={systemMsg} onChange={(e) => setSystemMsg(e.target.value)} rows={5} placeholder="Announcement text…" style={{ width: "100%", padding: 14, borderRadius: 12, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", resize: "none", marginBottom: 12, color: t.text, background: t.surface }} />
              <button disabled={!systemMsg.trim() || broadcastSending} onClick={sendSystemMessage} style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: systemMsg.trim() && !broadcastSending ? t.primary : t.border, color: systemMsg.trim() && !broadcastSending ? t.bubbleMeText : t.textMuted, fontWeight: 700, fontSize: 15, cursor: systemMsg.trim() && !broadcastSending ? "pointer" : "not-allowed" }}>
                {broadcastSending ? "Sending to all users…" : "Send to all users"}
              </button>
            </>
          )}
        </div>
      )}

      {tab === "system" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Power size={18} color="#FF3B30" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Global AI Master Kill-Switch</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, NexText AI is completely hidden from all users. All Groq API requests are blocked globally. The AI contact card, request forms, and sidebar widget are all disabled instantly.
            </div>
            <div onClick={() => {
              const newVal = !sysConfig?.aiGloballyDisabled;
              setSystemConfig({ aiGloballyDisabled: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.aiGloballyDisabled ? "#FF3B30" : t.primaryLight, cursor: "pointer", marginBottom: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.aiGloballyDisabled ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.aiGloballyDisabled ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: sysConfig?.aiGloballyDisabled ? "#fff" : t.text }}>
                {sysConfig?.aiGloballyDisabled ? "AI DISABLED GLOBALLY" : "AI Active"}
              </span>
            </div>
            {sysConfig?.aiGloballyDisabled && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#FFE5E5", color: "#FF3B30", fontSize: 12.5, fontWeight: 600 }}>
                All users cannot access NexText AI features while this is enabled.
              </div>
            )}
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <EyeOff size={18} color="#FF3B30" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Total AI Visibility Erase Switch</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Nuclear option. When active, ALL traces of AI are completely purged from every user's interface — settings panels, chat lists, contact lists, sidebar widget, status screens, menus. No mention, tab, button, or icon referencing AI will exist anywhere in the app.
            </div>
            <div onClick={() => {
              const newVal = !sysConfig?.hideAiEverywhere;
              setSystemConfig({ hideAiEverywhere: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.hideAiEverywhere ? "#FF3B30" : t.primaryLight, cursor: "pointer", marginBottom: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.hideAiEverywhere ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.hideAiEverywhere ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: sysConfig?.hideAiEverywhere ? "#fff" : t.text }}>
                {sysConfig?.hideAiEverywhere ? "AI FULLY ERASED" : "AI Visible"}
              </span>
            </div>
            {sysConfig?.hideAiEverywhere && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#FFE5E5", color: "#FF3B30", fontSize: 12.5, fontWeight: 600 }}>
                Every reference to AI has been completely removed from all user interfaces.
              </div>
            )}
            <div onClick={() => {
              const newVal = !sysConfig?.disableAiVision;
              setSystemConfig({ disableAiVision: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.disableAiVision ? "#FF3B30" : t.primaryLight, cursor: "pointer", marginBottom: 12, marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.disableAiVision ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.disableAiVision ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: sysConfig?.disableAiVision ? "#fff" : t.text }}>
                {sysConfig?.disableAiVision ? "AI Image Analysis: OFF (hidden from all users)" : "AI Image Analysis: ON (users can upload images)"}
              </span>
            </div>
            {sysConfig?.disableAiVision && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#FFE5E5", color: "#FF3B30", fontSize: 12.5, fontWeight: 600 }}>
                Image upload button is hidden in AI chat. Vision analysis is disabled for all users.
              </div>
            )}
            {!sysConfig?.disableAiVision && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#E5F9E7", color: "#28A745", fontSize: 12.5, fontWeight: 600 }}>
                Image upload button is visible in AI chat. Users can upload images for AI analysis.
              </div>
            )}
            <div onClick={() => {
              const newVal = !sysConfig?.allow1on1ExternalSummaries;
              setSystemConfig({ allow1on1ExternalSummaries: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.allow1on1ExternalSummaries ? t.primaryLight : "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.allow1on1ExternalSummaries ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.allow1on1ExternalSummaries ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {sysConfig?.allow1on1ExternalSummaries ? "1-on-1 external summaries: ON" : "1-on-1 external summaries: OFF"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  Allow users to summarize 1-on-1 chat history from the AI assistant. Off by default — group chats are always available.
                </div>
              </div>
            </div>
            <div onClick={() => {
              const newVal = !sysConfig?.tourDisabled;
              setSystemConfig({ tourDisabled: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.tourDisabled ? "#FF3B30" : t.primary, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.tourDisabled ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {sysConfig?.tourDisabled ? "Welcome tour: DISABLED globally" : "Welcome tour: enabled"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  When disabled, new users never see the first-run tour and the "Replay welcome tour" option is hidden from Settings.
                </div>
              </div>
            </div>
            <div onClick={() => {
              const newVal = !sysConfig?.translateDisabled;
              setSystemConfig({ translateDisabled: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.translateDisabled ? "#FF3B30" : t.primary, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.translateDisabled ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {sysConfig?.translateDisabled ? "Message translation: DISABLED" : "Message translation: enabled"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  When disabled, the "Translate" option is hidden from every message menu.
                </div>
              </div>
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideForwardedCount;
              updateGlobalSettings({ hideForwardedCount: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideForwardedCount ? "#FF3B30" : t.primary, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideForwardedCount ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {settings?.hideForwardedCount ? "Forwarded count: HIDDEN" : "Forwarded count: visible"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  When hidden, messages only ever show a plain "Forwarded" badge — never how many times they were forwarded.
                </div>
              </div>
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideDownloadCount;
              updateGlobalSettings({ hideDownloadCount: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideDownloadCount ? "#FF3B30" : t.primary, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideDownloadCount ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {settings?.hideDownloadCount ? "APK download count: HIDDEN" : "APK download count: visible"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  When hidden, the login page stops showing how many times the Android APK was downloaded.
                </div>
              </div>
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideUserStats;
              updateGlobalSettings({ hideUserStats: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideUserStats ? "#FF3B30" : t.primary, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideUserStats ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {settings?.hideUserStats ? "User statistics: HIDDEN" : "User statistics: visible"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  When hidden, the personal statistics section disappears from everyone's Settings. Admins can still see per-user stats.
                </div>
              </div>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: t.text, marginBottom: 8 }}>Groq API Configuration</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              The Groq API key is stored securely in Firestore at <code style={{ background: t.bg, padding: "2px 6px", borderRadius: 4, fontSize: 11.5 }}>config/system.groqApiKey</code>. All AI calls read this key dynamically at runtime.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}` }}>
              <span style={{ fontSize: 13, color: t.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {sysConfig?.groqApiKey ? "••••••••" + sysConfig.groqApiKey.slice(-4) : "No key configured"}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: sysConfig?.groqApiKey ? "#28A745" : "#FF3B30", padding: "3px 8px", borderRadius: 6, background: sysConfig?.groqApiKey ? "#E5F9E7" : "#FFE5E5" }}>
                {sysConfig?.groqApiKey ? "Active" : "Missing"}
              </span>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Trash2 size={18} color="#FF3B30" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Master AI Access Reset</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Irreversible. Revokes AI access from every user account, deletes all pending/approved requests, and forces everyone to re-request access.
            </div>
            <button onClick={resetAllAIAccess} disabled={!!aiResetStatus} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: aiResetStatus ? t.border : "#FF3B30", color: aiResetStatus ? t.textMuted : "#fff", fontWeight: 700, fontSize: 13, cursor: aiResetStatus ? "not-allowed" : "pointer" }}>
              {aiResetStatus || "Reset All AI Access"}
            </button>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <EyeOff size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Tech Stack Visibility</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Hide or show the Developer &amp; AI Tech Stack section in Settings for all users.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideTechStack;
              updateGlobalSettings({ hideTechStack: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideTechStack ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideTechStack ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideTechStack ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideTechStack ? "#fff" : t.text }}>
                {settings?.hideTechStack ? "Tech Stack HIDDEN" : "Tech Stack Visible"}
              </span>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <SlidersHorizontal size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Hide Filter/Sort Buttons</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Hide the filter/sort dropdown buttons in the chat list and contacts screens. Useful if the buttons are unresponsive on some devices.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideFilterButton;
              updateGlobalSettings({ hideFilterButton: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideFilterButton ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideFilterButton ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideFilterButton ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideFilterButton ? "#fff" : t.text }}>
                {settings?.hideFilterButton ? "Filter/Sort HIDDEN" : "Filter/Sort Visible"}
              </span>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Share2 size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Hide Share Statistics Button</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Hide the "Share" button in the personal statistics card in Settings.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideShareButton;
              updateGlobalSettings({ hideShareButton: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideShareButton ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideShareButton ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideShareButton ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideShareButton ? "#fff" : t.text }}>
                {settings?.hideShareButton ? "Share Button HIDDEN" : "Share Button Visible"}
              </span>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Terminal size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Hide On-Device DIAG Log</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Hide the copyable DIAG log overlay that appears on screen (used to diagnose device issues when USB debugging is blocked).
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideDiagLog;
              updateGlobalSettings({ hideDiagLog: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideDiagLog ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideDiagLog ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideDiagLog ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideDiagLog ? "#fff" : t.text }}>
                {settings?.hideDiagLog ? "DIAG Log HIDDEN" : "DIAG Log Visible"}
              </span>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Bot size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>NexText AI Model (Groq)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Switch which Groq model NexText AI uses for chat. Keep the default toggle on to always use the built-in default model; turn it off to pin a specific model below.
            </div>
            <div onClick={() => {
              const newVal = !sysConfig?.useDefaultModel;
              setSystemConfig({ useDefaultModel: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.useDefaultModel !== false ? "#E5F9E7" : t.bg, cursor: "pointer", border: `1px solid ${t.border}` }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.useDefaultModel !== false ? "#28A745" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.useDefaultModel !== false ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                {sysConfig?.useDefaultModel !== false ? "Using default model" : "Using custom model"}
              </span>
            </div>
            {sysConfig?.useDefaultModel === false && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>Pinned Groq model</div>
                <select
                  value={GROQ_MODEL_OPTIONS.some((o) => o.id === sysConfig?.groqModel) ? sysConfig.groqModel : GROQ_MODEL_OPTIONS[0].id}
                  onChange={(e) => setSystemConfig({ groqModel: e.target.value, useDefaultModel: false }, myUid)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, cursor: "pointer" }}
                >
                  {GROQ_MODEL_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6 }}>
                  Active model: <strong>{GROQ_MODEL_OPTIONS.find((o) => o.id === sysConfig?.groqModel)?.label || sysConfig?.groqModel}</strong> — saved instantly on change.
                </div>
              </div>
            )}
            {sysConfig?.useDefaultModel !== false && (
              <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 8 }}>
                Active model: <strong>openai/gpt-oss-20b</strong> (default). Toggle off to pick a custom model.
              </div>
            )}
            <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 12, paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>Model mode (applies to all AI chats instantly)</div>
              <div style={{ display: "flex", gap: 8 }}>
                {AI_MODE_OPTIONS.map((o) => (
                  <div key={o.id} onClick={() => setAiModeDraft(o.id)} style={{ flex: 1, textAlign: "center", padding: "10px 8px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${t.border}`, background: aiModeDraft === o.id ? t.primary : t.bg, color: aiModeDraft === o.id ? "#fff" : t.text }}>
                    {o.label}
                  </div>
                ))}
              </div>
              {aiModeDraft === "live" && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>Live model</div>
                  <select value={aiLiveDraft} onChange={(e) => setAiLiveDraft(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, cursor: "pointer" }}>
                    {GROQ_LIVE_MODEL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              )}
              <button onClick={() => { setSystemConfig({ aiMode: aiModeDraft, aiLiveModel: aiLiveDraft }, myUid); setAiSaved(true); setTimeout(() => setAiSaved(false), 2500); }} style={{ marginTop: 10, width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {aiSaved ? "Saved ✓" : "Save Settings"}
              </button>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <UserMinus size={18} color="#FF9500" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Block All Name Changes</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, no user can change their display name or username. Existing messages keep their old names regardless.
            </div>
            <div onClick={() => {
              const newVal = !settings?.blockNameSwitching;
              updateGlobalSettings({ blockNameSwitching: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.blockNameSwitching ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.blockNameSwitching ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.blockNameSwitching ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.blockNameSwitching ? "#fff" : t.text }}>
                {settings?.blockNameSwitching ? "NAME CHANGES BLOCKED GLOBALLY" : "Name changes allowed"}
              </span>
            </div>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14, border: "1px solid #FF3B30" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Power size={18} color="#FF3B30" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Force Logout Everyone (except admins)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When ON, every non-admin user is signed out of all their devices immediately and must log back in. Use this to force a universal re-auth (e.g. after a breach). Turn it back OFF to let everyone sign in again.
            </div>
            <div onClick={() => {
              const newVal = !settings?.forceLogoutNonAdmins;
              updateGlobalSettings({ forceLogoutNonAdmins: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.forceLogoutNonAdmins ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.forceLogoutNonAdmins ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.forceLogoutNonAdmins ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.forceLogoutNonAdmins ? "#fff" : t.text }}>
                {settings?.forceLogoutNonAdmins ? "FORCE LOGOUT IS LIVE — non-admins are signed out" : "Force logout off"}
              </span>
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Zap size={18} color="#FF9500" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Keep FCM Worker Awake (Pre-warm)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When ON, every app launch / foreground return writes a tiny silent ping to Firestore so the Render FCM worker stays active and keeps delivering notifications. Off by default. The pings send no notifications and are ignored by the worker.
            </div>
            <div onClick={() => {
              const next = !preWarmOn;
              setPreWarmOn(next);
              setPreWarmEnabled(next).catch(() => {});
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: preWarmOn ? "#FF9500" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: preWarmOn ? "#FF9500" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: preWarmOn ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: preWarmOn ? "#fff" : t.text }}>
                {preWarmOn ? "PRE-WARM IS LIVE — worker stays awake" : "Pre-warm off"}
              </span>
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Camera size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Status Builder: Hide Camera</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Hide the Camera button in the status builder for all users. Useful if camera access causes issues on some devices.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideStatusCamera;
              updateGlobalSettings({ hideStatusCamera: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideStatusCamera ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideStatusCamera ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideStatusCamera ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideStatusCamera ? "#fff" : t.text }}>
                {settings?.hideStatusCamera ? "CAMERA HIDDEN IN STATUS BUILDER" : "Camera visible in status builder"}
              </span>
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Mic size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Status Builder: Hide Voice Notes</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Hide the Voice Note button in the status builder for all users. Useful if microphone access causes issues on some devices.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideStatusVoiceNote;
              updateGlobalSettings({ hideStatusVoiceNote: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideStatusVoiceNote ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideStatusVoiceNote ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideStatusVoiceNote ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideStatusVoiceNote ? "#fff" : t.text }}>
                {settings?.hideStatusVoiceNote ? "VOICE NOTES HIDDEN IN STATUS BUILDER" : "Voice notes visible in status builder"}
              </span>
            </div>

            {/* Hide speech-to-text (voice typing) across ALL chats */}
            <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginTop: 14, marginBottom: 4 }}>
              Speech-to-text (voice typing)
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Hide the speech-to-text microphone button and its settings in every chat (direct, group, and AI). When on, users cannot voice-type at all.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideStt;
              updateGlobalSettings({ hideStt: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideStt ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideStt ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideStt ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideStt ? "#fff" : t.text }}>
                {settings?.hideStt ? "SPEECH-TO-TEXT HIDDEN FOR ALL USERS" : "Speech-to-text visible"}
              </span>
            </div>
          </div>

          {/* Hide Login & Security page from Settings for all users */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Lock size={18} color="#FF9500" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Hide Login & Security Page</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, the "Login & Security" section (Change password, Change email) disappears from Settings for all users. Use if you want to force password/email changes through a web portal only.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideLoginSecurity;
              updateGlobalSettings({ hideLoginSecurity: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideLoginSecurity ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideLoginSecurity ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideLoginSecurity ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideLoginSecurity ? "#fff" : t.text }}>
                {settings?.hideLoginSecurity ? "LOGIN & SECURITY HIDDEN FROM SETTINGS" : "Login & Security visible in Settings"}
              </span>
            </div>
          </div>

          {/* Force Login & Security credential forms open */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <KeyRound size={18} color="#FF9500" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Open Credential Forms by Default</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, the Login & Security screen shows the Change password (current + new + confirm) and Change email (email + password) forms immediately — no need to tap the rows first.
            </div>
            <div onClick={() => {
              const newVal = !settings?.forceCredForms;
              updateGlobalSettings({ forceCredForms: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.forceCredForms ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.forceCredForms ? "#34C759" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.forceCredForms ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.forceCredForms ? "#fff" : t.text }}>
                {settings?.forceCredForms ? "CREDENTIAL FORMS OPEN BY DEFAULT" : "Credential forms open on tap"}
              </span>
            </div>
          </div>

          {/* Hide the Login & Security "use the web version" fallback note.
              Hidden by default (toggle ON = hidden) so most users don't see the
              web-fallback hint unless the admin chooses to surface it. */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <KeyRound size={18} color="#FF9500" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Hide Web-Fallback Note</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, the "If these options don't work on your device, use the web version…" note on the Login & Security screen is hidden. Hidden by default.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideLoginSecurityNote;
              updateGlobalSettings({ hideLoginSecurityNote: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideLoginSecurityNote ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideLoginSecurityNote ? "#34C759" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideLoginSecurityNote ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideLoginSecurityNote ? "#fff" : t.text }}>
                {settings?.hideLoginSecurityNote ? "WEB-FALLBACK NOTE HIDDEN" : "Web-fallback note visible"}
              </span>
            </div>
          </div>

          {/* Chat feed virtualization (KEY PERFORMANCE SETTING).
              ON by default: only visible messages render (dynamic row heights,
              scroll anchoring on load-earlier, stick-to-bottom on new messages). */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Zap size={18} color="#FF9500" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Chat Feed Virtualization</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Renders only the visible portion of a chat (dynamic row heights, scroll anchoring when loading earlier messages, and stick-to-bottom on new messages). Improves performance in long chats. ON by default.
            </div>
            <div onClick={() => {
              const on = settings?.enableChatVirtualization !== false;
              const newVal = !on;
              updateGlobalSettings({ enableChatVirtualization: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: (settings?.enableChatVirtualization !== false) ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: (settings?.enableChatVirtualization !== false) ? "#34C759" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: (settings?.enableChatVirtualization !== false) ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: (settings?.enableChatVirtualization !== false) ? "#fff" : t.text }}>
                {(settings?.enableChatVirtualization !== false) ? "CHAT VIRTUALIZATION ON (recommended)" : "Chat virtualization off"}
              </span>
            </div>
          </div>

          {/* App version override (admin can pin a version number to block updates) */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Compass size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Hide Launch Page Setting</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, the "Launch page" setting is hidden from Settings for all users. The app will always open on the Groups tab.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideLaunchPage;
              updateGlobalSettings({ hideLaunchPage: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideLaunchPage ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideLaunchPage ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideLaunchPage ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideLaunchPage ? "#fff" : t.text }}>
                {settings?.hideLaunchPage ? "LAUNCH PAGE SETTING HIDDEN" : "Launch page setting visible"}
              </span>
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <FileText size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Force Notepad Disguise</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, every user's app opens into the Notes disguise (regardless of their launcher icon). Type the unlock code below in a note to reveal the real app.
            </div>
            <div onClick={() => {
              const newVal = !settings?.forceNotepadDisguise;
              updateGlobalSettings({ forceNotepadDisguise: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.forceNotepadDisguise ? "#FF3B30" : t.primaryLight, cursor: "pointer", marginBottom: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.forceNotepadDisguise ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.forceNotepadDisguise ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.forceNotepadDisguise ? "#fff" : t.text }}>
                {settings?.forceNotepadDisguise ? "NOTEPAD DISGUISE FORCED ON" : "Notepad disguise off"}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 6 }}>Unlock code (case-insensitive whole word)</div>
            <input
              value={settings?.notepadDisguiseKeyword || "Rosh"}
              onChange={(e) => updateGlobalSettings({ notepadDisguiseKeyword: e.target.value }, myUid)}
              placeholder="Rosh"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, fontWeight: 600 }}
            />
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Tag size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>App Version Override</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Pin a specific version string (e.g. "1.6.47"). When set, the app will report this version and skip update checks. Clear to re-enable normal version reporting.
            </div>
            <div style={{ marginBottom: 10 }}>
              <input
                value={sysConfig?.appVersionOverride || ""}
                onChange={(e) => setSystemConfig({ appVersionOverride: e.target.value || null }, myUid)}
                placeholder="e.g. 1.6.47"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, cursor: "pointer" }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted }}>
              Current override: <strong>{sysConfig?.appVersionOverride || "None (using package.json version)"}</strong>
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Megaphone size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Announcements</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Write a post that every user sees in Settings → Announcements. Toggle below to hide the Announcements section from users.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideAnnouncements;
              updateGlobalSettings({ hideAnnouncements: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideAnnouncements ? "#FF3B30" : t.primaryLight, cursor: "pointer", marginBottom: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideAnnouncements ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideAnnouncements ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideAnnouncements ? "#fff" : t.text }}>
                {settings?.hideAnnouncements ? "ANNOUNCEMENTS HIDDEN FROM USERS" : "Announcements visible to users"}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 6 }}>Title</div>
            <input
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              placeholder="e.g. Scheduled maintenance"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, fontWeight: 600, marginBottom: 10 }}
            />
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 6 }}>Message</div>
            <textarea
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
              placeholder="Write your announcement…"
              rows={3}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, resize: "vertical", marginBottom: 10 }}
            />
            <button
              onClick={handlePostAnnouncement}
              disabled={!annTitle.trim() || !annBody.trim() || postingAnn}
              style={{ width: "100%", padding: "11px 16px", border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: (!annTitle.trim() || !annBody.trim() || postingAnn) ? "wait" : "pointer", opacity: (!annTitle.trim() || !annBody.trim()) ? 0.5 : 1, borderRadius: 10 }}
            >
              {postingAnn ? "Posting…" : "Post Announcement"}
            </button>
            {(settings?.announcements || []).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted, marginBottom: 8 }}>Published ({settings.announcements.length})</div>
                {(settings.announcements || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((a) => (
                  <div key={a.id} style={{ background: t.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 8, border: `1px solid ${t.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: t.text, flex: 1 }}>{a.title}</span>
                      <span onClick={() => handleDeleteAnnouncement(a.id)} style={{ fontSize: 12, color: "#FF3B30", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Delete</span>
                    </div>
                    <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, whiteSpace: "pre-wrap" }}>{a.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Web fallback URL for Change password/email */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Globe size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Web Fallback URL (Change password/email)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              URL shown to users when the in-app Change password/email flow fails. Use a full URL including https://
            </div>
            <div style={{ marginBottom: 10 }}>
              <input
                value={sysConfig?.webFallbackUrl || "https://nextext.pages.dev"}
                onChange={(e) => setSystemConfig({ webFallbackUrl: e.target.value || "https://nextext.pages.dev" }, myUid)}
                placeholder="https://example.com"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, cursor: "pointer" }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted }}>
              Current: <strong>{sysConfig?.webFallbackUrl || "https://nextext.pages.dev"}</strong>
            </div>
          </div>

          {/* Hide Ask AI button globally */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Bot size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Hide "Ask AI" Button Everywhere</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When enabled, the "Ask AI about this" option is removed from message menus, long-press menus, and the Ask AI panel cannot be opened by any user.
            </div>
            <div onClick={() => {
              const newVal = !settings?.hideAskAI;
              updateGlobalSettings({ hideAskAI: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideAskAI ? "#FF3B30" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideAskAI ? "#FF3B30" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideAskAI ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideAskAI ? "#fff" : t.text }}>
                {settings?.hideAskAI ? "\"ASK AI\" HIDDEN EVERYWHERE" : "\"Ask AI\" visible"}
              </span>
            </div>
          </div>

        </div>
      )}

      {tab === "ai" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Bot size={18} color={t.primary} />
            <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>AI Access Requests</span>
          </div>
          {aiRequests.filter((r) => r.status === "pending").length > 0 && (
            <button onClick={() => approveAllAIRequests(myUid)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
              Approve All ({aiRequests.filter((r) => r.status === "pending").length})
            </button>
          )}
          {aiRequests.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 30 }}>No AI access requests yet.</div>}
          {aiRequests.map((r) => (
            <div key={r.id} style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: t.primary }}>{r.username?.[0]?.toUpperCase() || "?"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>@{r.username}</div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>{r.requestedAt?.toDate ? r.requestedAt.toDate().toLocaleString() : ""}</div>
                </div>
                <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, fontWeight: 700, background: r.status === "approved" ? "#E5F9E7" : r.status === "pending" ? "#FFF3CD" : "#FFE5E5", color: r.status === "approved" ? "#28A745" : r.status === "pending" ? "#856404" : "#FF3B30" }}>{r.status}</span>
              </div>
              {r.status === "pending" && (
                <button onClick={() => approveAIRequest(r.id, myUid)} style={{ width: "100%", padding: 9, borderRadius: 8, border: "none", background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <UserPlus size={14} /> Approve Account
                </button>
              )}
              {r.status === "approved" && (
                <div style={{ fontSize: 12, color: "#28A745", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle size={14} /> Approved {r.approvedBy ? `by admin` : ""}
                </div>
              )}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 }}>
            <Users size={18} color={t.primary} />
            <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>Group AI Injection Requests</span>
          </div>
          {groupAIRequests.filter((r) => r.status === "pending").length === 0 && (
            <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No group AI injection requests yet.</div>
          )}
          {groupAIRequests.filter((r) => r.status === "pending").map((r) => (
            <div key={r.id} style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Users size={16} color={t.primary} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{r.chatName || "Unnamed Group"}</div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>requested by {r.requestedByName} · {r.requestedAt?.toDate ? r.requestedAt.toDate().toLocaleString() : ""}</div>
                </div>
                <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, fontWeight: 700, background: "#FFF3CD", color: "#856404" }}>pending</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => approveGroupAIRequest(r, myUid)} style={{ flex: 1, padding: 9, borderRadius: 8, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <CheckCircle size={14} /> Approve &amp; Inject
                </button>
                <button onClick={() => rejectGroupAIRequest(r, myUid)} style={{ flex: 1, padding: 9, borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: "#FF3B30", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
