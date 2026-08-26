import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, Settings, Camera, Plus, Users, Star, Archive, BellOff, X, Smartphone, Lock, Trash2, Check, CheckCheck, MessageCircle, Info, Image as ImageIcon, Mic, ChevronLeft, ChevronRight, Megaphone, ArrowDownWideNarrow, Pin } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { useChats, toggleArchive, toggleFavorite, toggleLocked, togglePinned, deleteChatCompletely } from "../firebase/chats";
import { useContacts, searchUsersByUsername, sendContactRequest, acceptContactRequest, getContactDisplayName } from "../firebase/contacts";
import { sendMediaMessage, getOrCreateDirectChat } from "../firebase/chats";
import { usePresence, formatLastSeen } from "../firebase/presence";
import { useStatuses, postStatus } from "../firebase/status";
import { useSystemConfigHook, getAIContact, AI_CONTACT_UID } from "../firebase/ai";
import { useBroadcastLists, createBroadcastList, deleteBroadcastList, sendBroadcastText } from "../firebase/broadcast";
import { useGlobalSettings } from "../firebase/config-settings";

const VIEWED_KEY = "nextext_status_viewed";
function getStoredViewed() {
  try { const raw = localStorage.getItem(VIEWED_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
import { uploadChatFile } from "../supabase/media";
import Avatar from "../components/Avatar";
import AISidebarWidget from "../components/AISidebarWidget";
import NewGroupScreen from "./NewGroupScreen";
import FindFriendsScreen from "./FindFriendsScreen";
import { doc, onSnapshot, updateDoc, collection, getCountFromServer } from "firebase/firestore";
import { db } from "../firebase/config";

const GLOBAL_CAMERA_FILTERS = [
  { id: "none", label: "None", css: "" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.05)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.85)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.8) contrast(1.1)" },
  { id: "cool", label: "Cool", css: "hue-rotate(180deg) saturate(1.2)" },
  { id: "warm", label: "Warm", css: "sepia(0.35) saturate(1.4) hue-rotate(-15deg)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.6) brightness(0.9)" },
  { id: "pop", label: "Pop", css: "saturate(2) contrast(1.3)" },
  { id: "vintage", label: "Vintage", css: "sepia(0.55) contrast(1.2) saturate(1.3) brightness(1.05)" },
  { id: "bw", label: "B&W", css: "grayscale(1) brightness(1.1)" },
];

function highlightText(text, query, color) {
  if (!query.trim() || !text) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) => part.toLowerCase() === query.toLowerCase()
    ? React.createElement("span", { key: i, style: { background: color + "44", color: color, fontWeight: 700, borderRadius: 3, padding: "0 2px" } }, part)
    : part);
}

function ChatRowMeta({ myUid, otherUid, chatId, t, compact, isGroup }) {
  const presence = usePresence(otherUid, myUid);
  const [theyTyping, setTheyTyping] = useState(false);
  const [theyRecordingVoice, setTheyRecordingVoice] = useState(false);

  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, "chats", chatId), (snap) => {
      const map = snap.data()?.typingUsers || {};
      const others = Object.entries(map).filter(([uid]) => uid !== myUid);
      if (others.length > 0) {
        const mostRecent = others.reduce((a, b) => (a[1]?.toMillis?.() || 0) > (b[1]?.toMillis?.() || 0) ? a : b);
        const age = Date.now() - (mostRecent[1]?.toMillis?.() || 0);
        if (age < 5000) {
          setTheyTyping(true);
          const timer = setTimeout(() => setTheyTyping(false), 5000 - age);
          return () => clearTimeout(timer);
        }
      }
      setTheyTyping(false);
      const vrMap = snap.data()?.voiceRecordingUsers || {};
      const vrOthers = Object.entries(vrMap).filter(([uid]) => uid !== myUid);
      if (vrOthers.length > 0) {
        const vrMostRecent = vrOthers.reduce((a, b) => (a[1]?.toMillis?.() || 0) > (b[1]?.toMillis?.() || 0) ? a : b);
        const vrAge = Date.now() - (vrMostRecent[1]?.toMillis?.() || 0);
        if (vrAge < 10000) {
          setTheyRecordingVoice(true);
          const timer = setTimeout(() => setTheyRecordingVoice(false), 10000 - vrAge);
          return () => clearTimeout(timer);
        }
      }
      setTheyRecordingVoice(false);
    });
    return unsub;
  }, [chatId, myUid]);

  if (theyRecordingVoice) {
    return (
      <div style={{ fontSize: compact ? 11 : 12, color: t.textMuted, marginTop: compact ? 0 : 1, display: "flex", alignItems: "center", gap: 4 }}>
        <Mic size={compact ? 10 : 12} className="nextext-mic-waver" color="#2BB579" />
        <span>recording voice…</span>
      </div>
    );
  }
  const statusText = isGroup ? (theyTyping ? "typing…" : "") : (theyTyping ? "typing…" : presence.visible ? (presence.isOnline ? "online" : formatLastSeen(presence.lastSeen)) : "");
  if (!statusText) return null;
  return <div style={{ fontSize: compact ? 11 : 12, color: t.textMuted, marginTop: compact ? 0 : 1 }}>{statusText}</div>;
}

