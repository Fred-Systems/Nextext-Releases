import React, { useState, useEffect, useRef, useMemo } from "react";
import { ChevronLeft, ShieldCheck, Search, Megaphone, Trash2, Send, Users, Bot, Power, CheckCircle, Check, UserPlus, EyeOff, UserMinus, SlidersHorizontal, Share2, Terminal, Camera, Mic, Zap, Lock, Tag, Globe, Compass, FileText, KeyRound, ImageIcon, RefreshCw, Video, Radio, Volume2 } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { collection, query, where, getDocs, limit as fbLimit, doc, updateDoc, onSnapshot, addDoc, serverTimestamp, deleteDoc, orderBy, getDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase/config";
import { AI_CONTACT_UID, PERSONALITIES } from "../firebase/ai";
import { setFishAudioKey, getFishAudioKey, getAvailableVoices } from "../firebase/tts";
import { getOrCreateDirectChat } from "../firebase/chats";
import { ensureGlobalSettingsExist, useGlobalSettings, updateGlobalSettings, setAnnouncement, clearAnnouncement, setPersona, deletePersona } from "../firebase/config-settings";
import { getPreWarmConfig, setPreWarmEnabled } from "../firebase/prewarm";
import { getUserMessageStats, formatActiveTime, formatBytes } from "../firebase/stats";
import { ensureSystemConfig, useSystemConfigHook, setSystemConfig, useAIRequestsHook, approveAIRequest, approveAllAIRequests, GROQ_MODEL_OPTIONS, GROQ_LIVE_MODEL_OPTIONS, AI_MODE_OPTIONS, useGroupAIRequestsHook, approveGroupAIRequest, rejectGroupAIRequest, GEMINI_MODELS, DEFAULT_GEMINI_MODEL, AI_PERSONA_TRAY } from "../firebase/ai";
import { getActiveStorageProviderFromDb, setActiveStorageProviderDb, getSystemSetting, writeSystemSetting } from "../firebase/systemSettings";
import { invalidateStorageProviderCache } from "../services/mediaUpload";
import { setAdminPanelPinHash, verifyAdminPanelPin } from "../firebase/adminPanelPin";
import { supabase, MEDIA_BUCKET } from "../supabase/config";

// Categories used by the admin "Jewish Statuses" controls (mirror of App.jsx).
const JEWISH_CATEGORIES = ["music", "news", "entertainment", "business", "community", "events", "influencers", "organizations", "other"];

// Recursively sum file sizes within the Supabase media bucket. Best-effort:
// anonymous keys are usually blocked by RLS from listing, in which case we report
// a clear message rather than fake numbers.
async function listStorageVolume(prefix) {
  const out = { bytes: 0, count: 0 };
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(prefix || "", { limit: 1000 });
  if (error) throw error;
  for (const item of data || []) {
    if (item.name === ".emptyFolderPlaceholder") continue;
    if (item.metadata && item.metadata.size != null) {
      out.bytes += item.metadata.size;
      out.count += 1;
    } else if (item.id) {
      // Likely a "folder" prefix — recurse.
      const sub = await listStorageVolume(prefix ? `${prefix}/${item.name}` : item.name);
      out.bytes += sub.bytes;
      out.count += sub.count;
    }
  }
  return out;
}

function AnalyticsCard({ title, children }) {
  const { t } = useTheme();
  return (
    <div style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  const { t } = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${t.border}` }}>
      <span style={{ fontSize: 12.5, color: t.textMuted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{value}</span>
    </div>
  );
}

function AnalyticsTab() {
  const { t } = useTheme();
  const settings = useGlobalSettings();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        // ── Real Firestore document counts (no mock data) ──
        // Each collection is fetched independently so a single RLS-denied
        // collection surfaces as a note instead of breaking the whole tab.
        const fetchCount = async (name) => {
          try { return (await getDocs(collection(db, name))).size; } catch { return null; }
        };
        const [users, chats, status, reports, feedback, broadcasts] = await Promise.all([
          fetchCount("users"),
          fetchCount("chats"),
          fetchCount("status"),
          fetchCount("reports"),
          fetchCount("feedback"),
          fetchCount("broadcastLists"),
        ]);
        // ── Real Supabase storage volume (best-effort) ──
        let storageBytes = 0;
        let mediaFiles = 0;
        let storageNote = "";
        try {
          const vol = await listStorageVolume("");
          storageBytes = vol.bytes;
          mediaFiles = vol.count;
        } catch {
          storageNote = "Supabase storage listing is blocked by RLS for the anonymous key. Grant list access or read exact volume via a backend.";
        }
        if (!active) return;
        setData({
          users, chats, status, reports, feedback, broadcasts,
          storageBytes,
          mediaFiles,
          storageNote,
          proxyEnabled: settings?.cloudinaryProxyEnabled === true,
        });
      } catch (e) {
        setErr("Failed to load analytics: " + (e.message || e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [settings?.cloudinaryProxyEnabled]);

  if (loading) return <div style={{ color: t.textMuted, fontSize: 13, padding: 24, textAlign: "center" }}>Loading live metrics…</div>;
  if (err) return <div style={{ color: "#FF3B30", fontSize: 13, padding: 24 }}>{err}</div>;
  if (!data) return null;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Live, client-fetched metrics. Cloudinary Admin API and Firebase Monitoring require a secret-holding backend (not available on the free Spark plan), so those are shown as estimates derived from real Supabase/Firestore data.
      </div>

      <AnalyticsCard title="Supabase Media Storage (real)">
        <Stat label="Total media files" value={data.mediaFiles.toLocaleString()} />
        <Stat label="Storage volume" value={formatBytes(data.storageBytes)} />
        {data.storageNote ? <div style={{ fontSize: 11, color: "#FF9500", marginTop: 8, lineHeight: 1.5 }}>{data.storageNote}</div> : null}
      </AnalyticsCard>

      <AnalyticsCard title="Cloudinary Proxy (estimated)">
        <Stat label="Status" value={data.proxyEnabled ? "Enabled" : "Disabled"} />
        {data.proxyEnabled ? (
          <>
            <Stat label="Est. transformations" value={data.mediaFiles.toLocaleString()} />
            <Stat label="Est. bandwidth served" value={formatBytes(data.storageBytes)} />
          </>
        ) : (
          <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4, lineHeight: 1.5 }}>
            Enable "Cloudinary Media Optimization Proxy" in the Users tab to serve media through Cloudinary's CDN. Exact usage (via the Admin API) needs a backend.
          </div>
        )}
      </AnalyticsCard>

      <AnalyticsCard title="Firebase / Firestore (real counts)">
        <Stat label="Registered users" value={data.users != null ? data.users.toLocaleString() : "— (no access)"} />
        <Stat label="Chats" value={data.chats != null ? data.chats.toLocaleString() : "— (no access)"} />
        <Stat label="Status posts" value={data.status != null ? data.status.toLocaleString() : "— (no access)"} />
        <Stat label="Broadcast lists" value={data.broadcasts != null ? data.broadcasts.toLocaleString() : "— (no access)"} />
        <Stat label="Reports" value={data.reports != null ? data.reports.toLocaleString() : "— (no access)"} />
        <Stat label="Feedback items" value={data.feedback != null ? data.feedback.toLocaleString() : "— (no access)"} />
        <div style={{ fontSize: 11, color: t.textMuted, marginTop: 8, lineHeight: 1.5 }}>
          Exact read/write operation billing requires Firebase Monitoring API (backend). These counts are real document totals.
        </div>
      </AnalyticsCard>
    </div>
  );
}

export default function AdminDashboard({ myUid, onBack }) {
  const { t } = useTheme();
  const settings = useGlobalSettings();
  const sysConfig = useSystemConfigHook();
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
  const [directorySearch, setDirectorySearch] = useState("");
  const [activeProvider, setActiveProvider] = useState("supabase");
  const [providerInput, setProviderInput] = useState("");
  useEffect(() => {
    let alive = true;
    getActiveStorageProviderFromDb().then((p) => { if (alive) setActiveProvider(p === "cloudinary" ? "cloudinary" : "supabase"); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const toggleStorageProvider = async () => {
    if (providerInput.trim().toLowerCase() !== "change") { setError("Type the word 'change' to switch providers."); return; }
    setError("");
    try {
      const next = activeProvider === "cloudinary" ? "supabase" : "cloudinary";
      await setActiveStorageProviderDb(next, myUid);
      setActiveProvider(next);
      setProviderInput("");
    } catch (e) {
      setError("Couldn't switch provider: " + e.message);
    }
  };
  const [fishKey, setFishKey] = useState("");
  const [fishKeySaved, setFishKeySaved] = useState(false);
  const [mediaLimitMB, setMediaLimitMB] = useState("0");
  const [statusLimit, setStatusLimit] = useState("0");
  const [customVoiceName, setCustomVoiceName] = useState("");
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [limitsSaved, setLimitsSaved] = useState(false);

  useEffect(() => {
    getFishAudioKey().then((k) => { if (k) setFishKey(k); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (sysConfig) {
      setMediaLimitMB(sysConfig.dailyMediaLimitMB != null ? String(sysConfig.dailyMediaLimitMB) : "0");
      setStatusLimit(sysConfig.dailyStatusLimit != null ? String(sysConfig.dailyStatusLimit) : "0");
    }
  }, [sysConfig]);

  // Smart filter across display name, @username, email, and phone number.
  const filteredDirectory = useMemo(() => {
    const q = directorySearch.trim().toLowerCase().replace(/^@/, "");
    if (!q) return allUsers;
    return allUsers.filter((u) => {
      const name = (u.displayName || "").toLowerCase();
      const username = (u.username || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const phone = (u.phoneNumber || u.phoneNumberNormalized || "").replace(/[^\d]/g, "");
      const qPhone = q.replace(/[^\d]/g, "");
      return (
        name.includes(q) ||
        username.includes(q) ||
        email.includes(q) ||
        (qPhone.length >= 3 && phone.includes(qPhone))
      );
    });
  }, [allUsers, directorySearch]);
  const [expiryInput, setExpiryInput] = useState("");
  const [expiryNever, setExpiryNever] = useState(false);
  const [allGroups, setAllGroups] = useState([]);
  const [allGroupsLoading, setAllGroupsLoading] = useState(false);
  const [pendingSamples, setPendingSamples] = useState([]);
  const [creatorInput, setCreatorInput] = useState("");
  const [splashLine1, setSplashLine1] = useState(settings?.specialIconSplashLine1 ?? "If you will not use this app....");
  const [splashLine2, setSplashLine2] = useState(settings?.specialIconSplashLine2 ?? "You will go to .....");
  const [splashSaved, setSplashSaved] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMemberNames, setGroupMemberNames] = useState({});
  const [groupActionStatus, setGroupActionStatus] = useState("");
  const [groupAIName, setGroupAIName] = useState("NexText AI");
  const [groupAIPersonality, setGroupAIPersonality] = useState("default");
  const [preWarmOn, setPreWarmOn] = useState(false);
  useEffect(() => {
    getPreWarmConfig().then((c) => setPreWarmOn(!!c.preWarmEnabled)).catch(() => {});
  }, []);
  const [aiModeDraft, setAiModeDraft] = useState(sysConfig?.aiMode || "old");
  const [aiLiveDraft, setAiLiveDraft] = useState(sysConfig?.aiLiveModel || "groq/compound");
  const [aiSaved, setAiSaved] = useState(false);
  const [voiceProfilesDraft, setVoiceProfilesDraft] = useState(sysConfig?.voiceProfiles || {});
  const [voiceProfilesSaved, setVoiceProfilesSaved] = useState(false);
  useEffect(() => {
    if (sysConfig?.voiceProfiles != null) setVoiceProfilesDraft(sysConfig.voiceProfiles);
  }, [sysConfig?.voiceProfiles]);
  const allVoices = getAvailableVoices(sysConfig);
  // ── Announcements + custom AI personas (admin) ──
  const [annText, setAnnText] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [personaIcon, setPersonaIcon] = useState("");
  const [personaDesc, setPersonaDesc] = useState("");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [personaSpeak, setPersonaSpeak] = useState("");
  const [personaVoice, setPersonaVoice] = useState("");
  const [editingPersonaKey, setEditingPersonaKey] = useState(null);
  const customPersonas = settings?.personas || [];
  const savePersona = async () => {
    const name = personaName.trim();
    if (!name) return;
    const key = editingPersonaKey || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    await setPersona({ key, name, icon: personaIcon.trim() || "🧠", description: personaDesc.trim(), systemPrompt: personaPrompt.trim(), speakStyle: personaSpeak.trim(), voiceRef: personaVoice.trim() || undefined });
    setPersonaName(""); setPersonaIcon(""); setPersonaDesc(""); setPersonaPrompt(""); setPersonaSpeak(""); setPersonaVoice(""); setEditingPersonaKey(null);
  };
  const editPersona = (p) => {
    setEditingPersonaKey(p.key); setPersonaName(p.name); setPersonaIcon(p.icon || ""); setPersonaDesc(p.description || ""); setPersonaPrompt(p.systemPrompt || ""); setPersonaSpeak(p.speakStyle || ""); setPersonaVoice(p.voiceRef || "");
  };
  const postAnnouncement = async () => { await setAnnouncement(annText, myUid); setAnnText(""); };
  const [geminiKeyDraft, setGeminiKeyDraft] = useState(sysConfig?.geminiApiKey || "");
  useEffect(() => {
    if (sysConfig?.geminiApiKey != null) setGeminiKeyDraft(sysConfig.geminiApiKey);
  }, [sysConfig?.geminiApiKey]);
  const [storageProvider, setStorageProvider] = useState("supabase");
  const [storageProviderBusy, setStorageProviderBusy] = useState(false);
  const [storageProviderError, setStorageProviderError] = useState("");
  useEffect(() => {
    getActiveStorageProviderFromDb().then(setStorageProvider).catch(() => {});
  }, []);
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
  const emptyDbConfirmRef = useRef(null);
  const [emptyDbLoading, setEmptyDbLoading] = useState(false);
  const [emptyDbResult, setEmptyDbResult] = useState(null);

  useEffect(() => { ensureGlobalSettingsExist(); ensureSystemConfig(); }, []);

  const handleEmptyDatabase = async () => {
    const confirmText = emptyDbConfirmRef.current?.value || "";
    if (confirmText !== "DELETE EVERYTHING") {
      setEmptyDbResult({ success: false, message: "Confirmation text does not match. Type exactly: DELETE EVERYTHING" });
      return;
    }
    setEmptyDbLoading(true);
    setEmptyDbResult(null);
    try {
      // Delete all user documents (except admins)
      const usersSnap = await getDocs(collection(db, "users"));
      const batch = writeBatch(db);
      let deletedCount = 0;
      for (const docSnap of usersSnap.docs) {
        const userData = docSnap.data();
        if (userData.role === "admin") continue;
        batch.delete(docSnap.ref);
        deletedCount++;
      }
      await batch.commit();

      // Delete all chats and messages
      const chatsSnap = await getDocs(collection(db, "chats"));
      const chatBatch = writeBatch(db);
      let chatDeleted = 0;
      for (const chatSnap of chatsSnap.docs) {
        // Delete messages subcollection
        const msgsSnap = await getDocs(collection(db, "chats", chatSnap.id, "messages"));
        for (const msgSnap of msgsSnap.docs) {
          chatBatch.delete(msgSnap.ref);
        }
        chatBatch.delete(chatSnap.ref);
        chatDeleted++;
      }
      await chatBatch.commit();

      // Delete other collections
      const collectionsToDelete = [
        "status", "reports", "feedback", "systemMessages", "broadcastLists",
        "messageLimits", "aiRequests", "groupAIRequests"
      ];
      for (const collName of collectionsToDelete) {
        const collSnap = await getDocs(collection(db, collName));
        const cBatch = writeBatch(db);
        for (const docSnap of collSnap.docs) {
          cBatch.delete(docSnap.ref);
        }
        await cBatch.commit();
      }

      // Note: Supabase storage files are not deleted here (would need server-side function)
      // The app will no longer reference them after the Firestore data is gone.

      setEmptyDbResult({ success: true, message: `Database emptied. Deleted ${deletedCount} non-admin users, ${chatDeleted} chats, and all related data. Supabase storage files still exist but are no longer referenced.` });
    } catch (err) {
      console.error("Empty database error:", err);
      setEmptyDbResult({ success: false, message: `Error: ${err.message}` });
    } finally {
      setEmptyDbLoading(false);
    }
  };

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

  useEffect(() => {
    if (tab !== "voices") return;
    setPendingSamples([]);
    const q = query(collection(db, "voiceSamples"), where("status", "==", "pending"));
    const unsub = onSnapshot(q, (snap) => {
      setPendingSamples(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => setPendingSamples([]));
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

  // ── Voice sample review (admin) ──
  const deleteVoiceSample = async (s) => {
    setError("");
    try {
      if (s.storagePath) {
        await supabase.storage.from(MEDIA_BUCKET).remove([s.storagePath]);
      }
      await deleteDoc(doc(db, "voiceSamples", s.id));
    } catch (e) {
      setError("Couldn't delete voice sample: " + e.message);
    }
  };
  const approveVoiceSample = async (s) => {
    setError("");
    try {
      await updateDoc(doc(db, "voiceSamples", s.id), { status: "approved" });
    } catch (e) {
      setError("Couldn't approve voice sample: " + e.message);
    }
  };

  // ── Jewish Statuses admin config (lives under globalSettings.jewishStatuses) ──
  const [pinInput, setPinInput] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [builderConfirm, setBuilderConfirm] = useState(null);
  const updateJewish = (patch) => {
    const cur = settings?.jewishStatuses || {};
    updateGlobalSettings({ jewishStatuses: { ...cur, ...patch } }, myUid);
  };
  const toggleJewishSource = (key) => {
    const cur = settings?.jewishStatuses?.sources || {};
    const src = cur[key] || {};
    updateJewish({ sources: { ...cur, [key]: { ...src, enabled: !(src.enabled === true) } } });
  };
  const toggleJewishCategory = (cat) => {
    const cur = settings?.jewishStatuses?.categories || {};
    updateJewish({ categories: { ...cur, [cat]: !(cur[cat] === true) } });
  };
  const addBlockedCreator = () => {
    const v = creatorInput.trim();
    if (!v) return;
    const list = settings?.jewishStatuses?.blockedCreators || [];
    if (list.includes(v)) { setCreatorInput(""); return; }
    updateJewish({ blockedCreators: [...list, v] });
    setCreatorInput("");
  };
  const removeBlockedCreator = (c) => {
    const list = settings?.jewishStatuses?.blockedCreators || [];
    updateJewish({ blockedCreators: list.filter((x) => x !== c) });
  };

  // ── Music admin config (lives under globalSettings.music) ──
  const [whitelistType, setWhitelistType] = useState("artist");
  const [whitelistValue, setWhitelistValue] = useState("");
  const updateMusic = (patch) => {
    updateGlobalSettings({ music: { ...(settings?.music || {}), ...patch } }, myUid);
  };
  const musicProvider = settings?.music?.provider || "apple";
  const setMusicProvider = (p) => updateMusic({ provider: p });
  const allowUserChoice = settings?.music?.allowUserProviderChoice === true;
  const appleEnabled = settings?.music?.providers?.apple?.enabled !== false;
  const toggleAppleEnabled = () =>
    updateMusic({ providers: { ...(settings?.music?.providers || {}), apple: { ...(settings?.music?.providers?.apple || {}), enabled: !appleEnabled } } });
  const appleWhitelist = settings?.music?.apple?.whitelist || { mode: "all", rules: [] };
  const updateAppleWhitelist = (wl) => updateMusic({ apple: { ...(settings?.music?.apple || {}), whitelist: wl } });
  const toggleAppleWhitelistMode = () =>
    updateAppleWhitelist({ ...appleWhitelist, mode: appleWhitelist.mode === "whitelist" ? "all" : "whitelist" });
  const addWhitelistRule = () => {
    const v = whitelistValue.trim();
    if (!v) return;
    const rule = { id: `rule_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, type: whitelistType, value: v, enabled: true };
    updateAppleWhitelist({ ...appleWhitelist, rules: [...(appleWhitelist.rules || []), rule] });
    setWhitelistValue("");
  };
  const toggleWhitelistRule = (id) => {
    const rules = (appleWhitelist.rules || []).map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    updateAppleWhitelist({ ...appleWhitelist, rules });
  };
  const deleteWhitelistRule = (id) => {
    const rules = (appleWhitelist.rules || []).filter((r) => r.id !== id);
    updateAppleWhitelist({ ...appleWhitelist, rules });
  };
  const downloadsEnabled = settings?.music?.downloads?.enabled === true;
  const toggleDownloads = () =>
    updateMusic({ downloads: { ...(settings?.music?.downloads || {}), enabled: !downloadsEnabled } });

  const [aiResetStatus, setAiResetStatus] = useState("");

  const toggleUserAIAccess = async (uid, currentVal) => {
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), { aiApproved: !currentVal });
    } catch (e) {
      setError("Couldn't update AI access: " + e.message);
    }
  };

  // Per-user "AI voice note conversion" grant. Lets a specific user (e.g. one
  // without general AI access) still use the AI formatting / Y Mizrachi voice
  // note features, enabled by an admin from the directory.
  const toggleUserAiVoiceNote = async (uid, currentVal) => {
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), { aiVoiceNoteEnabled: !currentVal });
    } catch (e) {
      setError("Couldn't update voice-note access: " + e.message);
    }
  };

  // Per-user AI feature grants for podcast + voice replies (off by default; admin
  // opts specific users in). Stored under users/{uid}.aiFeatures.
  const toggleUserAiFeature = async (uid, field, currentVal) => {
    setError("");
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const cur = snap.data()?.aiFeatures || {};
      await updateDoc(doc(db, "users", uid), { aiFeatures: { ...cur, [field]: !currentVal } });
    } catch (e) {
      setError("Couldn't update AI feature access: " + e.message);
    }
  };
  const setUserDailyLimit = async (uid, field, value) => {
    setError("");
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const cur = snap.data()?.aiLimits || {};
      await updateDoc(doc(db, "users", uid), { aiLimits: { ...cur, [field]: Math.max(0, parseInt(value || "0", 10) || 0) } });
    } catch (e) {
      setError("Couldn't set daily limit: " + e.message);
    }
  };

  const resetSingleAIAccess = async (uid) => {
    if (!window.confirm(`Reset AI for this user? This will revoke AI access, delete their AI chat(s), and clear pending requests. The user will need to re-request access.`)) return;
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), { aiApproved: false });
      // Delete both possible AI chat docs: the canonical ai_ prefix and the legacy sorted-uid join.
      const primaryChatId = `ai_${uid}`;
      const legacyChatId = [uid, AI_CONTACT_UID].sort().join("_");
      for (const cid of [primaryChatId, legacyChatId]) {
        try {
          const cRef = doc(db, "chats", cid);
          const snap = await getDoc(cRef);
          if (snap.exists()) {
            // Delete messages subcollection first (best-effort, then the chat doc)
            const msgsSnap = await getDocs(collection(db, "chats", cid, "messages"));
            await Promise.all(msgsSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
            await deleteDoc(cRef).catch(() => {});
          }
        } catch {}
      }
      // Remove any pending AI request doc for this user (aiRequests are keyed by uid or doc id)
      try {
        const reqSnap = await getDocs(query(collection(db, "aiRequests"), where("uid", "==", uid)));
        await Promise.all(reqSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
        const directReq = doc(db, "aiRequests", uid);
        const directSnap = await getDoc(directReq);
        if (directSnap.exists()) await deleteDoc(directReq).catch(() => {});
      } catch {}
      setSelectedUser((prev) => (prev && prev.uid === uid ? { ...prev, aiApproved: false } : prev));
    } catch (e) {
      setError("Reset failed: " + e.message);
    }
  };

  const toggleUserVerified = async (uid, currentVal) => {
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), { verified: !currentVal });
    } catch (e) {
      setError("Couldn't update verified status: " + e.message);
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

  // Reset a user's profile cover, display name, and email (keeps the account &
  // auth intact). The app reads displayName/username/email/photoURL/coverURL from
  // the Firestore user doc, so clearing those fields drops them back to defaults.
  const resetUserProfile = async (uid) => {
    if (!window.confirm("Reset this user's cover photo, display name, and email? Their account stays active but profile info is cleared. They can set it again.")) return;
    setError("");
    try {
      await updateDoc(doc(db, "users", uid), {
        coverURL: null,
        photoURL: null,
        displayName: null,
        username: null,
        email: null,
      });
      setAllUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, coverURL: null, photoURL: null, displayName: null, username: null, email: null } : u)));
    } catch (e) {
      setError("Couldn't reset profile: " + e.message);
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
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Jewish Statuses</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Control this user's access to the Jewish status feed. "Follow global" uses the admin setting above; the other options force it on or off for this account only.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["inherit", "Follow global"], ["enabled", "Enabled"], ["disabled", "Disabled"]].map(([val, label]) => {
                const cur = selectedUser.jewishStatusesOverride || "inherit";
                const active = cur === val;
                return (
                  <div
                    key={val}
                    onClick={() => {
                      setError("");
                      try {
                        updateDoc(doc(db, "users", selectedUser.uid), { jewishStatusesOverride: val });
                        setSelectedUser((prev) => ({ ...prev, jewishStatusesOverride: val }));
                      } catch (e) {
                        setError("Couldn't update override: " + e.message);
                      }
                    }}
                    style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: active ? t.primary : t.bg, color: active ? t.bubbleMeText : t.text, border: `1px solid ${active ? t.primary : t.border}` }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Jewish Status Downloads</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Control this user's ability to download Jewish status media to their device. "Follow global" uses the global download setting (OFF by default); the other options force it on or off for this account only.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["inherit", "INHERIT"], ["enabled", "ENABLED"], ["disabled", "DISABLED"]].map(([val, label]) => {
                const cur = selectedUser.jewishStatusDownloadsOverride || "inherit";
                const active = cur === val;
                return (
                  <div
                    key={val}
                    onClick={() => {
                      setError("");
                      try {
                        updateDoc(doc(db, "users", selectedUser.uid), { jewishStatusDownloadsOverride: val });
                        setSelectedUser((prev) => ({ ...prev, jewishStatusDownloadsOverride: val }));
                      } catch (e) {
                        setError("Couldn't update override: " + e.message);
                      }
                    }}
                    style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: active ? t.primary : t.bg, color: active ? t.bubbleMeText : t.text, border: `1px solid ${active ? t.primary : t.border}` }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Apple Music Access</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Per-user Apple Music access. "Inherit" follows the global setting above; the other options force it on or off for this account only.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["inherit", "Inherit"], ["enabled", "Enabled"], ["disabled", "Disabled"]].map(([val, label]) => {
                const cur = selectedUser.musicAccess?.apple || "inherit";
                const active = cur === val;
                return (
                  <div
                    key={val}
                    onClick={() => {
                      setError("");
                      try {
                        updateDoc(doc(db, "users", selectedUser.uid), { "musicAccess.apple": val });
                        setSelectedUser((prev) => ({ ...prev, musicAccess: { ...(prev?.musicAccess || {}), apple: val } }));
                      } catch (e) {
                        setError("Couldn't update Apple Music access: " + e.message);
                      }
                    }}
                    style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: active ? t.primary : t.bg, color: active ? t.bubbleMeText : t.text, border: `1px solid ${active ? t.primary : t.border}` }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Background Music Downloads</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Control this user's ability to download music previews from the status composer. "Follow global" uses the admin setting above; the other options force it on or off for this account only.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["inherit", "Follow global"], ["enabled", "Enabled"], ["disabled", "Disabled"]].map(([val, label]) => {
                const cur = selectedUser.musicDownloadsOverride || "inherit";
                const active = cur === val;
                return (
                  <div
                    key={val}
                    onClick={() => {
                      setError("");
                      try {
                        updateDoc(doc(db, "users", selectedUser.uid), { musicDownloadsOverride: val });
                        setSelectedUser((prev) => ({ ...prev, musicDownloadsOverride: val }));
                      } catch (e) {
                        setError("Couldn't update override: " + e.message);
                      }
                    }}
                    style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: active ? t.primary : t.bg, color: active ? t.bubbleMeText : t.text, border: `1px solid ${active ? t.primary : t.border}` }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 46, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <ShieldCheck size={18} color={t.text} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>Admin Dashboard</span>
      </div>
      <div style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${t.border}`, flexShrink: 0, WebkitOverflowScrolling: "touch" }}>
        {[["users", "Users"], ["directory", "Directory"], ["groups", "Groups"], ["voices", "Voice Samples"], ["jewish", "Jewish Statuses"], ["analytics", "Analytics"], ["reports", "Reports"], ["feedback", "Feedback"], ["broadcast", "Broadcast"], ["system", "System"], ["ai", "AI"]].map(([key, label]) => (
          <div key={key} onClick={() => setTab(key)} style={{ flex: "0 0 auto", textAlign: "center", padding: "12px 14px", fontSize: 11, fontWeight: 600, color: tab === key ? t.primary : t.textMuted, borderBottom: tab === key ? `2px solid ${t.primary}` : "2px solid transparent", cursor: "pointer", whiteSpace: "nowrap" }}>{label}</div>
        ))}
      </div>
      {error && <div style={{ color: "#FF3B30", fontSize: 12.5, padding: "8px 16px" }}>{error}</div>}

      <div style={{ flex: 1, overflowY: "auto" }}>
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
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>WhatsApp-style instant media delete (1:1 chats)</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                When ON, media in one-on-one chats is downloaded to the recipient's device and the Supabase server copy is deleted immediately after, keeping storage near zero. Group chats are excluded (they keep the normal {settings?.mediaExpiryDays == null ? "permanent" : `${settings.mediaExpiryDays}-day`} cleanup). ON by default for users.
              </div>
              <div onClick={() => {
                const newVal = !settings?.mediaAutoDelete;
                updateGlobalSettings({ mediaAutoDelete: newVal }, myUid);
              }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.mediaAutoDelete ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.mediaAutoDelete ? "#34C759" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.mediaAutoDelete ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: settings?.mediaAutoDelete ? "#fff" : t.text }}>
                  {settings?.mediaAutoDelete ? "INSTANT MEDIA DELETE ON" : "Instant media delete off"}
                </span>
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>User-facing toggle for instant media delete</div>
                <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                  When ON, users can enable/disable instant media delete in their Settings. When OFF, the setting is hidden from users and the admin-chosen fallback behavior applies.
                </div>
                <div onClick={() => {
                  const newVal = !settings?.mediaAutoDeleteUserVisible;
                  updateGlobalSettings({ mediaAutoDeleteUserVisible: newVal }, myUid);
                }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.mediaAutoDeleteUserVisible ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                  <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.mediaAutoDeleteUserVisible ? "#34C759" : t.border, position: "relative" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.mediaAutoDeleteUserVisible ? 23 : 3, transition: "left 0.15s" }} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: settings?.mediaAutoDeleteUserVisible ? "#fff" : t.text }}>
                    {settings?.mediaAutoDeleteUserVisible ? "USER TOGGLE VISIBLE" : "USER TOGGLE HIDDEN"}
                  </span>
                </div>
              </div>
              {(settings?.mediaAutoDeleteUserVisible === false) && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Fallback when user toggle hidden</div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                    Choose the behavior for all users when the instant media delete toggle is hidden from them.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["expiry", "whatsapp"].map((mode) => (
                      <div
                        key={mode}
                        onClick={() => updateGlobalSettings({ mediaAutoDeleteFallback: mode }, myUid)}
                        style={{
                          padding: "10px 16px",
                          borderRadius: 10,
                          background: settings?.mediaAutoDeleteFallback === mode ? t.primary : t.primaryLight,
                          color: settings?.mediaAutoDeleteFallback === mode ? t.bubbleMeText : t.text,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          border: `1px solid ${settings?.mediaAutoDeleteFallback === mode ? t.primary : t.border}`,
                        }}
                      >
                        {mode === "expiry" ? "📅 3-day auto-delete" : "⚡ WhatsApp-style instant delete"}
                      </div>
                    ))}
                  </div>
                </div>
              )}
<div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Voice notes in WhatsApp pipeline</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                When ON, voice notes follow the WhatsApp-style instant delete pipeline (downloaded, server copy deleted). When OFF, voice notes are stored in the database for auto-play/queue (3-day expiry). Default: OFF (stored in DB).
              </div>
              <div onClick={() => {
                const newVal = !settings?.voiceNotesInPipeline;
                updateGlobalSettings({ voiceNotesInPipeline: newVal, voiceNotesStoreInDb: !newVal }, myUid);
              }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.voiceNotesInPipeline ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.voiceNotesInPipeline ? "#34C759" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.voiceNotesInPipeline ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: settings?.voiceNotesInPipeline ? "#fff" : t.text }}>
                  {settings?.voiceNotesInPipeline ? "VOICE NOTES IN PIPELINE" : "VOICE NOTES STORED IN DB"}
                </span>
              </div>
            </div>

            {/* Admin control: Voice notes storage default for all users */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Voice notes storage default (all users)</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                Set the default behavior for all users. When ON, voice notes are stored in database with 3-day expiry. When OFF, they use the instant delete pipeline (user must download each, downloaded cached locally forever).
              </div>
              <div onClick={() => {
                const newVal = !settings?.voiceNotesStoreInDb;
                updateGlobalSettings({ voiceNotesStoreInDb: newVal, voiceNotesInPipeline: !newVal }, myUid);
              }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.voiceNotesStoreInDb ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.voiceNotesStoreInDb ? "#34C759" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.voiceNotesStoreInDb ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: settings?.voiceNotesStoreInDb ? "#fff" : t.text }}>
                  {settings?.voiceNotesStoreInDb ? "STORE IN DB (3-day expiry)" : "INSTANT PIPELINE (no auto-expiry)"}
                </span>
              </div>
            </div>

            {/* Admin toggle: hide voice notes settings from users */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Hide voice notes settings from users</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                When ON, the voice notes storage setting is hidden from users in Settings. Users will use the admin-configured default above.
              </div>
              <div onClick={() => {
                const newVal = !settings?.hideVoiceNotesSettings;
                updateGlobalSettings({ hideVoiceNotesSettings: newVal }, myUid);
              }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideVoiceNotesSettings ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideVoiceNotesSettings ? "#34C759" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideVoiceNotesSettings ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideVoiceNotesSettings ? "#fff" : t.text }}>
                {settings?.hideVoiceNotesSettings ? "HIDDEN FROM USERS" : "VISIBLE TO USERS"}
                 </span>
               </div>
             </div>
             </div>

            {/* Special discipline icons (icon14 / icon15) */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Special icons (icon14 / icon15)</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                Show the two discipline launcher icons in the picker. When active, the app shows an animated warning on launch.
              </div>
              <div onClick={() => updateGlobalSettings({ hideSpecialIcons: !settings?.hideSpecialIcons }, myUid)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.hideSpecialIcons ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideSpecialIcons ? "#34C759" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideSpecialIcons ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: settings?.hideSpecialIcons ? "#fff" : t.text }}>{settings?.hideSpecialIcons ? "HIDDEN FROM USERS" : "VISIBLE TO USERS"}</span>
              </div>
            </div>

            {/* Splash warning text for special icons */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Splash warning text (icon14 / icon15)</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                Bright animated words shown on launch when a special icon is active.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea value={splashLine1} onChange={(ev) => { setSplashLine1(ev.target.value); setSplashSaved(false); }} placeholder="Splash line 1" rows={2} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
                <textarea value={splashLine2} onChange={(ev) => { setSplashLine2(ev.target.value); setSplashSaved(false); }} placeholder="Splash line 2" rows={2} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
                <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>Live preview (special-icon splash):</div>
                <div style={{ background: "#0B141A", borderRadius: 10, padding: "16px 12px", textAlign: "center", overflow: "hidden" }}>
                  <style>{`@keyframes nx-splash-pop-prev { 0% { opacity: 0; transform: translateY(10px) scale(0.92); } 60% { opacity: 1; transform: translateY(-2px) scale(1.02); } 100% { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#10B981", lineHeight: 1.4, animation: "nx-splash-pop-prev 0.5s ease-out both" }}>{splashLine1}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.8)", marginTop: 8, lineHeight: 1.4, animation: "nx-splash-pop-prev 0.5s ease-out 0.25s both" }}>{splashLine2}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={async () => { await updateGlobalSettings({ specialIconSplashLine1: splashLine1, specialIconSplashLine2: splashLine2 }, myUid); setSplashSaved(true); }} style={{ flex: 1, minWidth: 120, padding: "9px 10px", borderRadius: 9, border: "none", background: "#10B981", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Save splash words</button>
                  <button onClick={() => { setSplashLine1("If you will not use this app...."); setSplashLine2("You will go to ....."); setSplashSaved(false); }} style={{ flex: 1, minWidth: 120, padding: "9px 10px", borderRadius: 9, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Reset to defaults</button>
                </div>
                {splashSaved && <div style={{ fontSize: 12, color: "#10B981", fontWeight: 600 }}>Splash words saved.</div>}
              </div>
            </div>

            {/* AI icon style */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>AI icon style</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                How the AI assistant looks in chats and the sidebar widget.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  { id: "default", label: "Default" },
                  { id: "ai-letters", label: "AI Letters" },
                  { id: "neon", label: "Neon Glow" },
                  { id: "gradient", label: "Gradient" },
                  { id: "mono", label: "Mono Block" },
                ].map((opt) => (
                  <div key={opt.id} onClick={() => updateGlobalSettings({ aiIconStyle: opt.id }, myUid)} style={{ padding: "9px 14px", borderRadius: 10, background: (settings?.aiIconStyle || "neon") === opt.id ? t.primary : t.primaryLight, color: (settings?.aiIconStyle || "neon") === opt.id ? t.bubbleMeText : t.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${(settings?.aiIconStyle || "neon") === opt.id ? t.primary : t.border}` }}>{opt.label}</div>
                ))}
              </div>
            </div>

            {/* Per-type "Save to device" download buttons */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Hide "Save to device" buttons</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                Hide the download button for specific media types in conversations.
              </div>
              {[
                { key: "hideDownloadVoice", label: "Voice notes" },
                { key: "hideDownloadImages", label: "Pictures" },
                { key: "hideDownloadVideos", label: "Videos" },
                { key: "hideDownloadFiles", label: "Other files" },
              ].map((row) => {
                const on = !!settings?.[row.key];
                return (
                  <div key={row.key} onClick={() => updateGlobalSettings({ [row.key]: !on }, myUid)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: on ? "#34C759" : t.primaryLight, cursor: "pointer", marginTop: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: on ? "#fff" : t.text }}>{row.label}</span>
                    <div style={{ width: 42, height: 24, borderRadius: 12, background: on ? "#fff" : t.border, position: "relative", flexShrink: 0 }}>
                      <div style={{ width: 18, height: 18, borderRadius: "50%", background: on ? "#34C759" : "#fff", position: "absolute", top: 3, left: on ? 21 : 3, transition: "left 0.15s" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Cloudinary media optimization proxy (fetch API — no permanent storage) */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Enable Cloudinary Media Optimization Proxy</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                When ON, images and videos are served through Cloudinary's fetch API (f_auto, q_auto) for automatic optimization and CDN delivery. Media always stays stored in Supabase — nothing is saved permanently in Cloudinary. When OFF, media is served directly from Supabase.
              </div>
              <div onClick={() => updateGlobalSettings({ cloudinaryProxyEnabled: !settings?.cloudinaryProxyEnabled }, myUid)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.cloudinaryProxyEnabled ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.cloudinaryProxyEnabled ? "#34C759" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.cloudinaryProxyEnabled ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: settings?.cloudinaryProxyEnabled ? "#fff" : t.text }}>
                  {settings?.cloudinaryProxyEnabled ? "PROXY ENABLED" : "PROXY DISABLED"}
                </span>
              </div>
            </div>

            {/* Display video thumbnails in status previews */}
            <div style={{ background: t.surface, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Display Video Thumbnails in Previews</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                When ON, status feed cards show a static poster frame for videos. When OFF, the feed shows a blank placeholder instead of loading the video stream (saves bandwidth and Cloudinary transforms).
              </div>
              <div onClick={() => updateGlobalSettings({ show_video_thumbnails: !(settings?.show_video_thumbnails !== false) }, myUid)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.show_video_thumbnails !== false ? "#34C759" : t.primaryLight, cursor: "pointer" }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.show_video_thumbnails !== false ? "#34C759" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.show_video_thumbnails !== false ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: settings?.show_video_thumbnails !== false ? "#fff" : t.text }}>
                  {settings?.show_video_thumbnails !== false ? "THUMBNAILS ON" : "THUMBNAILS OFF"}
                </span>
              </div>
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

       {tab === "analytics" && (
         <AnalyticsTab />
       )}

       {tab === "directory" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Users size={16} color={t.primary} />
            <span style={{ fontSize: 13, color: t.textMuted }}>All registered users ({allUsers.length})</span>
          </div>
          {/* Smart search across display name, username, email, and phone */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, marginBottom: 12 }}>
            <Search size={15} color={t.textMuted} />
            <input
              value={directorySearch}
              onChange={(e) => setDirectorySearch(e.target.value)}
              placeholder="Smart search: name, @username, email, or phone…"
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13.5, color: t.text }}
            />
            {directorySearch && (
              <span onClick={() => setDirectorySearch("")} style={{ color: t.textMuted, cursor: "pointer", fontSize: 16 }}>×</span>
            )}
          </div>
          {allUsersLoading && <div style={{ color: t.textMuted, fontSize: 13, padding: 20, textAlign: "center" }}>Loading…</div>}
          {!allUsersLoading && allUsers.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No users found.</div>}
          {!allUsersLoading && directorySearch.trim().length >= 1 && filteredDirectory.length === 0 && (
            <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No matching users.</div>
          )}
          {filteredDirectory.map((u) => (
            <div key={u.uid} style={{ padding: "11px 4px", borderBottom: `1px solid ${t.border}` }}>
              <div onClick={() => setSelectedUser(u)} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, cursor: "pointer", minWidth: 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: t.primary }}>{u.displayName?.[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.displayName} <span style={{ color: t.textMuted, fontWeight: 400 }}>@{u.username}</span></div>
                  <div style={{ fontSize: 11.5, color: t.textMuted }}>{u.email}{u.role === "admin" ? " · Admin" : ""}</div>
                </div>
                {u.moderation?.banType && u.moderation.banType !== "none" && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 6, background: "#FFE5E5", color: "#FF3B30", fontWeight: 700 }}>{u.moderation.banType}</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                <div onClick={(e) => { e.stopPropagation(); toggleUserAIAccess(u.uid, !!u.aiApproved); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.aiApproved ? "#E5F9E7" : t.bg, border: `1px solid ${u.aiApproved ? "#28A745" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <Bot size={12} color={u.aiApproved ? "#28A745" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.aiApproved ? "#28A745" : t.textMuted }}>{u.aiApproved ? "AI On" : "AI Off"}</span>
                </div>
                <div onClick={(e) => { e.stopPropagation(); toggleUserAiVoiceNote(u.uid, !!u.aiVoiceNoteEnabled); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.aiVoiceNoteEnabled ? "#E5F0FF" : t.bg, border: `1px solid ${u.aiVoiceNoteEnabled ? "#1DA1F2" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <Mic size={12} color={u.aiVoiceNoteEnabled ? "#1DA1F2" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.aiVoiceNoteEnabled ? "#1DA1F2" : t.textMuted }}>{u.aiVoiceNoteEnabled ? "AI Voice Note" : "Voice Note Off"}</span>
                </div>
                <div onClick={(e) => { e.stopPropagation(); toggleUserAiFeature(u.uid, "podcast", !!u.aiFeatures?.podcast); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.aiFeatures?.podcast ? "#E5F0FF" : t.bg, border: `1px solid ${u.aiFeatures?.podcast ? "#1DA1F2" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <Radio size={12} color={u.aiFeatures?.podcast ? "#1DA1F2" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.aiFeatures?.podcast ? "#1DA1F2" : t.textMuted }}>{u.aiFeatures?.podcast ? "Podcast" : "No Podcast"}</span>
                </div>
                <div onClick={(e) => { e.stopPropagation(); toggleUserAiFeature(u.uid, "voiceReply", !!u.aiFeatures?.voiceReply); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.aiFeatures?.voiceReply ? "#E5F0FF" : t.bg, border: `1px solid ${u.aiFeatures?.voiceReply ? "#1DA1F2" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <Volume2 size={12} color={u.aiFeatures?.voiceReply ? "#1DA1F2" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.aiFeatures?.voiceReply ? "#1DA1F2" : t.textMuted }}>{u.aiFeatures?.voiceReply ? "Voice Reply" : "No V-Reply"}</span>
                </div>
                <input
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setUserDailyLimit(u.uid, "voiceNote", e.target.value)}
                  value={u.aiLimits?.voiceNote ?? ""}
                  placeholder="VN/day"
                  inputMode="numeric"
                  style={{ width: 64, fontSize: 10.5, padding: "4px 6px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, outline: "none" }}
                />
                <input
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setUserDailyLimit(u.uid, "voiceReply", e.target.value)}
                  value={u.aiLimits?.voiceReply ?? ""}
                  placeholder="VR/day"
                  inputMode="numeric"
                  style={{ width: 64, fontSize: 10.5, padding: "4px 6px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, outline: "none" }}
                />
                {u.aiApproved && (
                  <div onClick={(e) => { e.stopPropagation(); resetSingleAIAccess(u.uid); }} title="Reset AI: revoke access and delete AI chats" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 8, background: "#FFE5E5", border: "1px solid #FF3B30", cursor: "pointer", flexShrink: 0 }}>
                    <RefreshCw size={11} color="#FF3B30" />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#FF3B30" }}>Reset</span>
                  </div>
                )}
                <div onClick={(e) => { e.stopPropagation(); toggleUserHideAISettings(u.uid, !!u.hideAISettings); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.hideAISettings ? "#FFF3CD" : t.bg, border: `1px solid ${u.hideAISettings ? "#856404" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <EyeOff size={12} color={u.hideAISettings ? "#856404" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.hideAISettings ? "#856404" : t.textMuted }}>{u.hideAISettings ? "AI Settings Hidden" : "AI Settings Visible"}</span>
                </div>
                <div onClick={(e) => { e.stopPropagation(); toggleUserVerified(u.uid, !!u.verified); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: u.verified ? "#E1F0FF" : t.bg, border: `1px solid ${u.verified ? "#1DA1F2" : t.border}`, cursor: "pointer", flexShrink: 0 }}>
                  <Check size={12} color={u.verified ? "#1DA1F2" : t.textMuted} />
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: u.verified ? "#1DA1F2" : t.textMuted }}>{u.verified ? "Verified" : "Verify"}</span>
                </div>
                <div onClick={(e) => { e.stopPropagation(); resetUserProfile(u.uid); }} title="Reset cover, name & email" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 8, background: "#FFF3CD", border: "1px solid #856404", cursor: "pointer", flexShrink: 0 }}>
                  <RefreshCw size={11} color="#856404" />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#856404" }}>Reset info</span>
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
              <Globe size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Active Storage Provider</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Choose where all media (chat photos/videos, statuses, avatars) is uploaded.
              <strong> Supabase</strong> stores files in the private <code style={{ background: t.bg, padding: "2px 6px", borderRadius: 4 }}>chat-media</code> bucket.
              <strong> Cloudinary</strong> uses the backup engine (cloud <code style={{ background: t.bg, padding: "2px 6px", borderRadius: 4 }}>lsfhbqod</code>, unsigned preset <code style={{ background: t.bg, padding: "2px 6px", borderRadius: 4 }}>app_unsigned_preset</code>) for automatic optimization & CDN delivery.
              All uploads run through the centralized compression pipeline (15MB pre-compression gate, image → 70% JPEG, video → first-frame thumbnail).
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["supabase", "Supabase"], ["cloudinary", "Cloudinary"]].map(([key, label]) => (
                <div
                  key={key}
                  onClick={async () => {
                    if (storageProvider === key || storageProviderBusy) return;
                    setStorageProviderBusy(true);
                    setStorageProviderError("");
                    try {
                      await setActiveStorageProviderDb(key, myUid);
                      setStorageProvider(key);
                      invalidateStorageProviderCache();
                    } catch (e) {
                      setStorageProviderError(e.message || "Couldn't switch provider");
                    } finally {
                      setStorageProviderBusy(false);
                    }
                  }}
                  style={{ flex: 1, padding: "13px 0", borderRadius: 10, textAlign: "center", cursor: storageProviderBusy ? "wait" : "pointer", fontWeight: 700, fontSize: 13.5, border: `1.5px solid ${storageProvider === key ? t.primary : t.border}`, background: storageProvider === key ? t.primary : t.surface, color: storageProvider === key ? t.bubbleMeText : t.text, opacity: storageProviderBusy ? 0.6 : 1 }}
                >
                  {label}
                </div>
              ))}
            </div>
            {storageProviderError && <div style={{ color: "#FF3B30", fontSize: 12, marginTop: 8 }}>{storageProviderError}</div>}
            {storageProvider && !storageProviderError && (
              <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: storageProvider === "cloudinary" ? "#E5F9E7" : t.primaryLight, color: storageProvider === "cloudinary" ? "#28A745" : t.primary, fontSize: 12.5, fontWeight: 600 }}>
                Active provider: <strong>{storageProvider === "cloudinary" ? "Cloudinary" : "Supabase"}</strong> — new uploads will route here.
              </div>
            )}
          </div>
          {/* Authentication & Panel Security */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Lock size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Authentication &amp; Panel Security</span>
            </div>
            {/* Google Sign-In visibility (default HIDDEN — provider not configured) */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Google Sign-In button</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              {[["hide", "Hide"], ["show", "Show"]].map(([key, label]) => {
                const on = (settings?.auth?.googleSignIn || "hide") === key;
                return (
                  <div
                    key={key}
                    onClick={() => updateGlobalSettings({ auth: { ...(settings?.auth || {}), googleSignIn: key } }, myUid)}
                    style={{ flex: 1, textAlign: "center", padding: "11px 8px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? t.primary : t.border}`, background: on ? t.primary : t.bg, color: on ? "#fff" : t.text }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 14, lineHeight: 1.4 }}>
              Default Hide: no Google buttons appear anywhere (Google auth isn't configured). Show: the Google button appears on the auth screen only if the provider is actually functional — never a dead button.
            </div>
            {/* Admin panel PIN */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Admin Panel PIN</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input
                type="password"
                inputMode="numeric"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Set a PIN (blank = remove lock)"
                style={{ flex: 1, boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 13, color: t.text, background: t.bg, outline: "none" }}
              />
              <div
                onClick={async () => {
                  setPinBusy(true); setPinMsg("");
                  try {
                    await setAdminPanelPinHash(pinInput.trim(), myUid);
                    setPinInput("");
                    setPinMsg(pinInput.trim() ? "PIN saved (stored as a hash, never plaintext)." : "PIN removed — panel unlocks without a PIN.");
                  } catch (e) {
                    setPinMsg("Couldn't save PIN: " + (e?.message || "unknown error"));
                  } finally { setPinBusy(false); }
                }}
                style={{ padding: "10px 16px", borderRadius: 9, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: pinBusy ? "wait" : "pointer", opacity: pinBusy ? 0.6 : 1 }}
              >
                Save
              </div>
            </div>
            {pinMsg && <div style={{ fontSize: 11.5, color: t.textMuted }}>{pinMsg}</div>}
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6, lineHeight: 1.4 }}>
              Stored server-side as a SHA-256 hash in the admin configuration — never plaintext, never localStorage. The Admin Panel stays in the menu for admin accounts at all times; this PIN is the extra gate to open it.
            </div>
          </div>
          {/* Status Builder version (NEW WhatsApp-style vs Original) */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Camera size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Status Builder</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Current version: <strong>{(settings?.statusBuilder?.version || "new") === "old" ? "Original Builder" : "New Builder"}</strong>.
              Stored server-side — applies to all users on next open, survives reinstall.
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Builder Version</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["new", "New Builder"], ["old", "Old Builder"]].map(([key, label]) => {
                const on = ((settings?.statusBuilder?.version || "new") === key);
                return (
                  <div
                    key={key}
                    onClick={() => setBuilderConfirm(key)}
                    style={{ flex: 1, textAlign: "center", padding: "11px 8px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? t.primary : t.border}`, background: on ? t.primary : t.bg, color: on ? "#fff" : t.text }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
            {builderConfirm && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: t.bg, border: `1px solid ${t.border}` }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: t.text, marginBottom: 4 }}>Switch Status Builder for all users?</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
                  This changes which builder users see the next time they open Status creation. Existing published statuses are unaffected.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div onClick={() => setBuilderConfirm(null)} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 9, background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Cancel</div>
                  <div
                    onClick={async () => {
                      try {
                        await updateGlobalSettings({ statusBuilder: { ...(settings?.statusBuilder || {}), version: builderConfirm } }, myUid);
                      } catch (e) {
                        setError("Couldn't switch builder: " + (e?.message || "unknown error"));
                      } finally { setBuilderConfirm(null); }
                    }}
                    style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 9, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  >
                    Switch Builder
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Status Preview Mode toggle */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Video size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Status Preview Mode</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Controls how status videos appear in the feed. <strong>Video Loop</strong> shows a lightweight 2-3 second animated preview clip. <strong>Static Picture</strong> shows only the poster JPEG (maximum data savings, no video loading).
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { key: "video_loop", label: "Video Loop (animated)", icon: "🎬" },
                { key: "static_picture", label: "Static Picture (saves data)", icon: "🖼️" },
              ].map(({ key, label, icon }) => (
                <div
                  key={key}
                  onClick={async () => {
                    try {
                      // Write to Firestore globalSettings (same doc the panel reads from)
                      await updateGlobalSettings({ status_preview_mode: key }, myUid);
                      // Also persist to Supabase system_settings for worker access
                      await writeSystemSetting("status_preview_mode", key, { description: "Status feed preview mode" }).catch(() => {});
                      forceSettingsRerender();
                    } catch (e) {
                      console.error("Failed to set preview mode:", e);
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "12px 10px",
                    borderRadius: 10,
                    textAlign: "center",
                    cursor: "pointer",
                    border: `1.5px solid ${settings?.status_preview_mode === key ? t.primary : t.border}`,
                    background: settings?.status_preview_mode === key ? t.primary : t.surface,
                    color: settings?.status_preview_mode === key ? t.bubbleMeText : t.text,
                    fontWeight: 700,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                  {label}
                </div>
              ))}
            </div>
            {settings?.status_preview_mode === "static_picture" && (
              <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "#FFF3CD", color: "#856404", fontSize: 12.5, fontWeight: 600 }}>
                Static mode ON — status feed will only show poster images, never video clips. Saves maximum data.
              </div>
            )}
          </div>
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
              <Zap size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>AI Provider</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Choose which AI backend powers NexText AI. "Groq" uses the existing OpenAI/Groq models. "Gemini" uses Google's gemini-2.5-flash and enables AI image generation via the <code style={{ background: t.bg, padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>/image</code> command.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[
                { id: "groq", label: "Groq" },
                { id: "gemini", label: "Gemini" },
              ].map((o) => (
                <div key={o.id} onClick={() => setSystemConfig({ aiProvider: o.id }, myUid)} style={{ flex: 1, textAlign: "center", padding: "10px 8px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${t.border}`, background: (sysConfig?.aiProvider || "groq") === o.id ? t.primary : t.bg, color: (sysConfig?.aiProvider || "groq") === o.id ? "#fff" : t.text }}>
                  {o.label}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: t.text }}>Gemini API Key</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: sysConfig?.geminiApiKey ? "#28A745" : "#FF3B30", padding: "3px 8px", borderRadius: 6, background: sysConfig?.geminiApiKey ? "#E5F9E7" : "#FFE5E5" }}>
                {sysConfig?.geminiApiKey ? "Set" : "Missing"}
              </span>
            </div>
            <input
              type="password"
              value={geminiKeyDraft}
              onChange={(e) => setGeminiKeyDraft(e.target.value)}
              placeholder="Paste Gemini API key"
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, marginTop: 4 }}
            />
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6, lineHeight: 1.45 }}>
              Required only when the provider is Gemini. Paste your Google AI Studio / Vertex API key here (it is stored in Firestore, never in the app source).
            </div>
            <button onClick={() => { setSystemConfig({ geminiApiKey: geminiKeyDraft }, myUid); setAiSaved(true); setTimeout(() => setAiSaved(false), 2500); }} style={{ marginTop: 8, width: "100%", padding: 10, borderRadius: 10, border: "none", background: t.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              Save Gemini Key
            </button>
          </div>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Bot size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Gemini Model (admin default)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Admins choose the Gemini model every user gets. Users only get to pick their own model if you enable the toggle below.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {GEMINI_MODELS.map((o) => (
                <div key={o.id} onClick={() => setSystemConfig({ geminiModel: o.id }, myUid)} style={{ flex: "1 1 45%", textAlign: "center", padding: "9px 8px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${t.border}`, background: (sysConfig?.geminiModel || DEFAULT_GEMINI_MODEL) === o.id ? t.primary : t.bg, color: (sysConfig?.geminiModel || DEFAULT_GEMINI_MODEL) === o.id ? "#fff" : t.text }}>
                  {o.label}
                </div>
              ))}
            </div>
            <div onClick={() => { setSystemConfig({ allowUserGeminiModel: !sysConfig?.allowUserGeminiModel }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.allowUserGeminiModel ? t.primaryLight : "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.allowUserGeminiModel ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.allowUserGeminiModel ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {sysConfig?.allowUserGeminiModel ? "Users CAN pick their own Gemini model" : "Users use the admin default model"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  Off by default — everyone uses the model you selected above. Enable to show a model picker inside AI chat.
                </div>
              </div>
            </div>
            </div>
            <div onClick={() => { setSystemConfig({ enableAiImageGenButton: !sysConfig?.enableAiImageGenButton }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.enableAiImageGenButton ? t.primaryLight : "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.enableAiImageGenButton ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.enableAiImageGenButton ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {sysConfig?.enableAiImageGenButton ? "AI chat '+': Image generation ON" : "AI chat '+': Image generation OFF"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  Off by default. When ON, AI chat shows a "+" button so ANY user can generate an image (works even if Groq is the active chat provider).
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 8 }}>Global AI Image Model</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.4 }}>
                Free image generation (Pollinations). Applied globally to every session.
              </div>
              {[
                { id: "flux", label: "Flux.1 - Photorealistic & Best Quality" },
                { id: "dreamshaper", label: "Dreamshaper - Artistic & Digital Art" },
                { id: "turbovisionxl", label: "TurboVision - Ultra-Fast Generation" },
              ].map((o) => (
                <div key={o.id} onClick={() => setSystemConfig({ active_image_model: o.id }, myUid)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: `1px solid ${t.border}`, marginBottom: 6, background: (sysConfig?.active_image_model || "flux") === o.id ? t.primaryLight : "transparent" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${(sysConfig?.active_image_model || "flux") === o.id ? t.primary : t.border}`, flexShrink: 0, marginTop: 1 }}>
                    {(sysConfig?.active_image_model || "flux") === o.id && <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.primary, margin: 2 }} />}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.text }}>{o.label}</div>
                </div>
              ))}
            </div>
            <div onClick={() => { setSystemConfig({ global_voice_enabled: !(sysConfig?.global_voice_enabled !== false) }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.global_voice_enabled !== false ? t.primaryLight : "#FF3B30", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12, marginBottom: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.global_voice_enabled !== false ? t.primary : "#FF3B30", position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.global_voice_enabled !== false ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {sysConfig?.global_voice_enabled !== false ? "Master Voice Features: ON" : "Master Voice Features: OFF"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  Controls the entire app audio network — AI voice replies and custom voice notes. When OFF, all voice UI is hidden for every user.
                </div>
              </div>
             </div>

             {/* AI Podcast + Voice Reply master switches — OFF by default so users
                 don't see these features until an admin enables them globally
                 (or per-user via the directory). */}
             <div onClick={() => { setSystemConfig({ aiPodcastEnabled: !(sysConfig?.aiPodcastEnabled === true) }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.aiPodcastEnabled === true ? t.primaryLight : "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12, marginBottom: 12 }}>
               <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.aiPodcastEnabled === true ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                 <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.aiPodcastEnabled === true ? 23 : 3, transition: "left 0.15s" }} />
               </div>
               <div>
                 <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>AI Podcasts: {sysConfig?.aiPodcastEnabled === true ? "ENABLED for all" : "OFF (admin only)"}</div>
                 <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>When OFF, the AI Podcast option is hidden for users. Enable globally, or grant per-user in the directory.</div>
               </div>
             </div>
             <div onClick={() => { setSystemConfig({ aiVoiceReplyEnabled: !(sysConfig?.aiVoiceReplyEnabled === true) }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.aiVoiceReplyEnabled === true ? t.primaryLight : "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginBottom: 12 }}>
               <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.aiVoiceReplyEnabled === true ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                 <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.aiVoiceReplyEnabled === true ? 23 : 3, transition: "left 0.15s" }} />
               </div>
               <div>
                 <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>AI Voice Replies: {sysConfig?.aiVoiceReplyEnabled === true ? "ENABLED for all" : "OFF (admin only)"}</div>
                 <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>When OFF, voice replies are hidden. Enable globally, or grant per-user in the directory. Voice replies still require Master Voice Features ON.</div>
               </div>
             </div>

             {/* Allow all users to download AI voice replies as .mp3 voice notes */}
             <div onClick={() => { setSystemConfig({ allowVoiceDownload: !(sysConfig?.allowVoiceDownload === true) }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.allowVoiceDownload === true ? t.primaryLight : "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginBottom: 12 }}>
               <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.allowVoiceDownload === true ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                 <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.allowVoiceDownload === true ? 23 : 3, transition: "left 0.15s" }} />
               </div>
               <div>
                 <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                   {sysConfig?.allowVoiceDownload === true ? "Users can download AI voice: ON" : "Users can download AI voice: OFF"}
                 </div>
                 <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                   When ON, every user gets a "Save" button on AI voice replies. Admins can always download regardless of this switch.
                 </div>
               </div>
              </div>

              {/* Storage provider switch: Cloudinary <-> Supabase. Admin must type the
                  confirmation word "change" to flip the active provider. */}
              <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${t.border}`, marginBottom: 14, background: t.bg }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 4 }}>Media Storage Provider</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
                  Currently using <strong>{activeProvider === "cloudinary" ? "Cloudinary" : "Supabase"}</strong>. To switch to {activeProvider === "cloudinary" ? "Supabase" : "Cloudinary"}, type <code style={{ background: t.surface, padding: "1px 5px", borderRadius: 4 }}>change</code> below and press Switch.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={providerInput}
                    onChange={(e) => setProviderInput(e.target.value)}
                    placeholder='type "change"'
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, outline: "none" }}
                  />
                  <div onClick={toggleStorageProvider} style={{ padding: "8px 16px", borderRadius: 8, background: t.primary, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center" }}>
                    Switch
                  </div>
                </div>
              </div>

              {/* Fish Audio API key — stored server-side (Worker reads it from Firestore), never shipped to clients */}
             <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${t.border}`, marginBottom: 14, background: t.bg }}>
               <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Fish Audio API Key</div>
               <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
                 Saved to Firestore and used by the Cloudflare Worker (<code style={{ fontSize: 11 }}>/api/generate-voice</code>) so the key is never exposed in the app. Leave blank to keep the current key.
               </div>
               <input
                 type="password"
                 value={fishKey}
                 onChange={(e) => { setFishKey(e.target.value); setFishKeySaved(false); }}
                 placeholder="sk-fish-..."
                 style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, outline: "none", color: t.text, background: t.surface }}
               />
               <button
                 onClick={async () => {
                   try {
                     await setFishAudioKey(fishKey);
                     setFishKeySaved(true);
                     setTimeout(() => setFishKeySaved(false), 2500);
                   } catch {}
                 }}
                 style={{ marginTop: 8, width: "100%", padding: 10, borderRadius: 10, border: "none", background: t.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}
                >
                  {fishKeySaved ? "Saved ✓" : "Save Fish Audio Key"}
                </button>
              </div>

              {/* Daily usage limits — 0 means unlimited */}
              <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${t.border}`, marginBottom: 14, background: t.bg }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 6 }}>Daily Usage Limits</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.4 }}>
                  Caps how much media/files a user can post and how many status updates they can create per day. Set to 0 for unlimited.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 45%" }}>
                    <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>Media limit (MB / day)</div>
                    <input
                      type="number"
                      min="0"
                      value={mediaLimitMB}
                      onChange={(e) => { setMediaLimitMB(e.target.value); setLimitsSaved(false); }}
                      placeholder="0 = unlimited"
                      style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, outline: "none", color: t.text, background: t.surface }}
                    />
                  </div>
                  <div style={{ flex: "1 1 45%" }}>
                    <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>Status limit (count / day)</div>
                    <input
                      type="number"
                      min="0"
                      value={statusLimit}
                      onChange={(e) => { setStatusLimit(e.target.value); setLimitsSaved(false); }}
                      placeholder="0 = unlimited"
                      style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, outline: "none", color: t.text, background: t.surface }}
                    />
                  </div>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await setSystemConfig({
                        dailyMediaLimitMB: Math.max(0, parseInt(mediaLimitMB || "0", 10) || 0),
                        dailyStatusLimit: Math.max(0, parseInt(statusLimit || "0", 10) || 0),
                      }, myUid);
                      setLimitsSaved(true);
                      setTimeout(() => setLimitsSaved(false), 2500);
                    } catch {}
                  }}
                  style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 10, border: "none", background: t.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}
                >
                  {limitsSaved ? "Saved ✓" : "Save Usage Limits"}
                </button>
              </div>

              <div style={{ fontWeight: 700, fontSize: 14, color: t.text, margin: "4px 0 6px" }}>Voice Options</div>

              <div onClick={() => { setSystemConfig({ hideRoshVoice: !sysConfig?.hideRoshVoice }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.hideRoshVoice ? t.border : t.primaryLight, cursor: "pointer", marginBottom: 10 }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.hideRoshVoice ? t.border : t.primary, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.hideRoshVoice ? 3 : 23, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{sysConfig?.hideRoshVoice ? "The Rosh voice: HIDDEN" : "The Rosh voice: visible"}</span>
              </div>

              <div onClick={() => { setSystemConfig({ aiVoiceReplyGloballyDisabled: !sysConfig?.aiVoiceReplyGloballyDisabled }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.aiVoiceReplyGloballyDisabled ? "#FF3B30" : t.primaryLight, cursor: "pointer", marginBottom: 10 }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.aiVoiceReplyGloballyDisabled ? "#FF3B30" : t.border, position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.aiVoiceReplyGloballyDisabled ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: sysConfig?.aiVoiceReplyGloballyDisabled ? "#fff" : t.text }}>{sysConfig?.aiVoiceReplyGloballyDisabled ? "AI Voice Replies: DISABLED (admins only)" : "AI Voice Replies: enabled"}</span>
              </div>

              <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: t.text, marginBottom: 8 }}>Custom Voices (model IDs)</div>
                {(sysConfig?.customVoices || []).length === 0 && (
                  <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>No custom voices added.</div>
                )}
                {(sysConfig?.customVoices || []).map((cv, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: t.text, flex: 1 }}><b>{cv.name}</b> <span style={{ color: t.textMuted }}>{cv.referenceId}</span></span>
                    <span style={{ color: "#FF3B30", fontSize: 13, cursor: "pointer" }} onClick={() => { const arr = (sysConfig?.customVoices || []).filter((_, j) => j !== i); setSystemConfig({ customVoices: arr }, myUid); }}>Remove</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <input
                    value={customVoiceName}
                    onChange={(e) => setCustomVoiceName(e.target.value)}
                    placeholder="Display name"
                    style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, outline: "none", color: t.text, background: t.bg }}
                  />
                  <input
                    value={customVoiceId}
                    onChange={(e) => setCustomVoiceId(e.target.value)}
                    placeholder="Fish Audio model ID"
                    style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, outline: "none", color: t.text, background: t.bg }}
                  />
                  <button
                    onClick={() => {
                      const id = customVoiceId.trim();
                      const name = customVoiceName.trim();
                      if (!id || !name) return;
                      const arr = [...(sysConfig?.customVoices || [])];
                      if (arr.some((c) => c.referenceId === id)) { setCustomVoiceName(""); setCustomVoiceId(""); return; }
                      arr.push({ id, name, referenceId: id });
                      setSystemConfig({ customVoices: arr }, myUid);
                      setCustomVoiceName("");
                      setCustomVoiceId("");
                    }}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                  >Add</button>
                </div>
              </div>

              <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: t.text, marginBottom: 4 }}>Per-Voice Director Profiles</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
                  Give each voice a real/full name and a short prompt. When a user auto-formats a script for that voice (e.g. Y Mizrachi), the AI uses this context to weave the name and personality into the output.
                </div>
                {(allVoices || []).map((v) => {
                  const prof = voiceProfilesDraft[v.id] || {};
                  return (
                    <div key={v.id} style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10, marginTop: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: t.text, marginBottom: 6 }}>{v.name}{v.custom ? " (custom)" : ""}</div>
                      <input
                        value={prof.fullName || ""}
                        onChange={(e) => setVoiceProfilesDraft((d) => ({ ...d, [v.id]: { ...(d[v.id] || {}), fullName: e.target.value } }))}
                        placeholder="Full / real name (optional)"
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, outline: "none", color: t.text, background: t.bg, marginBottom: 6 }}
                      />
                      <textarea
                        value={prof.prompt || ""}
                        onChange={(e) => setVoiceProfilesDraft((d) => ({ ...d, [v.id]: { ...(d[v.id] || {}), prompt: e.target.value } }))}
                        placeholder="Prompt / personality context for the AI (optional)"
                        rows={2}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, resize: "none", outline: "none", color: t.text, background: t.bg }}
                      />
                    </div>
                  );
                })}
                <button
                  onClick={() => { setSystemConfig({ voiceProfiles: voiceProfilesDraft }, myUid); setVoiceProfilesSaved(true); setTimeout(() => setVoiceProfilesSaved(false), 2000); }}
                  style={{ marginTop: 12, width: "100%", padding: 10, borderRadius: 10, border: "none", background: t.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}
                >
                  {voiceProfilesSaved ? "Saved ✓" : "Save Voice Profiles"}
                </button>
              </div>

              <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: t.text, marginBottom: 4 }}>Hidden Personas</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
                  Toggle any persona off to hide it from AI chat and AI voice for all users. Hidden personas can't be selected anywhere until re-enabled.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                  {AI_PERSONA_TRAY.map(([key, label]) => {
                    const hidden = (sysConfig?.hiddenPersonas || []).includes(key);
                    return (
                      <div key={key} onClick={() => {
                        const cur = sysConfig?.hiddenPersonas || [];
                        const next = hidden ? cur.filter((k) => k !== key) : [...cur, key];
                        setSystemConfig({ hiddenPersonas: next }, myUid);
                      }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, cursor: "pointer", background: hidden ? "#2a2a2a" : t.bg, border: `1px solid ${t.border}` }}>
                        <span style={{ flex: 1, fontSize: 13, color: hidden ? t.textMuted : t.text, fontWeight: 600 }}>{label}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: hidden ? "#FF3B30" : "#28A745" }}>{hidden ? "HIDDEN" : "VISIBLE"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: t.text, marginBottom: 4 }}>Persona → Voice Hookup</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
                  Assign a Fish Audio voice to each persona. When voice replies are ON, the AI uses the hooked voice for that persona (overriding its built-in voice). Leave as "Default (persona voice)" to use the persona's own voice.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                  {AI_PERSONA_TRAY.map(([key, label]) => {
                    const current = (sysConfig?.personaVoiceMap && sysConfig.personaVoiceMap[key]) || "";
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: t.bg, border: `1px solid ${t.border}` }}>
                        <span style={{ flex: 1, fontSize: 13, color: t.text, fontWeight: 600 }}>{label}</span>
                        <select
                          value={current}
                          onChange={(e) => {
                            const val = e.target.value;
                            const map = { ...(sysConfig?.personaVoiceMap || {}) };
                            if (val) map[key] = val; else delete map[key];
                            setSystemConfig({ personaVoiceMap: map }, myUid);
                          }}
                          style={{ flexShrink: 0, maxWidth: 170, padding: "6px 8px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, background: t.bg, color: t.text, cursor: "pointer" }}
                        >
                          <option value="">Default (persona voice)</option>
                          {allVoices.map((v) => (
                            <option key={v.id} value={v.referenceId}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div onClick={() => { setSystemConfig({ hideMizrachiMode: !sysConfig?.hideMizrachiMode }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.hideMizrachiMode ? "#FF3B30" : t.primaryLight, cursor: "pointer", marginBottom: 14 }}>
            <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.hideMizrachiMode ? "#FF3B30" : t.border, position: "relative" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.hideMizrachiMode ? 23 : 3, transition: "left 0.15s" }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: sysConfig?.hideMizrachiMode ? "#fff" : t.text }}>
              {sysConfig?.hideMizrachiMode ? "Y Mizrachi Mode: HIDDEN" : "Y Mizrachi Mode: visible"}
            </span>
          </div>
          <div onClick={() => { setSystemConfig({ altSettings: !sysConfig?.altSettings }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.altSettings ? t.primary : t.primaryLight, cursor: "pointer", marginBottom: 14 }}>
            <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.altSettings ? t.border : t.border, position: "relative" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.altSettings ? 23 : 3, transition: "left 0.15s" }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: sysConfig?.altSettings ? "#fff" : t.text }}>{sysConfig?.altSettings ? "Revamped Settings: default ON for all users" : "Revamped Settings: default OFF (classic)"}</span>
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

            {/* Hide status top bar options (camera, layout, size) */}
            <div onClick={() => {
              const newVal = !settings?.hideStatusTopBar;
              updateGlobalSettings({ hideStatusTopBar: newVal }, myUid);
            }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${t.border}`, cursor: "pointer", marginTop: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.hideStatusTopBar ? "#FF3B30" : t.primary, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.hideStatusTopBar ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>
                  {settings?.hideStatusTopBar ? "Status top bar: HIDDEN" : "Status top bar: visible"}
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                  When hidden, the camera, layout, and size buttons are hidden from the Status page top bar for all users.
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
              <ImageIcon size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Native Photo Picker (Gallery)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When ON, the message composer's gallery button opens Android's built-in photo picker (scrollable gallery + camera) instead of the generic Files app. Off by default. Note: requires a recent Android; on older devices it falls back to the Files app.
            </div>
            <div onClick={() => { setSystemConfig({ nativeGallery: !sysConfig?.nativeGallery }, myUid); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: sysConfig?.nativeGallery ? "#00A884" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: sysConfig?.nativeGallery ? "#00A884" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sysConfig?.nativeGallery ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: sysConfig?.nativeGallery ? "#fff" : t.text }}>
                {sysConfig?.nativeGallery ? "NATIVE GALLERY ON" : "Native gallery off (Files app)"}
              </span>
            </div>
          </div>

          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Video size={18} color="#8E8E93" />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Status Video Pipeline (HLS)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              When ON, Status videos are uploaded private and transcoded to adaptive HLS (360p/540p/720p) + fallback + poster + card-preview. Requires Blaze + FFmpeg worker (see workers/videoTranscode). Off = legacy direct public URL (Spark-compatible).
            </div>
            <div onClick={() => updateGlobalSettings({ statusVideoPipelineEnabled: !settings?.statusVideoPipelineEnabled }, myUid)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.statusVideoPipelineEnabled ? "#00A884" : t.primaryLight, cursor: "pointer" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.statusVideoPipelineEnabled ? "#00A884" : t.border, position: "relative" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.statusVideoPipelineEnabled ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.statusVideoPipelineEnabled ? "#fff" : t.text }}>
                {settings?.statusVideoPipelineEnabled ? "PIPELINE ON (HLS)" : "Pipeline off (direct)"}
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
                value={sysConfig?.webFallbackUrl || "https://nextext.nextext-app.workers.dev"}
                onChange={(e) => setSystemConfig({ webFallbackUrl: e.target.value || "https://nextext.nextext-app.workers.dev" }, myUid)}
                placeholder="https://example.com"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, cursor: "pointer" }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted }}>
              Current: <strong>{sysConfig?.webFallbackUrl || "https://nextext.nextext-app.workers.dev"}</strong>
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

          {/* Empty Database (nuclear option) */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginTop: 14, border: "2px solid #FF3B30" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Trash2 size={18} color="#FF3B30" />
              <span style={{ fontWeight: 700, fontSize: 15, color: "#FF3B30" }}>Empty Database (Nuclear Option)</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              <strong>IRREVERSIBLE.</strong> This will permanently delete ALL data: messages, media, statuses, contacts, announcements, AI requests, user stats, and Supabase storage files. Only admin accounts will remain. Type <strong>"DELETE EVERYTHING"</strong> in the box below to confirm.
            </div>
            <div style={{ marginBottom: 10 }}>
              <input
                ref={emptyDbConfirmRef}
                type="text"
                placeholder="Type DELETE EVERYTHING to confirm"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13 }}
              />
            </div>
            <button
              onClick={handleEmptyDatabase}
              disabled={emptyDbLoading || (emptyDbConfirmRef.current?.value || "") !== "DELETE EVERYTHING"}
              style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: (emptyDbConfirmRef.current?.value || "") === "DELETE EVERYTHING" ? "#FF3B30" : t.border, color: (emptyDbConfirmRef.current?.value || "") === "DELETE EVERYTHING" ? "#fff" : t.textMuted, fontWeight: 700, fontSize: 14, cursor: ((emptyDbConfirmRef.current?.value || "") === "DELETE EVERYTHING" && !emptyDbLoading) ? "pointer" : "not-allowed", opacity: emptyDbLoading ? 0.7 : 1 }}
            >
              {emptyDbLoading ? "Deleting…" : "EMPTY DATABASE NOW"}
            </button>
            {emptyDbResult && <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: emptyDbResult.success ? "#E5F9E7" : "#FFE5E5", color: emptyDbResult.success ? "#28A745" : "#FF3B30", fontSize: 12.5, fontWeight: 600 }}>{emptyDbResult.message}</div>}
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
            <Megaphone size={18} color={t.primary} />
            <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>Announcement</span>
          </div>
          <div style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Shown at the top of every user's chat list until they dismiss it.</div>
            <textarea
              value={annText}
              onChange={(e) => setAnnText(e.target.value)}
              placeholder="Type an announcement for all users…"
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, resize: "none", outline: "none", color: t.text, background: t.bg, marginBottom: 10 }}
            />
            <button onClick={postAnnouncement} disabled={!annText.trim()} style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: annText.trim() ? t.primary : t.border, color: "#fff", fontWeight: 700, fontSize: 13, cursor: annText.trim() ? "pointer" : "not-allowed" }}>
              Post announcement
            </button>
            {settings?.announcement?.text && (
              <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: t.bg, fontSize: 12.5, color: t.text }}>
                <div style={{ marginBottom: 8 }}>Current: {settings.announcement.text}</div>
                <button onClick={() => clearAnnouncement()} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: "#FF3B30", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Clear announcement</button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 }}>
            <Bot size={18} color={t.primary} />
            <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>Custom AI Personas</span>
          </div>
          <div style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10 }}>{editingPersonaKey ? "Editing persona" : "Add a new AI persona (name, how it speaks, how it answers, optional voice)."}</div>
            <input value={personaName} onChange={(e) => setPersonaName(e.target.value)} placeholder="Name (e.g. Coach Carter)" style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 13, marginBottom: 8, color: t.text, background: t.bg, outline: "none" }} />
            <input value={personaIcon} onChange={(e) => setPersonaIcon(e.target.value)} placeholder="Icon emoji (default 🧠)" style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 13, marginBottom: 8, color: t.text, background: t.bg, outline: "none" }} />
            <textarea value={personaPrompt} onChange={(e) => setPersonaPrompt(e.target.value)} placeholder="How it should answer (system prompt)" rows={2} style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 13, resize: "none", marginBottom: 8, color: t.text, background: t.bg, outline: "none" }} />
            <textarea value={personaSpeak} onChange={(e) => setPersonaSpeak(e.target.value)} placeholder="How it should speak (tone, style, mannerisms)" rows={2} style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 13, resize: "none", marginBottom: 8, color: t.text, background: t.bg, outline: "none" }} />
            <input value={personaVoice} onChange={(e) => setPersonaVoice(e.target.value)} placeholder="Fish Audio voice ref ID (optional)" style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 13, marginBottom: 10, color: t.text, background: t.bg, outline: "none" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={savePersona} disabled={!personaName.trim()} style={{ flex: 1, padding: 10, borderRadius: 10, border: "none", background: personaName.trim() ? t.primary : t.border, color: "#fff", fontWeight: 700, fontSize: 13, cursor: personaName.trim() ? "pointer" : "not-allowed" }}>{editingPersonaKey ? "Update persona" : "Add persona"}</button>
              {editingPersonaKey && <button onClick={() => { setEditingPersonaKey(null); setPersonaName(""); setPersonaIcon(""); setPersonaDesc(""); setPersonaPrompt(""); setPersonaSpeak(""); setPersonaVoice(""); }} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Cancel</button>}
            </div>
            {customPersonas.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {customPersonas.map((p) => (
                  <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${t.border}` }}>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.text }}>{p.icon || "🧠"} {p.name}</div>
                    <button onClick={() => editPersona(p)} style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.primary, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Edit</button>
                    <button onClick={() => deletePersona(p.key)} style={{ padding: "5px 10px", borderRadius: 8, border: "none", background: "#FFE5E5", color: "#FF3B30", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>

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

      {tab === "voices" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Volume2 size={18} color={t.primary} />
            <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>Pending Voice Samples ({pendingSamples.length})</span>
          </div>
          {pendingSamples.length === 0 && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 30 }}>No pending voice samples.</div>}
          {pendingSamples.map((s) => (
            <div key={s.id} style={{ background: t.surface, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{s.name || "Untitled"}</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10 }}>Submitted by {s.displayName || s.uid}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a href={s.mediaURL} download target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 90, textAlign: "center", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.primary, fontWeight: 700, fontSize: 12.5 }}>Download / Play</a>
                <button onClick={() => approveVoiceSample(s)} style={{ flex: 1, minWidth: 90, padding: "9px 12px", borderRadius: 8, border: "none", background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Approve</button>
                <button onClick={() => deleteVoiceSample(s)} style={{ flex: 1, minWidth: 90, padding: "9px 12px", borderRadius: 8, border: "none", background: "#FFE5E5", color: "#FF3B30", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "jewish" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Radio size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Jewish Statuses</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Global feed of curated Jewish status updates. Toggle the feature globally, per source, and per category. The status feed also honors the blocked creators / blocked statuses lists below.
            </div>

            {/* Global feature enable/disable */}
            <div onClick={() => updateJewish({ enabled: !(settings?.jewishStatuses?.enabled === true) })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.jewishStatuses?.enabled === true ? "#34C759" : t.primaryLight, cursor: "pointer", marginBottom: 12 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.jewishStatuses?.enabled === true ? "#34C759" : t.border, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.jewishStatuses?.enabled === true ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.jewishStatuses?.enabled === true ? "#fff" : t.text }}>
                {settings?.jewishStatuses?.enabled === true ? "JEWISH STATUSES ON" : "JEWISH STATUSES OFF"}
              </span>
            </div>

            {/* Jewish Status Downloads (global; per-user override on each user page) */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, margin: "16px 0 6px" }}>Jewish Status Downloads</div>
            <div onClick={() => updateJewish({ downloads: { ...(settings?.jewishStatuses?.downloads || {}), enabled: !(settings?.jewishStatuses?.downloads?.enabled === true) } })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.jewishStatuses?.downloads?.enabled === true ? "#34C759" : t.primaryLight, cursor: "pointer", marginBottom: 6 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.jewishStatuses?.downloads?.enabled === true ? "#34C759" : t.border, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.jewishStatuses?.downloads?.enabled === true ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.jewishStatuses?.downloads?.enabled === true ? "#fff" : t.text }}>
                {settings?.jewishStatuses?.downloads?.enabled === true ? "DOWNLOADS ON (global)" : "DOWNLOADS OFF (global — default)"}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 14, lineHeight: 1.4 }}>
              OFF by default. When OFF, an explicit per-user ENABLED override may still allow downloads; per-user overrides (INHERIT / ENABLED / DISABLED) live on each user's detail page. Media downloads go directly from the original source to the user's device — nothing is stored on our infrastructure.
            </div>

            {/* Attribution (show/hide + custom text + links) */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Jewish Status Attribution</div>
            <div onClick={() => updateJewish({ attribution: { ...(settings?.jewishStatuses?.attribution || {}), show: (settings?.jewishStatuses?.attribution?.show !== false) ? false : true } })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: settings?.jewishStatuses?.attribution?.show !== false ? "#34C759" : t.primaryLight, cursor: "pointer", marginBottom: 8 }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: settings?.jewishStatuses?.attribution?.show !== false ? "#34C759" : t.border, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: settings?.jewishStatuses?.attribution?.show !== false ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: settings?.jewishStatuses?.attribution?.show !== false ? "#fff" : t.text }}>
                {settings?.jewishStatuses?.attribution?.show !== false ? "ATTRIBUTION SHOWN (default)" : "ATTRIBUTION HIDDEN"}
              </span>
            </div>
            <input
              value={settings?.jewishStatuses?.attribution?.text || ""}
              onChange={(e) => updateJewish({ attribution: { ...(settings?.jewishStatuses?.attribution || {}), text: e.target.value } })}
              placeholder="Attribution text (leave blank for default wording)"
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 12.5, color: t.text, background: t.bg, outline: "none", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={settings?.jewishStatuses?.attribution?.jewishStatusLink || ""}
                onChange={(e) => updateJewish({ attribution: { ...(settings?.jewishStatuses?.attribution || {}), jewishStatusLink: e.target.value } })}
                placeholder="JewishStatus link"
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 12.5, color: t.text, background: t.bg, outline: "none" }}
              />
              <input
                value={settings?.jewishStatuses?.attribution?.yidStatusLink || ""}
                onChange={(e) => updateJewish({ attribution: { ...(settings?.jewishStatuses?.attribution || {}), yidStatusLink: e.target.value } })}
                placeholder="YidStatus link"
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 12.5, color: t.text, background: t.bg, outline: "none" }}
              />
            </div>

            {/* Per-source toggles */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Sources</div>
            {[["jewishStatus", "JewishStatus"], ["yidStatus", "YidStatus"]].map(([key, label]) => {
              const on = settings?.jewishStatuses?.sources?.[key]?.enabled === true;
              return (
                <div key={key} onClick={() => toggleJewishSource(key)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: on ? "#34C759" : t.primaryLight, cursor: "pointer", marginTop: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: on ? "#fff" : t.text }}>{label}</span>
                  <div style={{ width: 42, height: 24, borderRadius: 12, background: on ? "#fff" : t.border, position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: on ? "#34C759" : "#fff", position: "absolute", top: 3, left: on ? 21 : 3, transition: "left 0.15s" }} />
                  </div>
                </div>
              );
            })}

            {/* Category toggles */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, margin: "16px 0 6px" }}>Categories</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {JEWISH_CATEGORIES.map((cat) => {
                const on = settings?.jewishStatuses?.categories?.[cat] !== false;
                return (
                  <div
                    key={cat}
                    onClick={() => toggleJewishCategory(cat)}
                    style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: on ? t.primary : t.bg, color: on ? t.bubbleMeText : t.text, border: `1px solid ${on ? t.primary : t.border}`, textTransform: "capitalize" }}
                  >
                    {cat}{on ? "" : " (hidden)"}
                  </div>
                );
              })}
            </div>

            {/* Blocked creators manager */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, margin: "16px 0 6px" }}>Blocked creators</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={creatorInput}
                onChange={(e) => setCreatorInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addBlockedCreator(); }}
                placeholder="Creator id / name"
                style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, boxSizing: "border-box", color: t.text, background: t.bg, outline: "none" }}
              />
              <button onClick={addBlockedCreator} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Add</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {(settings?.jewishStatuses?.blockedCreators || []).length === 0 && (
                <div style={{ fontSize: 12, color: t.textMuted }}>No blocked creators.</div>
              )}
              {(settings?.jewishStatuses?.blockedCreators || []).map((c) => (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: t.bg, border: `1px solid ${t.border}`, marginTop: 6 }}>
                  <span style={{ flex: 1, fontSize: 13, color: t.text }}>{c}</span>
                  <span onClick={() => removeBlockedCreator(c)} style={{ fontSize: 18, color: "#FF3B30", cursor: "pointer", lineHeight: 1 }}>×</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Music admin section (lives under globalSettings.music) ── */}
          <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Volume2 size={18} color={t.primary} />
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Music</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
              Choose the active background-music provider for status posts. "Disabled" turns music off for everyone.
            </div>

            {/* Active Provider 3-way selector */}
            <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Active Provider</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["disabled", "Disabled"], ["zemer", "Zemer"], ["apple", "Apple"]].map(([key, label]) => (
                <div
                  key={key}
                  onClick={() => setMusicProvider(key)}
                  style={{ flex: 1, textAlign: "center", padding: "11px 8px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1px solid ${musicProvider === key ? t.primary : t.border}`, background: musicProvider === key ? t.primary : t.bg, color: musicProvider === key ? "#fff" : t.text }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Allow users to pick provider */}
            <div onClick={() => updateMusic({ allowUserProviderChoice: !allowUserChoice })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: allowUserChoice ? "#34C759" : t.primaryLight, cursor: "pointer", margin: "12px 0" }}>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: allowUserChoice ? "#34C759" : t.border, position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: allowUserChoice ? 23 : 3, transition: "left 0.15s" }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: allowUserChoice ? "#fff" : t.text }}>Let users choose provider</span>
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4, lineHeight: 1.4 }}>
              When ON, the Add Music picker lets each user switch between the enabled providers (Zemer / Apple) instead of being forced to use the active one above.
            </div>

            {/* Zemer note (always present) */}
            <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}` }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 4 }}>Zemer</div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>
                Zemer search uses search.zemer.io and playback is via YouTube embeds. No extra toggles required.
              </div>
            </div>

            {/* Apple settings (always present) */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.border}` }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Apple Music</div>
              <div onClick={toggleAppleEnabled} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: appleEnabled ? "#34C759" : t.primaryLight, cursor: "pointer", marginBottom: 8 }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: appleEnabled ? "#34C759" : t.border, position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: appleEnabled ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: appleEnabled ? "#fff" : t.text }}>
                  {appleEnabled ? "APPLE MUSIC ACCESS ON" : "APPLE MUSIC ACCESS OFF"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                Per-user Apple access overrides live on each user's detail page (Apple Music Access selector).
              </div>

              {/* Apple Search Whitelist */}
              <div style={{ fontWeight: 600, fontSize: 13, color: t.text, margin: "14px 0 6px" }}>Apple Search Whitelist</div>
              <div onClick={toggleAppleWhitelistMode} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: appleWhitelist.mode === "whitelist" ? "#34C759" : t.primaryLight, cursor: "pointer", marginBottom: 8 }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: appleWhitelist.mode === "whitelist" ? "#34C759" : t.border, position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: appleWhitelist.mode === "whitelist" ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: appleWhitelist.mode === "whitelist" ? "#fff" : t.text }}>
                  {appleWhitelist.mode === "whitelist" ? "WHITELIST ONLY" : "ALL RESULTS"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                {appleWhitelist.mode === "whitelist"
                  ? `Whitelist mode ON — ${((appleWhitelist.rules || []).filter((r) => r.enabled !== false)).length} enabled rule(s). Only matching tracks appear in Apple search.`
                  : `Whitelist mode OFF — all Apple search results are shown (${(appleWhitelist.rules || []).length} rule(s) defined but inactive).`}
              </div>

              {/* Add rule form */}
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <select value={whitelistType} onChange={(e) => setWhitelistType(e.target.value)} style={{ padding: "9px 8px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, background: t.bg, color: t.text, cursor: "pointer" }}>
                  {["artist", "album", "track", "genre", "keyword", "artistId", "trackId"].map((tp) => (
                    <option key={tp} value={tp}>{tp}</option>
                  ))}
                </select>
                <input
                  value={whitelistValue}
                  onChange={(e) => setWhitelistValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addWhitelistRule(); }}
                  placeholder={whitelistType.endsWith("Id") ? "ID" : "Value"}
                  style={{ flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, background: t.bg, color: t.text, outline: "none" }}
                />
                <button onClick={addWhitelistRule} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Add</button>
              </div>

              {/* Rule list */}
              <div>
                {((appleWhitelist.rules || []).length === 0) && (
                  <div style={{ fontSize: 12, color: t.textMuted }}>No rules yet.</div>
                )}
                {(appleWhitelist.rules || []).map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t.bg, border: `1px solid ${t.border}`, marginTop: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>{r.type}</div>
                      <div style={{ fontSize: 12, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.value}</div>
                    </div>
                    <div onClick={() => toggleWhitelistRule(r.id)} style={{ padding: "5px 9px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: "pointer", background: r.enabled !== false ? "#E5F9E7" : t.border, color: r.enabled !== false ? "#28A745" : t.textMuted }}>
                      {r.enabled !== false ? "ON" : "OFF"}
                    </div>
                    <Trash2 size={15} color="#FF3B30" onClick={() => deleteWhitelistRule(r.id)} style={{ cursor: "pointer", flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Music Downloads */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.border}` }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: t.text, marginBottom: 6 }}>Music Downloads</div>
              <div onClick={toggleDownloads} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: downloadsEnabled ? "#34C759" : t.primaryLight, cursor: "pointer", marginBottom: 8 }}>
                <div style={{ width: 46, height: 26, borderRadius: 13, background: downloadsEnabled ? "#34C759" : t.border, position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: downloadsEnabled ? 23 : 3, transition: "left 0.15s" }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: downloadsEnabled ? "#fff" : t.text }}>
                  {downloadsEnabled ? "DOWNLOADS ON" : "DOWNLOADS OFF"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>
                This only grants the <em>permission</em>. Both Apple and Zemer forbid downloading their streams (Apple preview terms; YouTube ToS), so the UI shows why a download isn't available per provider. Per-user overrides live on each user's detail page.
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