export default function ChatListScreen({ myUid, userDoc, onOpenChat, onOpenGroupInfo, onOpenSettings, onOpenAI, showAIWidget = false, hideNav, navTab, compactList, searchMode = "visible", topBarVisible = true, searchBarScale = 1, isActiveTab = true }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const { chats } = useChats(myUid);
  const { contacts } = useContacts(myUid);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [showFindFriends, setShowFindFriends] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  // Default to "all" (or "groups" on the dedicated Groups tab) but ALWAYS honor
  // a tap on a filter chip — previously when navTab was "groups", clicking
  // Unread/Favorites/etc. updated the highlight but didn't actually filter,
  // because effectiveTab was unconditionally forced to "groups" (the
  // "filter buttons do nothing" bug).
  const effectiveTab = navTab === "status"
    ? "all"
    : navTab === "groups"
      ? (activeTab === "groups" || activeTab === "all" ? "groups" : activeTab)
      : activeTab;
  const [showArchived, setShowArchived] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const [showSearch, setShowSearch] = useState(() => searchMode === "visible");
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenuChat, setContextMenuChat] = useState(null);
  // When the user locks a chat but no locked-chats password exists yet, we
  // prompt them to create one before the lock takes effect.
  const [lockPassSetupChat, setLockPassSetupChat] = useState(null);
  const [lockPassInput, setLockPassInput] = useState("");
  const [lockPassConfirm, setLockPassConfirm] = useState("");
  const [lockPassError, setLockPassError] = useState("");
  // Unlocking an already-locked chat requires the locked-chats password.
  const [unlockPassChat, setUnlockPassChat] = useState(null);
  const [unlockPassInput, setUnlockPassInput] = useState("");
  const [unlockPassError, setUnlockPassError] = useState("");
  const tryUnlock = () => {
    const val = unlockPassInput.trim();
    if (!val) { setUnlockPassError("Enter the password."); return; }
    if (val !== lockedChatsPassword) { setUnlockPassError("Wrong password."); return; }
    toggleLocked(unlockPassChat.id, myUid, true).catch((e) => setMenuError(e?.message || "Couldn't unlock chat."));
    setUnlockPassChat(null);
    setUnlockPassInput("");
  };
  const [menuError, setMenuError] = useState("");
  const [groupMenu, setGroupMenu] = useState(null);
  const [groupPictureFullscreen, setGroupPictureFullscreen] = useState(null);
  const [showGlobalCamera, setShowGlobalCamera] = useState(false);
  const [globalCameraError, setGlobalCameraError] = useState("");
  const [globalCameraMode, setGlobalCameraMode] = useState("photo"); // "photo" | "video"
  const [globalCameraFacing, setGlobalCameraFacing] = useState("environment"); // "environment" | "user"
  const [globalCameraFilter, setGlobalCameraFilter] = useState(0);
  const [capturedMedia, setCapturedMedia] = useState(null); // { type:"image"|"video", blob, url, ext, mime }
  const [recording, setRecording] = useState(false);
  const [postingStatus, setPostingStatus] = useState(false);
  const [globalCameraZoom, setGlobalCameraZoom] = useState(1);
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const pinchStartRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [cameraPreviewStep, setCameraPreviewStep] = useState(false);
  const [cameraCaption, setCameraCaption] = useState("");
  const [customLists, setCustomLists] = useState(() => {
    try { const raw = localStorage.getItem("nextext_custom_lists"); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState("");
  const globalCameraVideoRef = useRef(null);
  const globalCameraStreamRef = useRef(null);
  const longPressStartRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);
  const sysConfig = useSystemConfigHook();
  const { lists: broadcastLists } = useBroadcastLists(myUid);
  const [showNewBroadcast, setShowNewBroadcast] = useState(false);
  const [newBroadcastName, setNewBroadcastName] = useState("");
  const [newBroadcastMembers, setNewBroadcastMembers] = useState([]);
  const [composingBroadcast, setComposingBroadcast] = useState(null);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastStatus, setBroadcastStatus] = useState("");
  // Declared before the lockedContactUids computation below (which references
  // it) to avoid a temporal dead zone crash on render.
  const [lockedChatsUnlocked, setLockedChatsUnlocked] = useState(false);
  const lockedChatsPassword = localStorage.getItem("nextext_locked_chats_password") || "";

  // Global settings for hiding filter/share buttons
  const showFilterButtons = !globalSettings?.hideFilterButton;
  const showShareButton = !globalSettings?.hideShareButton;

  // A contact whose direct chat is locked is hidden from the contacts list
  // so the user can't bypass the lock by tapping the chat icon next to their
  // name. Locked chats are only reachable by typing the lock password in search.
  // When lockedChatsUnlocked is true, the user has entered the password in search,
  // so we temporarily allow the unlocked chats and their contacts to show.
  const lockedContactUids = new Set(
    lockedChatsUnlocked ? [] : chats.filter((c) => c.lockedBy?.[myUid] && c.type !== "group")
      .map((c) => (c.participants || []).find((p) => p !== myUid))
      .filter(Boolean)
  );
  const acceptedContacts = contacts.filter((c) => c.status === "accepted" && !lockedContactUids.has(c.uid));
  const pendingContacts = contacts.filter((c) => c.status === "pending");
  const contactUids = acceptedContacts.map((c) => c.uid);
  const allStatusUids = [myUid, ...contactUids];
  const allStatuses = useStatuses(allStatusUids);
  const activeStatusUids = new Set(allStatuses.map((s) => s.ownerId));
  const viewedMap = getStoredViewed();

  const handleAccept = async (theirUid) => {
    setAcceptError("");
    try { await acceptContactRequest(myUid, theirUid); }
    catch (e) { setAcceptError("Couldn't accept: " + e.message); }
  };

  const handleMarkAllRead = async () => {
    const unreadChats = notArchived.filter((c) => c.unreadCount?.[myUid] > 0);
    await Promise.all(unreadChats.map((c) => updateDoc(doc(db, "chats", c.id), { [`unreadCount.${myUid}`]: 0 })));
  };

  const selfContact = userDoc ? {
    uid: myUid,
    profile: {
      displayName: userDoc.displayName || "Me",
      photoURL: userDoc.photoURL || null,
    },
  } : null;

  // ── Contact sorting ────────────────────────────────────────
  const CONTACT_SORT_OPTIONS = [
    { key: "alpha", label: "Alphabetical" },
    { key: "recent", label: "Last contacted" },
    { key: "oldest", label: "Oldest" },
    { key: "popular", label: "Popular" },
    { key: "newest", label: "Recently added" },
  ];
  const [contactSort, setContactSort] = useState(() => {
    try {
      const v = localStorage.getItem("nextext_contact_sort");
      return v && CONTACT_SORT_OPTIONS.some((o) => o.key === v) ? v : "recent";
    } catch { return "recent"; }
  });
  const [showSortMenu, setShowSortMenu] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("nextext_contact_sort", contactSort); } catch {}
  }, [contactSort]);

  const CHAT_SORT_OPTIONS = [
    { key: "recent", label: "Most recent" },
    { key: "unread", label: "Unread first" },
    { key: "alpha", label: "Alphabetical" },
    { key: "favorites", label: "Favorites first" },
  ];
  const [chatSort, setChatSort] = useState(() => {
    try {
      const v = localStorage.getItem("nextext_chat_sort");
      return v && CHAT_SORT_OPTIONS.some((o) => o.key === v) ? v : "recent";
    } catch { return "recent"; }
  });
  const [showChatSortMenu, setShowChatSortMenu] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("nextext_chat_sort", chatSort); } catch {}
  }, [chatSort]);
  useEffect(() => {
    const handler = () => {
      try {
        const v = localStorage.getItem("nextext_chat_sort");
        if (v && CHAT_SORT_OPTIONS.some((o) => o.key === v)) setChatSort(v);
      } catch {}
    };
    window.addEventListener("nextext-chat-sort-change", handler);
    return () => window.removeEventListener("nextext-chat-sort-change", handler);
  }, []);
  // Settings can change the sort while the chat list is already mounted —
  // listen for the custom event and pick up the new value.
  useEffect(() => {
    const handler = () => {
      try {
        const v = localStorage.getItem("nextext_contact_sort");
        if (v && CONTACT_SORT_OPTIONS.some((o) => o.key === v)) setContactSort(v);
      } catch {}
    };
    window.addEventListener("nextext-contact-sort-change", handler);
    return () => window.removeEventListener("nextext-contact-sort-change", handler);
  }, []);
  // Close sort menus when this tab is no longer active (prevents menus from
  // sticking into other pages like Status or Settings when swiping).
  useEffect(() => {
    if (!isActiveTab) {
      setShowChatSortMenu(false);
      setShowSortMenu(false);
    }
  }, [isActiveTab]);

  // "Popular" ranks by total messages exchanged per direct chat. Counts come
  // from a cheap server-side aggregation, refreshed each time this sort is
  // active (cache lives in component state for the session).
  const [msgCounts, setMsgCounts] = useState({});
  useEffect(() => {
    if (contactSort !== "popular" || !myUid) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(acceptedContacts.map(async (c) => {
        try {
          const snap = await getCountFromServer(collection(db, "chats", [myUid, c.uid].sort().join("_"), "messages"));
          return [c.uid, snap.data().count];
        } catch { return [c.uid, 0]; }
      }));
      if (!cancelled) setMsgCounts(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [contactSort, myUid]);

  const chatTimeOf = (uid) => {
    const chat = chats.find((ch) => ch.id === [myUid, uid].sort().join("_"));
    return chat?.lastMessage?.sentAt?.toMillis?.() || 0;
  };
  const sortedContacts = [...acceptedContacts].sort((a, b) => {
    const name = (c) => (getContactDisplayName(c) || "").toLowerCase();
    switch (contactSort) {
      case "alpha":
        return name(a).localeCompare(name(b));
      case "oldest":
        return (a.addedAt?.toMillis?.() || 0) - (b.addedAt?.toMillis?.() || 0);
      case "newest":
        return (b.addedAt?.toMillis?.() || 0) - (a.addedAt?.toMillis?.() || 0);
      case "popular":
        return (msgCounts[b.uid] || 0) - (msgCounts[a.uid] || 0) || name(a).localeCompare(name(b));
      case "recent":
      default:
        return chatTimeOf(b.uid) - chatTimeOf(a.uid);
    }
  });

  const saveCustomLists = (lists) => {
    setCustomLists(lists);
    localStorage.setItem("nextext_custom_lists", JSON.stringify(lists));
  };

  const handleCreateCustomList = () => {
    const name = newListName.trim();
    if (!name) return;
    const updated = [...customLists, { name, id: Date.now().toString() }];
    saveCustomLists(updated);
    setNewListName("");
    setShowNewListModal(false);
    setActiveTab(`custom_${updated[updated.length - 1].id}`);
  };

  const handleDeleteCustomList = (listId) => {
    const updated = customLists.filter((l) => l.id !== listId);
    saveCustomLists(updated);
    if (activeTab === `custom_${listId}`) setActiveTab("all");
  };

  const toggleBroadcastMember = (uid) => {
    setNewBroadcastMembers((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));
  };

  const handleCreateBroadcast = async () => {
    const name = newBroadcastName.trim();
    if (!name || newBroadcastMembers.length === 0) return;
    setBroadcastBusy(true);
    setBroadcastStatus("");
    try {
      await createBroadcastList(myUid, name, newBroadcastMembers);
      setShowNewBroadcast(false);
      setNewBroadcastName("");
      setNewBroadcastMembers([]);
    } catch (e) {
      setBroadcastStatus("Couldn't create broadcast: " + (e.message || "unknown error"));
    }
    setBroadcastBusy(false);
  };

  const handleSendBroadcast = async () => {
    if (!composingBroadcast || !broadcastMsg.trim()) return;
    setBroadcastBusy(true);
    setBroadcastStatus("");
    try {
      const { sent, failed } = await sendBroadcastText(myUid, composingBroadcast.memberUids || [], broadcastMsg.trim());
      if (failed.length === 0) setBroadcastStatus(`Sent to ${sent.length} ${sent.length === 1 ? "chat" : "chats"}.`);
      else setBroadcastStatus(`Sent to ${sent.length}, failed for ${failed.length}.`);
      setBroadcastMsg("");
    } catch (e) {
      setBroadcastStatus("Couldn't send broadcast: " + (e.message || "unknown error"));
    }
    setBroadcastBusy(false);
  };

  const isMutedNow = (chat) => {
    const val = chat.mutedBy?.[myUid];
    if (!val) return false;
    if (val === "forever") return true;
    return val?.toMillis?.() > Date.now();
  };

  const notArchived = chats.filter((c) => !(c.archivedBy || []).includes(myUid));
  const archived = chats.filter((c) => (c.archivedBy || []).includes(myUid));

  const chatDisplayName = (chat) => {
    if (chat.id?.startsWith("ai_")) return "NexText AI";
    if (chat.type === "group") return chat.groupName;
    const participants = chat.participants || [myUid];
    const otherUid = participants.find((p) => p !== myUid) || myUid;
    if (otherUid === myUid) return selfContact?.profile?.displayName || "Me (You)";
    const contact = acceptedContacts.find((ac) => ac.uid === otherUid);
    return getContactDisplayName(contact);
  };

  const aiApproved = userDoc?.aiApproved && !sysConfig?.aiGloballyDisabled && !sysConfig?.hideAiEverywhere && userDoc?.restrictions?.blockAI !== true;

  const tabFiltered = (() => {
    let base = notArchived.filter((c) => !c.lockedBy?.[myUid] || lockedChatsUnlocked);
    if (effectiveTab === "unread") base = base.filter((c) => c.unreadCount?.[myUid] > 0);
    if (effectiveTab === "favorites") base = base.filter((c) => (c.favoritedBy || []).includes(myUid));
    if (effectiveTab === "groups") base = base.filter((c) => c.type === "group");
    if (searchQuery.trim()) {
      if (lockedChatsPassword && searchQuery === lockedChatsPassword && !lockedChatsUnlocked) {
        setLockedChatsUnlocked(true);
        setSearchQuery("");
      } else {
        const q = searchQuery.toLowerCase();
        base = base.filter((c) => chatDisplayName(c)?.toLowerCase().includes(q) || c.lastMessage?.text?.toLowerCase().includes(q));
      }
    }
    return base;
  })();

  const chatSortTime = (c) => c.lastMessage?.sentAt?.toMillis?.() || 0;
  // Pinned chats always sort to the top, regardless of the chosen sort mode.
  const pinCmp = (a, b) => ((b.pinnedBy || []).includes(myUid) ? 1 : 0) - ((a.pinnedBy || []).includes(myUid) ? 1 : 0);
  const sortedChats = (() => {
    const list = [...tabFiltered];
    switch (chatSort) {
      case "alpha":
        return list.sort((a, b) => pinCmp(a, b) || (chatDisplayName(a) || "").localeCompare(chatDisplayName(b) || ""));
      case "unread":
        return list.sort((a, b) => pinCmp(a, b) || (b.unreadCount?.[myUid] || 0) - (a.unreadCount?.[myUid] || 0) || chatSortTime(b) - chatSortTime(a));
      case "favorites":
        return list.sort((a, b) => pinCmp(a, b) || ((b.favoritedBy || []).includes(myUid) ? 1 : 0) - ((a.favoritedBy || []).includes(myUid) ? 1 : 0) || chatSortTime(b) - chatSortTime(a));
      case "recent":
      default:
        return list.sort((a, b) => pinCmp(a, b) || chatSortTime(b) - chatSortTime(a));
    }
  })();

  const openChatRow = (chat) => {
    setLockedChatsUnlocked(false);
    // Rows are only visible after the locked-chats password was entered in
    // search, so the session is already verified for this chat.
    const openOpts = chat.lockedBy?.[myUid] ? { lockVerified: true } : {};
    if (chat.id?.startsWith("ai_")) {
      onOpenChat(chat, AI_CONTACT_UID, getAIContact(), { isAI: true });
      return;
    }
    if (chat.type === "group") {
      onOpenChat(chat, null, { isGroup: true, groupName: chat.groupName }, openOpts);
    } else {
      const participants = chat.participants || [myUid];
      const otherUid = participants.find((p) => p !== myUid) || myUid;
      if (otherUid === myUid) {
        onOpenChat(chat, myUid, selfContact || { uid: myUid, profile: { displayName: "Me (You)", photoURL: null } }, openOpts);
      } else {
        const contact = acceptedContacts.find((ac) => ac.uid === otherUid);
        onOpenChat(chat, otherUid, contact || { uid: otherUid, profile: { displayName: "Unknown" } }, openOpts);
      }
    }
  };

  // Open a group's detail/info card panel.
  const openGroupInfo = (chat) => {
    if (onOpenGroupInfo) onOpenGroupInfo(chat);
    else onOpenChat(chat, null, { isGroup: true, groupName: chat.groupName });
  };

  const openGlobalCamera = async () => {
    setGlobalCameraError("");
    setGlobalCameraZoom(1);
    try {
      const wantsVideo = globalCameraMode === "video";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: globalCameraFacing },
        audio: wantsVideo,
      });
      globalCameraStreamRef.current = stream;
      setShowGlobalCamera(true);
      setTimeout(() => {
        if (globalCameraVideoRef.current) {
          globalCameraVideoRef.current.srcObject = stream;
          if (wantsVideo) globalCameraVideoRef.current.muted = false;
          globalCameraVideoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setGlobalCameraError("Camera access denied or unavailable.");
    }
  };

  const switchGlobalCameraFacing = () => {
    setGlobalCameraFacing((f) => (f === "environment" ? "user" : "environment"));
    const wasVideo = globalCameraMode === "video";
    if (globalCameraStreamRef.current) {
      globalCameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
      globalCameraStreamRef.current = null;
    }
    // Re-open with the new facing direction. Keep the current mode.
    setTimeout(() => openGlobalCamera(), 50);
  };

  const onCamTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchStartRef.current = {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        zoom: globalCameraZoom,
      };
    }
  };
  const onCamTouchMove = (e) => {
    if (e.touches && e.touches.length === 2 && pinchStartRef.current) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = d / pinchStartRef.current.dist;
      setGlobalCameraZoom(Math.min(4, Math.max(1, pinchStartRef.current.zoom * ratio)));
      if (e.cancelable) e.preventDefault();
    }
  };

  const cycleGlobalFilter = () => {
    setGlobalCameraFilter((i) => (i + 1) % GLOBAL_CAMERA_FILTERS.length);
  };

  const captureGlobalPhoto = () => {
    if (!globalCameraVideoRef.current) return;
    const video = globalCameraVideoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    const cw = canvas.width, ch = canvas.height;
    const filter = GLOBAL_CAMERA_FILTERS[globalCameraFilter]?.css;
    if (filter) ctx.filter = filter;
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    // Mirror the preview for selfie shots so the captured image matches what the user saw.
    if (globalCameraFacing === "user") ctx.scale(-1, 1);
    // Bake the pinch/button zoom into the capture (zoom-in crops toward centre).
    ctx.scale(globalCameraZoom, globalCameraZoom);
    ctx.translate(-cw / 2, -ch / 2);
    ctx.drawImage(video, 0, 0);
    ctx.restore();
    ctx.filter = "none";
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      closeGlobalCamera();
      setCapturedMedia({ type: "image", blob, url, ext: "jpg", mime: "image/jpeg" });
      setCameraCaption("");
      setCameraPreviewStep(true);
    }, "image/jpeg", 0.92);
  };

  const startGlobalRecording = () => {
    if (!globalCameraStreamRef.current || recording) return;
    recordedChunksRef.current = [];
    let recorder;
    try {
      recorder = new MediaRecorder(globalCameraStreamRef.current, { mimeType: "video/webm" });
    } catch {
      try { recorder = new MediaRecorder(globalCameraStreamRef.current); } catch { return; }
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "video/webm" });
      if (!blob.size) return;
      const url = URL.createObjectURL(blob);
      setCapturedMedia({ type: "video", blob, url, ext: "webm", mime: blob.type });
      setCameraCaption("");
      setCameraPreviewStep(true);
      closeGlobalCamera();
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  };

  const stopGlobalRecording = () => {
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const closeGlobalCamera = () => {
    if (recording && mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
      setRecording(false);
    }
    if (globalCameraStreamRef.current) {
      globalCameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
      globalCameraStreamRef.current = null;
    }
    setShowGlobalCamera(false);
  };

  const discardCapturedMedia = () => {
    if (capturedMedia?.url) URL.revokeObjectURL(capturedMedia.url);
    setCapturedMedia(null);
    setCameraCaption("");
    setCameraPreviewStep(false);
    setPostingStatus(false);
    setSelectedRecipients([]);
    setGlobalCameraZoom(1);
  };

  const toggleRecipient = (chat) => {
    setSelectedRecipients((prev) => {
      const key = chat.id || chat.type;
      if (prev.some((p) => (p.id || p.type) === key)) return prev.filter((p) => (p.id || p.type) !== key);
      return [...prev, chat];
    });
  };

  const sendToSelectedRecipients = async () => {
    const targets = selectedRecipients;
    if (!targets.length || !capturedMedia) return;
    setSelectedRecipients([]);
    const media = capturedMedia;
    discardCapturedMedia();
    for (const target of targets) {
      let chatId = target.id;
      if (target.type !== "group") {
        const otherUid = target.participants?.find((p) => p !== myUid);
        chatId = await getOrCreateDirectChat(myUid, otherUid);
      }
      const file = new File([media.blob], `camera-${Date.now()}.${media.ext}`, { type: media.mime });
      try {
        const result = await uploadChatFile(chatId, myUid, file, { compress: media.type !== "video" });
        const participants = target.participants || [];
        await sendMediaMessage(chatId, myUid, media.type, result, participants);
      } catch { /* keep going */ }
    }
    if (targets[0]) openChatRow(targets[0]);
  };

  const sendCapturedMediaTo = async (targetChat) => {
    if (!capturedMedia || !myUid) return;
    const media = capturedMedia;
    discardCapturedMedia();
    let chatId = targetChat.id;
    if (targetChat.type !== "group") {
      const otherUid = targetChat.participants?.find((p) => p !== myUid);
      chatId = await getOrCreateDirectChat(myUid, otherUid);
    }
    const file = new File([media.blob], `camera-${Date.now()}.${media.ext}`, { type: media.mime });
    try {
      const result = await uploadChatFile(chatId, myUid, file, { compress: media.type !== "video" });
      const participants = targetChat.participants || [];
      await sendMediaMessage(chatId, myUid, media.type, result, participants);
      openChatRow(targetChat);
    } catch {
      // silent
    }
  };

  const postCapturedMediaToStatus = async () => {
    if (!capturedMedia || !myUid) return;
    setPostingStatus(true);
    try {
      const media = capturedMedia;
      const file = new File([media.blob], `status-${Date.now()}.${media.ext}`, { type: media.mime });
      const result = await uploadChatFile(`status-${myUid}`, myUid, file, { compress: media.type !== "video" });
      let durationMs = null;
      if (media.type === "video") {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = media.url;
        await new Promise((res) => {
          v.onloadedmetadata = () => { durationMs = Math.round(v.duration * 1000); res(); };
          v.onerror = () => res();
        });
      }
      await postStatus(myUid, {
        text: cameraCaption.trim() || null,
        mediaURL: result.url,
        mediaType: media.type,
        backgroundColor: null,
        fontFamily: null,
        durationMs: durationMs || 8000,
        textOverlay: cameraCaption.trim() || null,
        waitForVideo: media.type === "video",
      });
      discardCapturedMedia();
    } catch {
      setPostingStatus(false);
    }
  };

  const formatTime = (ts) => {
    if (!ts?.toDate) return "";
    const d = ts.toDate();
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleRowTouchStart = useCallback((c, e) => {
    const t0 = e.touches[0];
    longPressStartRef.current = { x: t0.clientX, y: t0.clientY };
    longPressFiredRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      setContextMenuChat(c);
    }, 450);
  }, [clearLongPressTimer]);

  const handleRowTouchMove = useCallback((e) => {
    const start = longPressStartRef.current;
    if (!start) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) clearLongPressTimer();
  }, [clearLongPressTimer]);

  const handleRowTouchEnd = useCallback(() => {
    clearLongPressTimer();
    longPressStartRef.current = null;
  }, [clearLongPressTimer]);

  const handleRowClick = (c) => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    openChatRow(c);
  };

  const renderChatRow = (c) => {
    const otherUid = c.participants?.find((p) => p !== myUid);
    const otherContact = acceptedContacts.find((ac) => ac.uid === otherUid);
    const avatarSize = compactList ? 40 : 52;
    const rowPadding = compactList ? "8px 16px" : "13px 16px";
    const nameSize = compactList ? 14.5 : 15.5;
    const msgSize = compactList ? 12.5 : 13.5;
    const badgeSize = compactList ? 12 : 14;
    const gap = compactList ? 10 : 13;
    return (
    <div key={c.id} style={{ position: "relative", overflow: "hidden", marginBottom: 1 }}>
      <div
        onTouchStart={(e) => handleRowTouchStart(c, e)}
        onTouchMove={handleRowTouchMove}
        onTouchEnd={handleRowTouchEnd}
        onTouchCancel={handleRowTouchEnd}
        onClick={() => handleRowClick(c)}
        className="nextext-chat-row"
        style={{ display: "flex", alignItems: "center", gap, padding: rowPadding, cursor: "pointer", background: t.bg, position: "relative", zIndex: 1, touchAction: "pan-y" }}
      >
      {c.type === "group" ? (
        <div style={{ position: "relative", width: avatarSize, height: avatarSize, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); setGroupMenu(c); }}>
          {c.groupPhotoURL ? (
            <img src={c.groupPhotoURL} alt="" style={{ width: avatarSize, height: avatarSize, borderRadius: "50%", objectFit: "cover", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }} />
          ) : (
            <div style={{ width: avatarSize, height: avatarSize, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <Users size={compactList ? 18 : 22} color={t.primary} />
            </div>
          )}
          {c.unreadCount?.[myUid] > 0 && (
            <div style={{ position: "absolute", top: 0, right: 0, width: badgeSize, height: badgeSize, borderRadius: "50%", background: "#FF3B30", border: `2px solid ${t.bg}` }} />
          )}
        </div>
      ) : (
        <div style={{ position: "relative", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <Avatar
            photoURL={otherContact?.profile?.photoURL}
            name={chatDisplayName(c)}
            uid={otherUid}
            size={avatarSize}
            hasActiveStatus={activeStatusUids.has(otherUid)}
            statusViewed={!!viewedMap[otherUid]}
            blockStatus={!!userDoc?.restrictions?.blockStatus}
            onStatusView={() => {
              const items = allStatuses.filter((s) => s.ownerId === otherUid);
              if (items.length > 0) onOpenChat(null, otherUid, otherContact, { openStatus: items });
            }}
            onViewProfile={() => onOpenChat(null, otherUid, otherContact, { openProfile: true })}
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
          />
          {c.unreadCount?.[myUid] > 0 && (
            <div style={{ position: "absolute", top: 0, right: 0, width: badgeSize, height: badgeSize, borderRadius: "50%", background: "#FF3B30", border: `2px solid ${t.bg}` }} />
          )}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: compactList ? 1 : 3, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1 }}>
            <span style={{ fontWeight: 700, color: t.text, fontSize: nameSize, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{chatDisplayName(c)}</span>
            {(c.pinnedBy || []).includes(myUid) && <Pin size={12} color={t.accent} style={{ flexShrink: 0 }} />}
            {(c.favoritedBy || []).includes(myUid) && <Star size={12} fill={t.accent} color={t.accent} style={{ flexShrink: 0 }} />}
            {isMutedNow(c) && <BellOff size={12} color={t.textMuted} style={{ flexShrink: 0 }} />}
          </div>
          <span style={{ fontSize: 11.5, color: c.unreadCount?.[myUid] > 0 ? t.accent : t.textMuted, fontWeight: c.unreadCount?.[myUid] > 0 ? 700 : 500, flexShrink: 0, marginLeft: 8 }}>
            {formatTime(c.lastMessage?.sentAt)}
          </span>
        </div>
        {<ChatRowMeta myUid={myUid} otherUid={otherUid} chatId={c.id} t={t} compact={compactList} isGroup={c.type === "group"} />}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: msgSize, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {searchQuery.trim() ? highlightText(c.lastMessage?.text || "No messages yet", searchQuery, t.accent) : (c.lastMessage?.text || "No messages yet")}
          </span>
          {c.unreadCount?.[myUid] > 0 && (
            <span style={{ background: t.accent, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 10, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px", flexShrink: 0 }}>
              {c.unreadCount[myUid]}
            </span>
          )}
        </div>
      </div>
      </div>
    </div>
    );
  };

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg }}>
      {topBarVisible && <div style={{ padding: "calc(12px + var(--safe-top)) 16px 6px", background: t.surface, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, position: "relative", zIndex: 1 }}>
        <span style={{ color: t.text, fontWeight: 800, fontSize: 20, flexShrink: 0 }}>NexText</span>
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexShrink: 0 }}>
          <Camera size={20} color={t.text} style={{ cursor: "pointer", display: "block" }} onClick={openGlobalCamera} />
          {searchMode !== "visible" && <Search size={20} color={t.text} style={{ cursor: "pointer", display: "block" }} onClick={() => setShowSearch(!showSearch)} />}
          <Settings size={20} color={t.text} style={{ cursor: "pointer", display: "block" }} onClick={onOpenSettings} />
        </div>
      </div>}

      {(topBarVisible && showSearch) && (
        <div style={{ padding: `0 16px ${Math.round(8 * searchBarScale)}px`, background: t.surface, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", background: t.bg, borderRadius: 9999, padding: `${Math.round(9 * searchBarScale)}px ${Math.round(14 * searchBarScale)}px`, gap: 8, fontSize: `${14 * searchBarScale}px`, transformOrigin: "left center" }}>
            <Search size={Math.round(14 * searchBarScale)} color={t.textMuted} />
            <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search chats and messages…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: `${14 * searchBarScale}px`, color: t.text }} />
            {searchQuery && <X size={Math.round(14 * searchBarScale)} color={t.textMuted} onClick={() => setSearchQuery("")} style={{ cursor: "pointer" }} />}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, flex: 1, overflowX: "auto" }}>
          {[["all", "All"], ["unread", "Unread"], ["favorites", "Favorites"], ["groups", "Groups"], ["broadcast", "Broadcast"], ...customLists.map((l) => [`custom_${l.id}`, l.name])].map(([key, label]) => (
            <div key={key} onClick={() => setActiveTab(key)} style={{ padding: "6px 14px", borderRadius: 16, background: activeTab === key ? t.primary : t.primaryLight, color: activeTab === key ? t.bubbleMeText : t.primary, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {label}
              {key.startsWith("custom_") && (
                <X size={12} onClick={(e) => { e.stopPropagation(); handleDeleteCustomList(key.replace("custom_", "")); }} style={{ cursor: "pointer", opacity: 0.6 }} />
              )}
            </div>
          ))}
        </div>
        {showFilterButtons && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setShowChatSortMenu((v) => !v)}
              title="Sort chats"
              aria-label="Sort chats"
              style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", touchAction: "manipulation" }}
            >
              <ArrowDownWideNarrow size={16} color={t.primary} />
            </button>
            {showChatSortMenu && createPortal(
              <div onClick={() => setShowChatSortMenu(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 300, background: t.surface, borderRadius: 16, padding: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: t.text }}>Sort chats</span>
                    <X size={20} color={t.textMuted} onClick={() => setShowChatSortMenu(false)} style={{ cursor: "pointer" }} />
                  </div>
                  {CHAT_SORT_OPTIONS.map((o) => (
                    <div key={o.key} onClick={() => { setChatSort(o.key); setShowChatSortMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderRadius: 10, fontSize: 13.5, fontWeight: chatSort === o.key ? 700 : 500, color: chatSort === o.key ? t.primary : t.text, cursor: "pointer", background: chatSort === o.key ? t.primaryLight : "transparent" }}>
                      {chatSort === o.key && <span style={{ width: 14, color: t.primary }}>✓</span>}
                      <span style={{ marginLeft: chatSort === o.key ? 0 : 22 }}>{o.label}</span>
                    </div>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>
        )}
        <div onClick={() => setShowNewListModal(true)} style={{ width: 30, height: 30, borderRadius: "50%", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <Plus size={16} color="#fff" />
        </div>
      </div>

      <div className="nx-scroll" style={{ paddingBottom: hideNav ? 80 : 140 }}>
        {notArchived.some((c) => c.unreadCount?.[myUid] > 0) && (
          <div onClick={handleMarkAllRead} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
            <CheckCheck size={15} color={t.primary} />
            <span style={{ fontSize: 12.5, color: t.primary, fontWeight: 600 }}>Mark all as read</span>
          </div>
        )}
        {effectiveTab === "broadcast" ? (
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, color: t.text, fontSize: 16 }}>Broadcast lists</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 2 }}>Send one message to many contacts as individual chats.</div>
              </div>
              <div
                onClick={() => { setShowNewBroadcast(true); setBroadcastStatus(""); }}
                style={{ padding: "9px 14px", borderRadius: 10, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 10 }}
              >
                <Plus size={15} /> New broadcast
              </div>
            </div>
            {broadcastStatus && effectiveTab === "broadcast" && (
              <div style={{ color: broadcastStatus.startsWith("Couldn") ? "#FF3B30" : t.primary, fontSize: 12.5, marginBottom: 10 }}>{broadcastStatus}</div>
            )}
            {broadcastLists.length === 0 && (
              <div style={{ padding: 30, textAlign: "center", color: t.textMuted, fontSize: 13.5, lineHeight: 1.6 }}>
                No broadcast lists yet. Create one to message many contacts at once.
              </div>
            )}
            {broadcastLists.map((b) => (
              <div
                key={b.id}
                onClick={() => { setComposingBroadcast(b); setBroadcastMsg(""); setBroadcastStatus(""); }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 8px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: t.bg }}
              >
                <div style={{ width: 46, height: 46, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Megaphone size={20} color={t.primary} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: t.text, fontSize: 15 }}>{b.name}</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted }}>{(b.memberUids || []).length} recipients</div>
                </div>
                <X
                  size={16}
                  color={t.textMuted}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete broadcast "${b.name}"?`)) deleteBroadcastList(b.id).catch(() => setBroadcastStatus("Couldn't delete broadcast."));
                  }}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            {tabFiltered.length === 0 && !(aiApproved && effectiveTab === "all") && (
              <div style={{ padding: 30, textAlign: "center", color: t.textMuted, fontSize: 13.5, lineHeight: 1.6 }}>
                {effectiveTab === "all" ? "No chats here yet." : `No ${effectiveTab} chats.`}
              </div>
            )}
            {sortedChats.map(renderChatRow)}
          </>
        )}
        {aiApproved && effectiveTab === "all" && (
          <div
            onClick={() => onOpenChat({ id: `ai_${myUid}`, type: "direct", participants: [myUid, AI_CONTACT_UID] }, AI_CONTACT_UID, getAIContact(), { isAI: true })}
            style={{ display: "flex", alignItems: "center", gap: compactList ? 10 : 13, padding: compactList ? "8px 16px" : "13px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: t.bg }}
          >
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{ width: compactList ? 40 : 52, height: compactList ? 40 : 52, borderRadius: "50%", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <span style={{ fontSize: compactList ? 18 : 22 }}>🤖</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: compactList ? 1 : 3 }}>
                <span style={{ fontWeight: 700, color: t.text, fontSize: compactList ? 14.5 : 15.5 }}>NexText AI</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#000", background: "linear-gradient(135deg, #00E676, #00C853)", borderRadius: 6, padding: "1px 6px", marginLeft: 4, letterSpacing: 0.5 }}>NEX-AI</span>
              </div>
              <span style={{ fontSize: 13.5, color: t.textMuted }}>Ask me anything!</span>
            </div>
          </div>
        )}

        {effectiveTab === "all" && archived.length > 0 && (
          <div onClick={() => setShowArchived(true)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
            <div style={{ width: 50, height: 50, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}><Archive size={22} color={t.primary} /></div>
            <span style={{ fontWeight: 600, color: t.textMuted, fontSize: 14 }}>Archived ({archived.length})</span>
            <ChevronRight size={16} color={t.textMuted} style={{ marginLeft: "auto" }} />
          </div>
        )}

        <div style={{ padding: "16px", borderTop: `1px solid ${t.border}`, marginTop: 8 }}>
          {pendingContacts.length > 0 && (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted, marginBottom: 8 }}>PENDING REQUESTS</div>
              {acceptError && <div style={{ color: "#FF3B30", fontSize: 12, marginBottom: 8 }}>{acceptError}</div>}
              {pendingContacts.map((c) => (
                <div key={c.uid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                  <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={36} />
                  <span style={{ fontSize: 14, color: t.text, fontWeight: 600, flex: 1 }}>{c.profile?.displayName || "Unknown"}</span>
                  <button onClick={() => handleAccept(c.uid)} style={{ padding: "6px 14px", borderRadius: 16, border: "none", background: t.primary, color: t.bubbleMeText, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                    Accept
                  </button>
                </div>
              ))}
            </>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted, marginBottom: 8, marginTop: pendingContacts.length > 0 ? 16 : 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>YOUR CONTACTS</span>
            {showFilterButtons && (<div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setShowSortMenu((v) => !v)}
                title="Sort contacts"
                aria-label="Sort contacts"
                style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", touchAction: "manipulation" }}
              >
                <ArrowDownWideNarrow size={16} color={t.primary} />
              </button>
              {showSortMenu && createPortal(
                <div onClick={() => setShowSortMenu(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                  <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 300, background: t.surface, borderRadius: 16, padding: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: t.text }}>Sort contacts</span>
                      <X size={20} color={t.textMuted} onClick={() => setShowSortMenu(false)} style={{ cursor: "pointer" }} />
                    </div>
                    {CONTACT_SORT_OPTIONS.map((o) => (
                      <div key={o.key} onClick={() => { setContactSort(o.key); setShowSortMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderRadius: 10, fontSize: 13.5, fontWeight: contactSort === o.key ? 700 : 500, color: contactSort === o.key ? t.primary : t.text, cursor: "pointer", background: contactSort === o.key ? t.primaryLight : "transparent" }}>
                        {contactSort === o.key && <span style={{ width: 14, color: t.primary }}>✓</span>}
                        <span style={{ marginLeft: contactSort === o.key ? 0 : 22 }}>{o.label}</span>
                      </div>
                    ))}
                  </div>
                </div>,
                document.body
              )}
            </div>)}
          </div>
          {selfContact && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <div onClick={() => onOpenChat(null, myUid, selfContact, { openProfile: true })} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer", minWidth: 0 }}>
                <Avatar photoURL={selfContact.profile?.photoURL} name={selfContact.profile?.displayName} uid={myUid} size={36} onViewProfile={() => onOpenChat(null, myUid, selfContact, { openProfile: true })} />
                <span style={{ fontSize: 14, color: t.text, fontWeight: 600 }}>{selfContact.profile?.displayName} <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 500 }}>(You)</span></span>
              </div>
              <div onClick={() => onOpenChat(null, myUid, selfContact)} style={{ width: 34, height: 34, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} title="Start Chat">
                <MessageCircle size={16} color={t.primary} />
              </div>
            </div>
          )}
          {acceptedContacts.length === 0 && !aiApproved && <div style={{ fontSize: 13, color: t.textMuted }}>No contacts yet.</div>}
          {acceptedContacts.length === 0 && aiApproved && <div style={{ fontSize: 13, color: t.textMuted }}>No contacts yet. Try NexText AI below!</div>}
          {aiApproved && !notArchived.some((c) => c.id?.startsWith("ai_")) && (
            <div onClick={() => onOpenChat({ id: `ai_${myUid}`, type: "direct", participants: [myUid, AI_CONTACT_UID] }, AI_CONTACT_UID, getAIContact(), { isAI: true })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: "pointer" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 18 }}>🤖</span></div>
              <span style={{ fontSize: 14, color: t.text, fontWeight: 600 }}>NexText AI</span>
            </div>
          )}
          {sortedContacts.map((c) => (
            <div key={c.uid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <div onClick={() => onOpenChat(null, c.uid, c, { openProfile: true })} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer", minWidth: 0 }}>
                <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={36} onViewProfile={() => onOpenChat(null, c.uid, c, { openProfile: true })} />
                <span style={{ fontSize: 14, color: t.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.profile?.displayName}</span>
              </div>
              <div onClick={() => onOpenChat(null, c.uid, c)} style={{ width: 34, height: 34, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} title="Start Chat">
                <MessageCircle size={16} color={t.primary} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {showFab && (
        <>
          <div onClick={() => setShowFab(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
          <div style={{ position: "absolute", bottom: hideNav ? 84 : 148, right: 20, background: t.surface, borderRadius: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", overflow: "hidden", zIndex: 10 }}>
            <div onClick={() => { setShowFab(false); setShowNewGroup(true); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", whiteSpace: "nowrap" }}>
              <Users size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>New group</span>
            </div>
            <div onClick={() => { setShowFab(false); setShowAddContact(true); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", whiteSpace: "nowrap", borderTop: `1px solid ${t.border}` }}>
              <Plus size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Add contact</span>
            </div>
            <div onClick={() => { setShowFab(false); setShowFindFriends(true); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", whiteSpace: "nowrap", borderTop: `1px solid ${t.border}` }}>
              <Smartphone size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Find friends from contacts</span>
            </div>
          </div>
        </>
      )}
      <button onClick={() => setShowFab(!showFab)} style={{ position: "absolute", bottom: hideNav ? 20 : 84, right: 20, width: 54, height: 54, borderRadius: "50%", background: t.accent, border: "none", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.25)", cursor: "pointer", zIndex: 10 }}>
        <Plus size={26} color="#fff" style={{ transform: showFab ? "rotate(45deg)" : "none", transition: "transform 0.2s" }} />
      </button>

      {showAIWidget && !showGlobalCamera && !capturedMedia && !cameraPreviewStep && !showFab && (
        <AISidebarWidget myUid={myUid} userDoc={userDoc} onOpenAI={onOpenAI} right={20} bottom={hideNav ? 148 : 212} />
      )}

      {showAddContact && <AddContactSheet myUid={myUid} onClose={() => setShowAddContact(false)} />}
      {showFindFriends && <FindFriendsScreen myUid={myUid} onBack={() => setShowFindFriends(false)} />}
      {showNewGroup && (
        <NewGroupScreen
          myUid={myUid}
          contacts={acceptedContacts}
          onBack={() => setShowNewGroup(false)}
          onCreated={(chatId) => { setShowNewGroup(false); onOpenChat({ id: chatId, type: "group" }, null, { isGroup: true }); }}
        />
      )}

      {showGlobalCamera && (
        <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 60, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", flexShrink: 0 }}>
            <span onClick={closeGlobalCamera} style={{ color: "#fff", fontSize: 15, cursor: "pointer" }}>Cancel</span>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Camera</span>
            <span style={{ width: 50 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "6px 12px", flexShrink: 0 }}>
            <div style={{ display: "flex", background: "rgba(255,255,255,0.12)", borderRadius: 20, overflow: "hidden" }}>
              {["photo", "video"].map((m) => (
                <span
                  key={m}
                  onClick={() => setGlobalCameraMode(m)}
                  style={{ padding: "6px 16px", fontSize: 13, fontWeight: 700, color: globalCameraMode === m ? "#000" : "#fff", background: globalCameraMode === m ? "#fff" : "transparent", borderRadius: 20, cursor: "pointer", textTransform: "capitalize" }}
                >{m}</span>
              ))}
            </div>
            <span onClick={cycleGlobalFilter} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.12)", borderRadius: 16, cursor: "pointer" }}>
              {GLOBAL_CAMERA_FILTERS[globalCameraFilter]?.label || "None"}
            </span>
            <span onClick={switchGlobalCameraFacing} title="Flip camera" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer" }}>
              <Camera size={18} color="#fff" />
            </span>
            <span onClick={() => setGlobalCameraZoom((z) => Math.max(1, Math.round((z - 0.2) * 10) / 10))} title="Zoom out" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer", fontSize: 20, fontWeight: 700, color: "#fff" }}>−</span>
            <span onClick={() => setGlobalCameraZoom((z) => Math.min(4, Math.round((z + 0.2) * 10) / 10))} title="Zoom in" style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.12)", cursor: "pointer", fontSize: 18, fontWeight: 700, color: "#fff" }}>+</span>
          </div>
          <div
            onTouchStart={onCamTouchStart}
            onTouchMove={onCamTouchMove}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}
          >
            <video ref={globalCameraVideoRef} autoPlay playsInline muted={globalCameraMode !== "video"} style={{ width: "100%", height: "100%", maxHeight: "70vh", objectFit: "contain", transform: `${globalCameraFacing === "user" ? "scaleX(-1) " : ""}scale(${globalCameraZoom})`, transformOrigin: "center center", filter: GLOBAL_CAMERA_FILTERS[globalCameraFilter]?.css }} />
          </div>
          {globalCameraError && <div style={{ color: "#FF3B30", fontSize: 13, textAlign: "center", padding: 8, flexShrink: 0 }}>{globalCameraError}</div>}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 16px calc(env(safe-area-inset-bottom, 0px) + 28px)", flexShrink: 0 }}>
            {globalCameraMode === "photo" ? (
              <div onClick={captureGlobalPhoto} style={{ width: 64, height: 64, borderRadius: "50%", border: "4px solid #fff", background: "rgba(255,255,255,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#fff" }} />
              </div>
            ) : (
              <div onClick={recording ? stopGlobalRecording : startGlobalRecording} style={{ width: 64, height: 64, borderRadius: "50%", border: "4px solid #fff", background: recording ? "#FF3B30" : "rgba(255,255,255,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <div style={{ width: recording ? 26 : 52, height: recording ? 26 : 52, borderRadius: recording ? 6 : "50%", background: "#fff" }} />
              </div>
            )}
          </div>
        </div>
      )}

      {capturedMedia && !cameraPreviewStep && (
        <div style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 60, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
            <span onClick={discardCapturedMedia} style={{ color: t.text, fontSize: 15, cursor: "pointer" }}>Cancel</span>
            <span style={{ color: t.text, fontWeight: 700, fontSize: 16 }}>Send to…</span>
            <span style={{ width: 50 }} />
          </div>
          <div style={{ padding: 16, borderBottom: `1px solid ${t.border}` }}>
            {capturedMedia.type === "video"
              ? <video src={capturedMedia.url} style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover" }} />
              : <img src={capturedMedia.url} alt="Captured" style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover" }} />}
          </div>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${t.border}` }}>
            <div onClick={postCapturedMediaToStatus} style={{ padding: "12px 14px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer", opacity: postingStatus ? 0.6 : 1 }}>
              {postingStatus ? "Posting…" : "Post on Status"}
            </div>
          </div>
      <div className="nx-scroll" style={{ flex: 1, paddingBottom: hideNav ? 80 : 140 }}>
            {acceptedContacts.length === 0 && <div style={{ padding: 20, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No contacts to send to.</div>}
            {acceptedContacts.map((c) => {
              const otherUid = c.uid;
              const chatForContact = chats.find((ch) => ch.type !== "group" && ch.participants?.includes(myUid) && ch.participants?.includes(otherUid));
              const sel = selectedRecipients.some((p) => (p.id || p.type) === (chatForContact?.id || `direct:${otherUid}`));
              return (
                <div key={c.uid} onClick={() => toggleRecipient(chatForContact || { id: `direct:${otherUid}`, type: "direct", participants: [myUid, otherUid] })} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: sel ? t.primaryLight : "transparent" }}>
                  <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={42} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: t.text, flex: 1 }}>{c.profile?.displayName}</span>
                  {sel && <Check size={18} color={t.primary} />}
                </div>
              );
            })}
            {chats.filter((c) => c.type === "group").map((c) => {
              const sel = selectedRecipients.some((p) => (p.id || p.type) === c.id);
              return (
                <div key={c.id} onClick={() => toggleRecipient(c)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, background: sel ? t.primaryLight : "transparent" }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={20} color={t.primary} /></div>
                  <span style={{ fontSize: 15, fontWeight: 600, color: t.text, flex: 1 }}>{c.groupName}</span>
                  {sel && <Check size={18} color={t.primary} />}
                </div>
              );
            })}
          </div>
          {selectedRecipients.length > 0 && (
            <div style={{ display: "flex", gap: 10, padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)", borderTop: `1px solid ${t.border}`, background: t.surface, flexShrink: 0 }}>
              <div onClick={() => setSelectedRecipients([])} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${t.border}`, color: t.text, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
                Clear
              </div>
              <div onClick={sendToSelectedRecipients} style={{ flex: 1, padding: "12px 14px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
                Send to {selectedRecipients.length}
              </div>
            </div>
          )}
        </div>
      )}

      {capturedMedia && cameraPreviewStep && (
        <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 60, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", flexShrink: 0 }}>
            <span onClick={discardCapturedMedia} style={{ color: "#fff", fontSize: 15, cursor: "pointer" }}>Discard</span>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Preview</span>
            <span style={{ width: 50 }} />
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
            {capturedMedia.type === "video"
              ? <video src={capturedMedia.url} controls style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
              : <img src={capturedMedia.url} alt="captured" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
          </div>
          <div style={{ padding: "12px 16px", flexShrink: 0 }}>
            <input
              value={cameraCaption}
              onChange={(e) => setCameraCaption(e.target.value)}
              placeholder="Add a caption…"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "0 16px 24px", flexShrink: 0 }}>
            <div onClick={() => { setCameraPreviewStep(false); setCameraCaption(""); openGlobalCamera(); }} style={{ flex: 1, padding: 13, borderRadius: 12, border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
              Retake
            </div>
            <div onClick={postCapturedMediaToStatus} style={{ flex: 1, padding: 13, borderRadius: 12, border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer", opacity: postingStatus ? 0.6 : 1 }}>
              {postingStatus ? "Posting…" : "Status"}
            </div>
            <div onClick={() => setCameraPreviewStep(false)} style={{ flex: 1, padding: 13, borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
              Send
            </div>
          </div>
        </div>
      )}

      {contextMenuChat && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setContextMenuChat(null)} onTouchStart={() => setContextMenuChat(null)} onMouseDown={() => setContextMenuChat(null)}>
          <div style={{ background: t.surface, borderRadius: 14, overflow: "hidden", minWidth: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px 8px", borderBottom: `1px solid ${t.border}`, gap: 10 }}>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 15, color: t.text }}>{chatDisplayName(contextMenuChat)}</div>
              <X size={18} color={t.textMuted} onClick={(e) => { e.stopPropagation(); setContextMenuChat(null); setMenuError(""); }} style={{ cursor: "pointer", flexShrink: 0 }} />
            </div>
            {menuError && <div style={{ padding: "8px 18px", fontSize: 12, color: "#FF3B30", background: "#FF3B3015" }}>{menuError}</div>}
            <div onClick={() => {
              setMenuError("");
              const chat = contextMenuChat;
              const willLock = !chat.lockedBy?.[myUid];
              setContextMenuChat(null);
              // Locking without a password: make them set one first.
              if (willLock && !lockedChatsPassword) {
                setLockPassInput("");
                setLockPassConfirm("");
                setLockPassError("");
                setLockPassSetupChat(chat);
                return;
              }
              // Unlocking always requires the password.
              if (!willLock) {
                setUnlockPassInput("");
                setUnlockPassError("");
                setUnlockPassChat(chat);
                return;
              }
              toggleLocked(chat.id, myUid, !willLock).catch((e) => setMenuError(e?.message || "Couldn't lock/unlock chat."));
            }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", cursor: "pointer" }}>
              <Lock size={17} color={contextMenuChat.lockedBy?.[myUid] ? t.accent : t.text} />
              <span style={{ fontSize: 14.5, color: contextMenuChat.lockedBy?.[myUid] ? t.accent : t.text }}>{contextMenuChat.lockedBy?.[myUid] ? "Unlock chat" : "Lock chat"}</span>
            </div>
            <div onClick={() => { setMenuError(""); toggleArchive(contextMenuChat.id, myUid, (contextMenuChat.archivedBy || []).includes(myUid)).catch((e) => setMenuError(e?.message || "Couldn't archive chat.")); setContextMenuChat(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Archive size={17} color={t.text} />
              <span style={{ fontSize: 14.5, color: t.text }}>{(contextMenuChat.archivedBy || []).includes(myUid) ? "Unarchive" : "Archive"}</span>
            </div>
            <div onClick={() => { setMenuError(""); toggleFavorite(contextMenuChat.id, myUid, (contextMenuChat.favoritedBy || []).includes(myUid)).catch((e) => setMenuError(e?.message || "Couldn't favorite chat.")); setContextMenuChat(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Star size={17} fill={(contextMenuChat.favoritedBy || []).includes(myUid) ? t.accent : "none"} color={(contextMenuChat.favoritedBy || []).includes(myUid) ? t.accent : t.text} />
              <span style={{ fontSize: 14.5, color: t.text }}>{(contextMenuChat.favoritedBy || []).includes(myUid) ? "Unfavorite" : "Favorite"}</span>
            </div>
            <div onClick={() => { setMenuError(""); togglePinned(contextMenuChat.id, myUid, (contextMenuChat.pinnedBy || []).includes(myUid)).catch((e) => setMenuError(e?.message || "Couldn't pin chat.")); setContextMenuChat(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Pin size={17} color={(contextMenuChat.pinnedBy || []).includes(myUid) ? t.accent : t.text} />
              <span style={{ fontSize: 14.5, color: (contextMenuChat.pinnedBy || []).includes(myUid) ? t.accent : t.text }}>{(contextMenuChat.pinnedBy || []).includes(myUid) ? "Unpin chat" : "Pin chat"}</span>
            </div>
            <div onClick={() => { if (window.confirm("Delete this chat permanently?")) { deleteChatCompletely(contextMenuChat.id).catch(() => {}); } setContextMenuChat(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Trash2 size={17} color="#FF3B30" />
              <span style={{ fontSize: 14.5, color: "#FF3B30" }}>Delete chat</span>
            </div>
          </div>
        </div>
      )}

      {lockPassSetupChat && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: t.surface, borderRadius: 14, overflow: "hidden", width: "82%", maxWidth: 320, padding: 18, boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: t.text, marginBottom: 6 }}>Set a lock password</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.5, marginBottom: 12 }}>
              You're locking <b>{chatDisplayName(lockPassSetupChat)}</b>. Set a password now so only you can open it later.
            </div>
            <input type="password" value={lockPassInput} onChange={(e) => { setLockPassInput(e.target.value); setLockPassError(""); }} placeholder="Password or PIN" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, boxSizing: "border-box", marginBottom: 8 }} />
            <input type="password" value={lockPassConfirm} onChange={(e) => { setLockPassConfirm(e.target.value); setLockPassError(""); }} placeholder="Confirm password" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, boxSizing: "border-box", marginBottom: 6 }} />
            {lockPassError && <div style={{ fontSize: 12, color: "#FF3B30", marginBottom: 6 }}>{lockPassError}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => { setLockPassSetupChat(null); setLockPassInput(""); setLockPassConfirm(""); }} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => {
                const val = lockPassInput.trim();
                const conf = lockPassConfirm.trim();
                if (val.length < 1) { setLockPassError("Enter a password."); return; }
                if (val !== conf) { setLockPassError("Passwords don't match."); return; }
                try { localStorage.setItem("nextext_locked_chats_password", val); } catch {}
                toggleLocked(lockPassSetupChat.id, myUid, false).catch((e) => setMenuError(e?.message || "Couldn't lock chat."));
                setLockPassSetupChat(null);
                setLockPassInput("");
                setLockPassConfirm("");
              }} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Lock chat</button>
            </div>
          </div>
        </div>
      )}

      {unlockPassChat && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: t.surface, borderRadius: 14, overflow: "hidden", width: "82%", maxWidth: 320, padding: 18, boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: t.text, marginBottom: 6 }}>Enter lock password</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.5, marginBottom: 12 }}>
              Enter the password to unlock <b>{chatDisplayName(unlockPassChat)}</b>.
            </div>
            <input type="password" value={unlockPassInput} onChange={(e) => { setUnlockPassInput(e.target.value); setUnlockPassError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { tryUnlock(); } }} placeholder="Lock code…" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${unlockPassError ? "#FF3B30" : t.border}`, background: t.bg, color: t.text, fontSize: 14, boxSizing: "border-box", marginBottom: unlockPassError ? 6 : 12 }} />
            {unlockPassError && <div style={{ fontSize: 12, color: "#FF3B30", marginBottom: 10 }}>{unlockPassError}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => { setUnlockPassChat(null); setUnlockPassInput(""); }} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={tryUnlock} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Unlock</button>
            </div>
          </div>
        </div>
      )}
      {showNewListModal && (
        <div onClick={() => { setShowNewListModal(false); setNewListName(""); }} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: 16, padding: 20, width: "80%", maxWidth: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: t.text, marginBottom: 12 }}>Create Custom List Filter</div>
            <input
              autoFocus
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateCustomList(); }}
              placeholder="List name (e.g. Friends)"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", marginBottom: 14, background: t.bg, color: t.text }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <div onClick={() => { setShowNewListModal(false); setNewListName(""); }} style={{ padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: t.textMuted }}>Cancel</div>
              <div onClick={handleCreateCustomList} style={{ padding: "8px 16px", borderRadius: 10, background: t.primary, color: t.bubbleMeText, cursor: "pointer", fontSize: 13.5, fontWeight: 700 }}>Save</div>
            </div>
          </div>
        </div>
      )}

      {/* Group avatar tap context menu */}
      {groupMenu && (
        <div onClick={() => setGroupMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 9998 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "rgba(30,30,30,0.97)", borderRadius: 12, overflowY: "auto", maxHeight: "70vh", zIndex: 9999, boxShadow: "0 8px 30px rgba(0,0,0,0.5)", minWidth: 210, whiteSpace: "nowrap", WebkitOverflowScrolling: "touch" }}>
            <div onClick={() => { setGroupMenu(null); openGroupInfo(groupMenu); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
              <Info size={16} color="#00A884" />
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>View Group Info</span>
            </div>
            <div onClick={() => { const photo = groupMenu.groupPhotoURL; setGroupMenu(null); if (photo) setGroupPictureFullscreen(photo); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: groupMenu.groupPhotoURL ? "pointer" : "default", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
              <ImageIcon size={16} color="#8E8E93" />
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>View Profile Picture</span>
            </div>
          </div>
        </div>
      )}

      {/* Group picture fullscreen */}
      {groupPictureFullscreen && (
        <div onClick={() => setGroupPictureFullscreen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 999999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <img src={groupPictureFullscreen} alt="" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 12, objectFit: "contain" }} />
          <div onClick={() => setGroupPictureFullscreen(null)} style={{ position: "fixed", top: 16, right: 16, width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.25)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 1000000 }}>
            <X size={24} color="#fff" strokeWidth={3} />
          </div>
        </div>
      )}

      {/* Dedicated Archived Chats screen */}
      {showArchived && (
        <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "calc(12px + var(--safe-top)) 16px 12px", background: t.surface, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
            <ChevronLeft size={22} color={t.text} onClick={() => setShowArchived(false)} style={{ cursor: "pointer" }} />
            <span style={{ color: t.text, fontWeight: 700, fontSize: 18 }}>Archived Chats</span>
            <span style={{ marginLeft: "auto", color: t.textMuted, fontSize: 13 }}>{archived.length}</span>
          </div>
          <div className="nx-scroll" style={{ paddingBottom: 60 }}>
            {archived.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: t.textMuted, fontSize: 13.5 }}>No archived chats.</div>
            )}
            {archived.map((c) => (
              <div key={c.id} style={{ position: "relative", overflow: "hidden", marginBottom: 1 }}>
                <div style={{ opacity: 0.75 }}>{renderChatRow(c)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}`, background: t.surface }}>
                  <div onClick={() => toggleArchive(c.id, myUid, true).catch(() => {})} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: t.primaryLight, cursor: "pointer" }}>
                    <Archive size={15} color={t.primary} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.primary }}>Unarchive</span>
                  </div>
                  <div onClick={() => { if (window.confirm("Delete this chat permanently?")) deleteChatCompletely(c.id).catch(() => {}); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>
                    <Trash2 size={15} color="#FF3B30" />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#FF3B30" }}>Delete</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New broadcast sheet */}
      {showNewBroadcast && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "flex-end" }} onClick={() => setShowNewBroadcast(false)}>
          <div className="nx-scroll" style={{ background: t.surface, width: "100%", borderRadius: "20px 20px 0 0", padding: 20, maxHeight: "78%", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>New broadcast</span>
              <X size={20} color={t.textMuted} onClick={() => setShowNewBroadcast(false)} style={{ cursor: "pointer" }} />
            </div>
            {broadcastStatus && <div style={{ color: "#FF3B30", fontSize: 12.5, marginBottom: 10 }}>{broadcastStatus}</div>}
            <input
              value={newBroadcastName}
              onChange={(e) => setNewBroadcastName(e.target.value)}
              placeholder="Broadcast name (e.g. Family)"
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", marginBottom: 14, background: t.bg, color: t.text }}
            />
            <div style={{ fontWeight: 600, color: t.text, fontSize: 14, marginBottom: 8 }}>Select recipients ({newBroadcastMembers.length})</div>
            {acceptedContacts.length === 0 && (
              <div style={{ fontSize: 13, color: t.textMuted, padding: "8px 0" }}>No contacts yet. Add contacts before creating a broadcast.</div>
            )}
          {acceptedContacts.map((c) => (
              <div key={c.uid} onClick={() => toggleBroadcastMember(c.uid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer" }}>
                <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={38} />
                <span style={{ flex: 1, fontWeight: 600, color: t.text, fontSize: 14.5 }}>{c.profile?.displayName}</span>
                <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${newBroadcastMembers.includes(c.uid) ? t.primary : t.border}`, background: newBroadcastMembers.includes(c.uid) ? t.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {newBroadcastMembers.includes(c.uid) && <span style={{ color: t.bubbleMeText, fontSize: 12, fontWeight: 700 }}>✓</span>}
                </div>
              </div>
            ))}
            <button
              disabled={!newBroadcastName.trim() || newBroadcastMembers.length === 0 || broadcastBusy}
              onClick={handleCreateBroadcast}
              style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: (!newBroadcastName.trim() || newBroadcastMembers.length === 0 || broadcastBusy) ? t.border : t.primary, color: (!newBroadcastName.trim() || newBroadcastMembers.length === 0 || broadcastBusy) ? t.textMuted : t.bubbleMeText, fontWeight: 700, fontSize: 15, cursor: (!newBroadcastName.trim() || newBroadcastMembers.length === 0 || broadcastBusy) ? "not-allowed" : "pointer", marginTop: 14 }}
            >
              {broadcastBusy ? "Creating…" : "Create broadcast"}
            </button>
          </div>
        </div>
      )}

      {/* Compose broadcast sheet */}
      {composingBroadcast && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "flex-end" }} onClick={() => setComposingBroadcast(null)}>
          <div style={{ background: t.surface, width: "100%", borderRadius: "20px 20px 0 0", padding: 20, boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>{composingBroadcast.name}</span>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Broadcast to {(composingBroadcast.memberUids || []).length} recipients as individual chats</div>
              </div>
              <X size={20} color={t.textMuted} onClick={() => setComposingBroadcast(null)} style={{ cursor: "pointer", flexShrink: 0 }} />
            </div>
            {broadcastStatus && <div style={{ fontSize: 12.5, marginBottom: 10, color: broadcastStatus.startsWith("Couldn") ? "#FF3B30" : t.primary }}>{broadcastStatus}</div>}
            <textarea
              value={broadcastMsg}
              onChange={(e) => setBroadcastMsg(e.target.value)}
              placeholder="Type your broadcast message…"
              rows={4}
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, background: t.bg, color: t.text, resize: "none" }}
            />
            <button
              disabled={!broadcastMsg.trim() || broadcastBusy}
              onClick={handleSendBroadcast}
              style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: (!broadcastMsg.trim() || broadcastBusy) ? t.border : t.primary, color: (!broadcastMsg.trim() || broadcastBusy) ? t.textMuted : t.bubbleMeText, fontWeight: 700, fontSize: 15, cursor: (!broadcastMsg.trim() || broadcastBusy) ? "not-allowed" : "pointer", marginTop: 14 }}
            >
              {broadcastBusy ? "Sending…" : `Send to ${(composingBroadcast.memberUids || []).length} recipients`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddContactSheet({ myUid, onClose }) {
  const { t } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [sentTo, setSentTo] = useState([]);
  const [error, setError] = useState("");

  const runSearch = async (val) => {
    setQuery(val);
    if (val.trim().length < 2) { setResults([]); return; }
    try {
      const r = await searchUsersByUsername(val);
      setResults(r.filter((u) => u.uid !== myUid));
    } catch (e) {
      setError("Search failed: " + e.message);
    }
  };

  const handleAdd = async (uid) => {
    setError("");
    try {
      await sendContactRequest(myUid, uid);
      setSentTo((s) => [...s, uid]);
    } catch (e) {
      setError("Couldn't send request: " + e.message);
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: t.surface, width: "100%", borderRadius: "20px 20px 0 0", padding: 20, maxHeight: "70%", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Add contact</div>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer", flexShrink: 0 }} />
        </div>
        <input value={query} onChange={(e) => runSearch(e.target.value)} placeholder="Search by username…" style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", marginBottom: 14 }} />
        {error && <div style={{ color: "#FF3B30", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        {results.map((u) => (
          <div key={u.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px" }}>
            <Avatar photoURL={u.photoURL} name={u.displayName} uid={u.uid} size={38} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 14.5 }}>{u.displayName}</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>@{u.username}</div>
            </div>
            <button disabled={sentTo.includes(u.uid)} onClick={() => handleAdd(u.uid)} style={{ padding: "7px 14px", borderRadius: 16, border: "none", background: sentTo.includes(u.uid) ? t.border : t.primary, color: sentTo.includes(u.uid) ? t.textMuted : t.bubbleMeText, fontSize: 12.5, fontWeight: 700, cursor: sentTo.includes(u.uid) ? "default" : "pointer" }}>
              {sentTo.includes(u.uid) ? "Sent" : "Add"}
            </button>
          </div>
        ))}
        {query.trim().length >= 2 && results.length === 0 && <div style={{ fontSize: 13, color: t.textMuted, padding: "8px 4px" }}>No users found.</div>}
      </div>
    </div>
  );
}
