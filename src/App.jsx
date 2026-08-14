import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { ThemeProvider, useTheme, themes, ROTATE_INTERVALS } from "./theme/ThemeContext";
import { useAuth } from "./firebase/useAuth";
import { usePresenceHeartbeat, useAppUsageTracker } from "./firebase/presence";
import { purgeExpiredStatuses, useStatuses } from "./firebase/status";
import { useContacts } from "./firebase/contacts";
import { useChats, purgeExpiredChatMedia, markChatRead } from "./firebase/chats";
import { setGlobalWallpaper, fileToWallpaperDataUrl } from "./theme/wallpaper";
import { ChevronLeft, Palette, Shield, Lock, MessageSquare, X, ShieldCheck, Phone, Image as ImageIcon, Users, CircleDot, RotateCcw, Camera, Settings as SettingsIcon, Bot, Sparkles, RefreshCw, Search, User, Compass, Bell, BellOff } from "lucide-react";
import { FONTS } from "./theme/ThemeContext";
import Avatar from "./components/Avatar";
import AvatarColorPicker from "./components/AvatarColorPicker";
import { uploadChatFile } from "./supabase/media";
import { doc, getDoc, updateDoc, onSnapshot, collection, query, where, orderBy } from "firebase/firestore";
import { db } from "./firebase/config";
import AuthScreen from "./screens/AuthScreen";
import CompleteProfileScreen from "./screens/CompleteProfileScreen";
import ChatListScreen from "./screens/ChatListScreen";
import ConversationScreen from "./screens/ConversationScreen";
import PrivacyScreen from "./screens/PrivacyScreen";
import ParentalControlsScreen from "./screens/ParentalControlsScreen";
import FeedbackScreen from "./screens/FeedbackScreen";
import ContactProfileScreen from "./screens/ContactProfileScreen";
import AdminDashboard from "./screens/AdminDashboard";
import AIChatScreen from "./screens/AIChatScreen";
import AISidebarWidget from "./components/AISidebarWidget";
import { useSystemConfigHook, requestAIAccess, setAIPersonality, PERSONALITIES } from "./firebase/ai";
import AppLockScreen from "./screens/AppLockScreen";
import StatusScreen from "./screens/StatusScreen";
import GroupInfoScreen from "./screens/GroupInfoScreen";
import { initNotifications, setNotificationTapHandler, showLocalNotification, getNotificationsStatus, enableNotifications, pollPendingNotificationTap, setNotificationMarkReadHandler, pollPendingMarkRead } from "./firebase/notifications";
import { App as CapApp } from "@capacitor/app";
import PermissionsScreen from "./screens/PermissionsScreen";
import UpdatePrompt from "./components/UpdatePrompt";
import DownloadApkButton from "./components/DownloadApkButton";
import UserStatsCard from "./components/UserStatsCard";
import PageErrorBoundary from "./components/PageErrorBoundary";
import { checkForUpdate, downloadUpdate, getCurrentVersion, getLastSeenRelease, openDownloadUrl, saveApkToDevice, setLastSeenRelease } from "./updater/updateChecker";
import { PING_SOUNDS, playVoicePing } from "./utils/pingSounds";
import { updateGlobalSettings, useGlobalSettings } from "./firebase/config-settings";
import { useSystemInsets } from "./utils/useSystemInsets";
import { changeNames, isNameChangeBlocked, isUsernameAvailable } from "./firebase/names";

const UI_SCALE_KEY = "nextext_ui_scale";
const SCROLL_DOWN_KEY = "nextext_show_scrolldown";

function ThemeSheet({ current, onSelect, onClose }) {
  const { t, customTheme, setCustomThemeColors, rotateDays, setRotateDays } = useTheme();
  const [tab, setTab] = useState("presets");
  const base = customTheme || t;
  const [colors, setColors] = useState({
    primary: base.primary, bg: base.bg, surface: base.surface, bubbleMe: base.bubbleMe,
    bubbleMeText: base.bubbleMeText, bubbleThem: base.bubbleThem, bubbleThemText: base.bubbleThemText,
    text: base.text, accent: base.accent,
  });

  const ColorRow = ({ label, field }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
      <span style={{ fontSize: 13.5, color: t.text }}>{label}</span>
      <input type="color" value={colors[field]} onChange={(e) => setColors((c) => ({ ...c, [field]: e.target.value }))} style={{ width: 40, height: 30, border: "none", borderRadius: 6, cursor: "pointer" }} />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100000, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: t.surface, width: "100%", borderRadius: "20px 20px 0 0", padding: "20px 20px 30px", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box", WebkitOverflowScrolling: "touch" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: t.text, fontSize: 18 }}>Theme</h3>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[["presets", "Presets"], ["custom", "Custom colors"], ["rotate", "Auto-switch"]].map(([key, label]) => (
            <div key={key} onClick={() => setTab(key)} style={{ padding: "6px 14px", borderRadius: 16, background: tab === key ? t.primary : t.primaryLight, color: tab === key ? t.bubbleMeText : t.primary, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{label}</div>
          ))}
        </div>

        {tab === "presets" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {Object.entries(themes).map(([key, th]) => (
              <div key={key} onClick={() => onSelect(key)} style={{ border: `2px solid ${current === key ? t.primary : t.border}`, borderRadius: 14, padding: 12, cursor: "pointer", background: th.bg }}>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                  <div style={{ background: th.bubbleMe, color: th.bubbleMeText, fontSize: 10, padding: "4px 8px", borderRadius: 8 }}>Hey!</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: th.text }}>{th.name}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "custom" && (
          <div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10 }}>Pick your own colors for everything.</div>
            <ColorRow label="Primary / header" field="primary" />
            <ColorRow label="Accent" field="accent" />
            <ColorRow label="Background" field="bg" />
            <ColorRow label="Surface (cards, bars)" field="surface" />
            <ColorRow label="Your message bubbles" field="bubbleMe" />
            <ColorRow label="Your message text" field="bubbleMeText" />
            <ColorRow label="Their message bubbles" field="bubbleThem" />
            <ColorRow label="Their message text" field="bubbleThemText" />
            <ColorRow label="Regular text" field="text" />
            <button onClick={() => { setCustomThemeColors({ ...colors, primaryLight: colors.primary + "22", textMuted: colors.text + "99", border: colors.surface === colors.bg ? colors.text + "22" : colors.bg }); onSelect("custom"); }} style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 14 }}>
              Apply custom theme
            </button>
          </div>
        )}

        {tab === "rotate" && (
          <div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14, lineHeight: 1.5 }}>
              Automatically switch to a random theme on this schedule.
            </div>
            {ROTATE_INTERVALS.map((opt) => (
              <div key={opt.label} onClick={() => setRotateDays(opt.days)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${t.primary}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {rotateDays === opt.days && <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.primary }} />}
                </div>
                <span style={{ fontSize: 14, color: t.text }}>{opt.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatPhoneInput(raw) {
  // Keeps a leading "+" if present, strips everything else non-numeric, then
  // groups digits with spaces for readability as the user types. Not
  // country-specific (international numbers vary too much for one fixed
  // pattern) -- just numeric input with simple, readable grouping.
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return hasPlus ? "+" : "";
  const groups = digits.match(/.{1,3}/g) || [];
  return (hasPlus ? "+" : "") + groups.join(" ");
}

function NameSetting({ myUid, userDoc, globalSettings }) {
  const { t } = useTheme();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setDisplayName(userDoc?.displayName || "");
    setUsername(userDoc?.username || "");
  }, [userDoc?.displayName, userDoc?.username]);

  const blocked = isNameChangeBlocked(userDoc, globalSettings);

  const save = async () => {
    setError("");
    const dn = displayName.trim();
    const un = username.trim().toLowerCase();
    if (!dn) return setError("Display name is required.");
    if (!un) return setError("Username is required.");
    if (!/^[a-z0-9_.]+$/.test(un)) return setError("Username can only contain lowercase letters, numbers, dots, and underscores.");
    setChecking(true);
    try {
      if (un !== (userDoc?.username || "").toLowerCase() && !(await isUsernameAvailable(un, myUid))) {
        setError("That username is already taken.");
        return;
      }
      await changeNames(myUid, { username: un, displayName: dn });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e.message || "Couldn't save your name.");
    } finally {
      setChecking(false);
    }
  };

  if (blocked) {
    return (
      <div style={{ marginTop: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.5, padding: "10px 12px", borderRadius: 10, background: t.primaryLight }}>
          Name changes are blocked{userDoc?.restrictions?.blockNameChange ? " for your account" : " by the admin"}. Contact an admin if you need to change your name.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <User size={16} color={t.primary} />
        <div style={{ fontWeight: 600, fontSize: 14, color: t.text }}>Your name</div>
      </div>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
        Your display name is shown to everyone you chat with. Your username (&#64;name) is how people find you. Old chats keep the name you had when the message was sent — this only affects new messages.
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 4 }}>Display name</div>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Display name"
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, color: t.text, background: t.bg }}
      />
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginTop: 8, marginBottom: 4 }}>Username</div>
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden", background: t.bg }}>
        <span style={{ color: t.textMuted, fontSize: 14, paddingLeft: 12 }}>&#64;</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, "").toLowerCase())}
          placeholder="username"
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", padding: "10px 12px 10px 4px", fontSize: 14, color: t.text }}
        />
      </div>
      {error && <div style={{ color: "#FF3B30", fontSize: 12.5, marginTop: 6 }}>{error}</div>}
      <button onClick={save} disabled={checking} style={{ marginTop: 10, padding: "10px 16px", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, cursor: "pointer" }}>
        {checking ? "Saving…" : saved ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}

function PhoneNumberSetting({ myUid }) {
  const { t } = useTheme();
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => setPhone(snap.data()?.phoneNumber || ""));
    return unsub;
  }, [myUid]);

  const save = async () => {
    const trimmed = phone.trim();
    const normalized = trimmed.replace(/[^\d+]/g, "") || null;
    await updateDoc(doc(db, "users", myUid), { phoneNumber: trimmed || null, phoneNumberNormalized: normalized });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div style={{ marginTop: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Phone size={16} color={t.primary} />
        <div style={{ fontWeight: 600, fontSize: 14, color: t.text }}>Phone number (optional)</div>
      </div>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
        Adding your real phone number helps friends and family find you automatically
        once their contacts are checked against the app. This is entirely optional —
        it's better to leave this blank than to enter a fake or made-up number, since a
        fake number could mistakenly connect you with someone else's real contact, or
        prevent people from finding you correctly at all.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={phone}
          onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          inputMode="tel"
          placeholder="+1 555 123 4567"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box" }}
        />
        <button onClick={save} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, cursor: "pointer" }}>
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </div>
  );
}

function SettingsRow({ icon, label, sub, onClick, t }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", cursor: onClick ? "pointer" : "default", borderBottom: `1px solid ${t.border}` }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>{label}</div>{sub && <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>{sub}</div>}</div>
    </div>
  );
}

function NotificationsRow({ myUid, t }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setStatus(await getNotificationsStatus()); } catch { setStatus({ supported: false, hasPrompt: false, receive: "unknown" }); }
  };
  useEffect(() => { refresh(); }, []);
  // On Android < 13 (API < 33) there is no POST_NOTIFICATIONS runtime
  // permission — notifications are granted automatically and no prompt/toggle
  // exists in system settings. We surface that honestly here.
  const hasPrompt = status?.hasPrompt;
  const granted = status?.receive === "granted";
  const isOldAndroid = status?.androidSdk === "<33";
  return (
    <SettingsRow
      t={t}
      icon={granted ? <Bell size={18} color={t.primary} /> : <BellOff size={18} color={t.primary} />}
      label="Notifications"
      sub={
        !status ? "Checking…" :
        !status.supported ? "Not supported on this device" :
        isOldAndroid ? "Enabled (Android 11 handles automatically)" :
        hasPrompt === false ? "Enabled automatically on this device (no prompt needed)" :
        granted ? "Allowed — you'll get message notifications" :
        "Tap to allow message notifications"
      }
      onClick={hasPrompt === false || granted ? undefined : async () => {
        if (busy) return;
        setBusy(true);
        try {
          const res = await enableNotifications(myUid);
          if (res?.ok) { await initNotifications(myUid).catch(() => {}); }
          await refresh();
        } finally { setBusy(false); }
      }}
    />
  );
}

function SettingsScreen({ myUid, isAdmin, themeKey, onOpenTheme, uiScale, setUiScale, recordingBarScale, setRecordingBarScale, showScrollDown, setShowScrollDown, animatedScrollEntry, setAnimatedScrollEntry, compactList, setCompactList, onBack, onNavigate, onLogout, userDoc, navConfig, setNavConfig, aiSidebarOn, setAiSidebarOn, showSplash, setShowSplash, searchMode, setSearchMode, topBarVisible, setTopBarVisible, onCheckUpdate, checkingUpdate, updateStatus, animateOnTap, setAnimateOnTap, swipeAnimationOn, setSwipeAnimationOn, swipeSpeed, setSwipeSpeed, onShowTour, searchBarScale, setSearchBarScale, setLiveUserDoc, micMode, setMicMode, changeMicMode, pinchZoomOn, setPinchZoomOn, voiceEndChimeOn, setVoiceEndChimeOn, pingSoundId, setPingSoundId, voicePlayerStyle, setVoicePlayerStyle, autoUpdateCheckOn, setAutoUpdateCheckOn, linkPreviewsOn, setLinkPreviewsOn }) {
  const { t, hideNav, setHideNav, chatTextScale, setChatTextScale, appFontId, setAppFontId, composerHeight, setComposerHeight, messageWidth, setMessageWidth } = useTheme();
  const wallpaperInputRef = useRef(null);
  const profilePhotoRef = useRef(null);
  const [wallpaperSaved, setWallpaperSaved] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [avatarNonce, setAvatarNonce] = useState(0);
  const [lockedChatsPassSaved, setLockedChatsPassSaved] = useState(false);
  const lockedChatsPassRef = useRef(null);
  const lockedChatsOldPassRef = useRef(null);
  const [lockedChatsPassError, setLockedChatsPassError] = useState("");
  const [appLockEnabled, setAppLockEnabled] = useState(() => localStorage.getItem("nextext_app_lock") === "true" || (localStorage.getItem("nextext_app_lock") === "pending" && !!localStorage.getItem("nextext_app_lock_pass")));
  const [appLockPassSaved, setAppLockPassSaved] = useState(() => !!localStorage.getItem("nextext_app_lock_pass"));
  const appLockPassRef = useRef(null);
  const sysConfig = useSystemConfigHook();
  const globalSettings = useGlobalSettings();
  const [aiRequestStatus, setAiRequestStatus] = useState("");
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
  const changeContactSort = (key) => {
    setContactSort(key);
    try {
      localStorage.setItem("nextext_contact_sort", key);
      window.dispatchEvent(new Event("nextext-contact-sort-change"));
    } catch {}
  };

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
  const changeChatSort = (key) => {
    setChatSort(key);
    try {
      localStorage.setItem("nextext_chat_sort", key);
      window.dispatchEvent(new Event("nextext-chat-sort-change"));
    } catch {}
  };

  const userRestrictions = userDoc?.restrictions || null;
  const customStatusInputRef = useRef(null);
  const [customStatusSaved, setCustomStatusSaved] = useState(false);
  const [openSections, setOpenSections] = useState({ accountActions: true });
  const [resetPasswordModal, setResetPasswordModal] = useState(false);
  const [resetPasswordInput, setResetPasswordInput] = useState("");
  const [disableLockModal, setDisableLockModal] = useState(false);
  const [disableLockInput, setDisableLockInput] = useState("");
  const [disableLockError, setDisableLockError] = useState(false);
  const [techStackEditing, setTechStackEditing] = useState(false);
  const [techStackDraft, setTechStackDraft] = useState(null);

  const toggleSection = (key) => setOpenSections((prev) => ({ ...(prev || {}), [key]: !(prev?.[key]) }));

  const handleGlobalWallpaper = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToWallpaperDataUrl(file);
    setGlobalWallpaper(dataUrl);
    setWallpaperSaved(true);
    setTimeout(() => setWallpaperSaved(false), 1800);
  };

  const handleProfilePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoUploading(true);
    try {
      const result = await uploadChatFile(`profile-${myUid}`, myUid, file, { compress: true });
      await updateDoc(doc(db, "users", myUid), { photoURL: result.url });
    } catch { /* silent */ }
    setPhotoUploading(false);
  };

  const saveCustomStatus = async () => {
    try {
      const textVal = customStatusInputRef.current?.value || "";
      const expiryEl = document.getElementById("custom-status-expiry");
      const expiryVal = expiryEl?.value || "forever";
      await updateDoc(doc(db, "users", myUid), {
        customStatusText: textVal.trim() || null,
        customStatusExpiry: expiryVal,
      });
      setCustomStatusSaved(true);
      setTimeout(() => setCustomStatusSaved(false), 1800);
    } catch { /* silent */ }
  };

  const Toggle = ({ on, onClick }) => (
    <div onClick={onClick} style={{ width: 46, height: 26, borderRadius: 13, background: on ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 0.15s" }} />
    </div>
  );

  const Row = ({ icon, label, sub, onClick, right }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", cursor: onClick ? "pointer" : "default", borderBottom: `1px solid ${t.border}` }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>{label}</div>{sub && <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>{sub}</div>}</div>
      {right}
    </div>
  );

  // Memoized so its identity stays stable across App re-renders — defining it
  // inline would unmount/remount every card (losing input focus) on any state
  // change, e.g. the admin tech-stack editor's first keystroke.
  const SectionCard = useMemo(() => ({ title, emoji, children, sectionKey }) => {
    const isOpen = sectionKey ? (openSections?.[sectionKey] ?? false) : true;
    // Category headers are dark grey (#1E1E1E) on light themes for a crisp
    // WhatsApp-style look; dark themes use a light header instead so the title
    // stays readable against the dark background.
    const bgFirstHex = String(t.bg || "").slice(1, 2);
    const headerColor = (bgFirstHex && bgFirstHex > "7") ? "#1E1E1E" : t.text;
    return (
      <div style={{ marginBottom: 18 }}>
        <div onClick={sectionKey ? () => toggleSection(sectionKey) : undefined} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, cursor: sectionKey ? "pointer" : "default" }}>
          <span style={{ fontSize: 14 }}>{emoji}</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: headerColor, flex: 1 }}>{title}</span>
          {sectionKey && <span style={{ fontSize: 11, color: t.textMuted, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>}
        </div>
        {isOpen && (
          <div style={{ background: t.surface, borderRadius: 14, padding: "4px 14px", border: `1px solid ${t.border}` }}>
            {children}
          </div>
        )}
      </div>
    );
  }, [t, openSections]);

  // ── Bottom bar customizer helpers ──
  const ALL_TABS = [
    { key: "chats", label: "Chats", mandatory: true },
    { key: "status", label: "Status" },
    { key: "groups", label: "Groups" },
    { key: "settings", label: "Settings" },
  ];

  const moveTab = (idx, dir) => {
    const next = [...navConfig];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setNavConfig(next);
  };

  const toggleTab = (key) => {
    const isActive = navConfig.some((t) => t.key === key);
    if (isActive) {
      // Can't deactivate if only 2 active
      if (navConfig.length <= 2) return;
      // Can't deactivate chats (mandatory)
      if (key === "chats") return;
      setNavConfig(navConfig.filter((t) => t.key !== key));
    } else {
      setNavConfig([...navConfig, { key }]);
    }
  };

  // Short-circuit guard: if the user/preferences config hasn't resolved
  // from Firestore yet, render a safe placeholder instead of evaluating
  // nested accordion properties against null (which whites out the screen).
  if (!userDoc) {
    return (
      <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 25 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "calc(16px + var(--safe-top)) 16px 16px", gap: 12, background: t.primary, flexShrink: 0 }}>
          <ChevronLeft size={22} color="#fff" onClick={onBack} style={{ cursor: "pointer" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>Settings</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: t.textMuted, fontSize: 14 }}>Loading settings…</div>
      </div>
    );
  }

  return (
      <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 25 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "calc(16px + var(--safe-top)) 16px 16px", gap: 12, background: t.surface, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
          <span style={{ color: t.text, fontWeight: 700, fontSize: 18 }}>Settings</span>
        </div>
      <div className="nx-scroll" style={{ padding: "12px 16px", paddingBottom: 100 }}>

        {/* ═══ ACCOUNT & PROFILE ═══ */}
        <SectionCard title="Account & Profile" emoji="👤" sectionKey="account">
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", cursor: "pointer" }} onClick={() => profilePhotoRef.current?.click()}>
            <input ref={profilePhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleProfilePhoto} />
            <Avatar key={avatarNonce} photoURL={userDoc?.photoURL} name={userDoc?.displayName || userDoc?.username} uid={myUid} size={52} />
            <div>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>{userDoc?.displayName || userDoc?.username || "Your name"}</div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1, display: "flex", alignItems: "center", gap: 4 }}>
                <Camera size={12} />
                {photoUploading ? "Uploading…" : "Tap to change profile photo"}
              </div>
            </div>
          </div>
          <AvatarColorPicker uid={myUid} onChange={() => setAvatarNonce((n) => n + 1)} />
          <NameSetting myUid={myUid} userDoc={userDoc} globalSettings={globalSettings} />
          <PhoneNumberSetting myUid={myUid} />
        </SectionCard>

        {/* ═══ CUSTOM STATUS / ABOUT ME ═══ */}
        <SectionCard title="About Me" emoji="💬" sectionKey="about">
          <div style={{ padding: "13px 0" }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 6 }}>Custom status</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Set a status message shown on your profile.</div>
            <input
              ref={customStatusInputRef}
              key={userDoc?.customStatusText || ""}
              defaultValue={userDoc?.customStatusText || ""}
              placeholder="Hey, I am using NexText"
              maxLength={140}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", marginBottom: 8, background: t.bg, color: t.text }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, color: t.textMuted }}>Self-destruct after</span>
              <select
                id="custom-status-expiry"
                key={userDoc?.customStatusExpiry || "forever"}
                defaultValue={userDoc?.customStatusExpiry || "forever"}
                style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, background: t.bg, color: t.text, cursor: "pointer", boxSizing: "border-box", maxWidth: 130 }}
              >
                <option value="forever">Forever</option>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </div>
            <button onClick={saveCustomStatus} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {customStatusSaved ? "Saved ✓" : "Save Status"}
            </button>
          </div>
        </SectionCard>

        {/* ═══ PRIVACY & SECURITY ═══ */}
        <SectionCard title="Privacy & Security" emoji="🔒" sectionKey="privacy">
          <Row icon={<Shield size={18} color={t.primary} />} label="Parental Controls" sub="Manage restrictions" onClick={() => onNavigate("parental")} />
          <Row icon={<Lock size={18} color={t.primary} />} label="Privacy" sub="Last seen, read receipts, status" onClick={() => onNavigate("privacy")} />
          <Row icon={<ShieldCheck size={18} color={t.primary} />} label="Permissions" sub="Microphone, camera, notifications, contacts" onClick={() => onNavigate("permissions")} />

          {/* App protection lock */}
          <div style={{ padding: "13px 0", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={18} color={t.primary} /></div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>App protection lock</div><div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Require password when opening the app</div></div>
              <Toggle on={appLockEnabled} onClick={() => {
                if (appLockEnabled) {
                  setDisableLockInput("");
                  setDisableLockError(false);
                  setDisableLockModal(true);
                } else {
                  setAppLockEnabled(true);
                  const existingPass = localStorage.getItem("nextext_app_lock_pass");
                  if (existingPass) { localStorage.setItem("nextext_app_lock", "true"); setAppLockPassSaved(true); }
                  else { localStorage.setItem("nextext_app_lock", "pending"); }
                }
              }} />
            </div>
            {appLockEnabled && !appLockPassSaved && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, paddingLeft: 50 }}>
                <input ref={appLockPassRef} type="password" defaultValue="" placeholder="Set PIN or password…" style={{ flex: 1, padding: "9px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, boxSizing: "border-box" }} />
                <button onClick={() => { const val = appLockPassRef.current?.value || ""; if (!val.trim()) return; localStorage.setItem("nextext_app_lock", "true"); localStorage.setItem("nextext_app_lock_pass", val); setAppLockPassSaved(true); if (appLockPassRef.current) appLockPassRef.current.value = ""; }} disabled={false} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save</button>
              </div>
            )}
            {appLockEnabled && appLockPassSaved && <div style={{ fontSize: 12, color: t.primary, fontWeight: 600, marginTop: 6, paddingLeft: 50 }}>Password saved &bull;&bull;&bull;&bull;&bull;</div>}
            {appLockEnabled && (appLockPassSaved || localStorage.getItem("nextext_app_lock_pass")) && (
              <div onClick={() => { setResetPasswordInput(""); setResetPasswordModal(true); }} style={{ fontSize: 12, color: "#FF3B30", fontWeight: 600, marginTop: 4, paddingLeft: 50, cursor: "pointer" }}>
                Reset password
              </div>
            )}
          </div>

          {/* Locked chats password */}
          <div style={{ padding: "13px 0" }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Locked chats password</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Set a password to hide chats. Type it in the search bar to reveal them.</div>
            {(() => {
              const current = localStorage.getItem("nextext_locked_chats_password") || "";
              const saveLockedChatsPass = () => {
                const val = lockedChatsPassRef.current?.value || "";
                const oldPass = lockedChatsOldPassRef.current?.value || "";
                if (current) {
                  if (oldPass !== current) {
                    setLockedChatsPassError("Current password is incorrect.");
                    return;
                  }
                }
                setLockedChatsPassError("");
                localStorage.setItem("nextext_locked_chats_password", val);
                setLockedChatsPassSaved(true);
                setTimeout(() => setLockedChatsPassSaved(false), 1800);
              };
              return (
                <>
                  {current && (
                    <input ref={lockedChatsOldPassRef} type="password" placeholder="Current password (required)" style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${lockedChatsPassError ? "#FF3B30" : t.border}`, fontSize: 13, boxSizing: "border-box", marginBottom: 8 }} />
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input ref={lockedChatsPassRef} type="password" defaultValue={current} placeholder="New password…" style={{ flex: 1, padding: "9px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, boxSizing: "border-box" }} />
                    <button onClick={saveLockedChatsPass} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{lockedChatsPassSaved ? "Saved ✓" : "Save"}</button>
                  </div>
                  {lockedChatsPassError && <div style={{ color: "#FF3B30", fontSize: 12, marginTop: 6 }}>{lockedChatsPassError}</div>}
                </>
              );
            })()}
          </div>
        </SectionCard>

        {/* ═══ APPEARANCE & INTERFACE ═══ */}
        <SectionCard title="Appearance & Interface" emoji="🎨" sectionKey="appearance">
          <Row icon={<Palette size={18} color={t.primary} />} label="Theme" sub={themes[themeKey]?.name || "Default Theme"} onClick={onOpenTheme} />
          <Row icon={<ImageIcon size={18} color={t.primary} />} label="Default chat background" sub={wallpaperSaved ? "Saved ✓" : "Applies to chats without their own background"} onClick={() => wallpaperInputRef.current?.click()} />
          <input ref={wallpaperInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleGlobalWallpaper} />

          {/* Launch splash screen toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Enable Launch Splash Screen</div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Show the 2.5s cinematic boot animation on app launch.</div>
            </div>
            <div
              onClick={() => { const next = !(showSplash ?? true); setShowSplash(next); localStorage.setItem("nextext_splash_enabled", next ? "on" : "off"); }}
              style={{ width: 46, height: 26, borderRadius: 13, background: (showSplash ?? true) ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
            >
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: showSplash ? 23 : 3, transition: "left 0.15s" }} />
            </div>
          </div>

          {/* Fullscreen mode toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Full Screen Mode</div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Hide status bar and navigation for immersive experience. (Only available on some devices)</div>
            </div>
            <div
              onClick={() => {
                const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
                if (isFull) {
                  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
                  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                } else {
                  const el = document.documentElement;
                  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
                  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
                }
              }}
              style={{ width: 46, height: 26, borderRadius: 13, background: (document.fullscreenElement || document.webkitFullscreenElement) ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
            >
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: (document.fullscreenElement || document.webkitFullscreenElement) ? 23 : 3, transition: "left 0.15s" }} />
            </div>
          </div>

          {/* Font */}
          <div style={{ padding: "13px 0" }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 6 }}>Font</div>
            <select value={appFontId} onChange={(e) => setAppFontId(e.target.value)} style={{ width: "100%", padding: "10px 14px", paddingRight: 16, boxSizing: "border-box", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, background: t.bg, color: t.text, cursor: "pointer" }}>
              {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>

          {/* App-wide text scaling */}
          <div style={{ padding: "13px 0" }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>App size</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Adjust if things look too small or too large.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min="0.6" max="1.6" step="0.05" value={uiScale} onChange={(e) => setUiScale(Number(e.target.value))} style={{ flex: 1, accentColor: t.primary }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: t.primary, minWidth: 44 }}>{Math.round(uiScale * 100)}%</span>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: t.textMuted, cursor: "pointer" }}>
                <input type="checkbox" checked={uiScale === 1} onChange={() => setUiScale(1)} style={{ accentColor: t.primary, width: 15, height: 15, cursor: "pointer" }} />
                Default
              </label>
            </div>
          </div>

          {/* Chat text scaling */}
          <div style={{ padding: "13px 0" }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Chat text size</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Scale text inside chat bubbles.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min="0.6" max="1.6" step="0.05" value={chatTextScale} onChange={(e) => setChatTextScale(Number(e.target.value))} style={{ flex: 1, accentColor: t.primary }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: t.primary, minWidth: 44 }}>{Math.round(chatTextScale * 100)}%</span>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: t.textMuted, cursor: "pointer" }}>
                <input type="checkbox" checked={chatTextScale === 1} onChange={() => setChatTextScale(1)} style={{ accentColor: t.primary, width: 15, height: 15, cursor: "pointer" }} />
                Default
              </label>
            </div>

            {/* Message bubble width */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Message width</div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>How much of the screen each message fills.</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { id: "compact", label: "Compact" },
                  { id: "standard", label: "Standard" },
                  { id: "wide", label: "Wide" },
                ].map((opt) => (
                  <div
                    key={opt.id}
                    onClick={() => setMessageWidth(opt.id)}
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      textAlign: "center",
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: messageWidth === opt.id ? t.primary : t.bg,
                      color: messageWidth === opt.id ? t.bubbleMeText : t.text,
                      border: `1px solid ${messageWidth === opt.id ? t.primary : t.border}`,
                    }}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Pinch to zoom chat text</span>
              <Toggle on={pinchZoomOn} onClick={() => { const next = !pinchZoomOn; setPinchZoomOn(next); localStorage.setItem("nextext_pinch_zoom", next ? "true" : "false"); }} />
            </div>
            {pinchZoomOn && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>In any chat, pinch the message list to make text bigger or smaller.</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Voice note chimes</span>
              <Toggle on={voiceEndChimeOn} onClick={() => { const next = !voiceEndChimeOn; setVoiceEndChimeOn(next); localStorage.setItem("nextext_voice_end_chime", next ? "on" : "off"); }} />
            </div>
            {voiceEndChimeOn && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>A chime plays after every voice note, plus a brighter completion chime when a run of 2+ notes finishes.</div>}
            {voiceEndChimeOn && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {PING_SOUNDS.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setPingSoundId(s.id);
                      localStorage.setItem("nextext_voice_ping_sound", s.id);
                      // Play an immediate preview so the user hears the chime
                      // they're selecting — playVoicePing reads the just-set
                      // localStorage value to choose the pattern.
                      playVoicePing();
                    }}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 14,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: pingSoundId === s.id ? t.primary : t.bg,
                      color: pingSoundId === s.id ? t.bubbleMeText : t.text,
                      border: `1px solid ${pingSoundId === s.id ? t.primary : t.border}`,
                    }}
                  >
                    {s.label}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Voice player style</span>
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Real-time waveform, or a clean seek bar you can tap and drag.</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {[
                { id: "waveform", label: "Waveform" },
                { id: "scrubber", label: "Scrubber" },
              ].map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => {
                    setVoicePlayerStyle(opt.id);
                    localStorage.setItem("nextext_voice_player_style", opt.id);
                  }}
                  style={{
                    flex: 1,
                    padding: "7px 0",
                    textAlign: "center",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: voicePlayerStyle === opt.id ? t.primary : t.bg,
                    color: voicePlayerStyle === opt.id ? t.bubbleMeText : t.text,
                    border: `1px solid ${voicePlayerStyle === opt.id ? t.primary : t.border}`,
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Voice note recording mode</span>
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>How the microphone button behaves when pressed.</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {[
                { id: "hold", label: "Hold to record" },
                { id: "tap", label: "Tap to record" },
              ].map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => changeMicMode(opt.id)}
                  style={{
                    flex: 1,
                    padding: "7px 0",
                    textAlign: "center",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: micMode === opt.id ? t.primary : t.bg,
                    color: micMode === opt.id ? t.bubbleMeText : t.text,
                    border: `1px solid ${micMode === opt.id ? t.primary : t.border}`,
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Recording bar size</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.primary, minWidth: 44 }}>{Math.round(recordingBarScale * 100)}%</span>
            </div>
            <input type="range" min="0.6" max="1.6" step="0.05" value={recordingBarScale} onChange={(e) => setRecordingBarScale(Number(e.target.value))} style={{ flex: 1, width: "100%", accentColor: t.primary, marginTop: 6 }} />
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Adjust the size of the recording controls when the mic is active.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Animate tab taps (animateOnTap)</span>
              <Toggle on={animateOnTap} onClick={() => setAnimateOnTap(!animateOnTap)} />
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Force page animation when tapping bottom or top bar navigation buttons. (Default: off)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Page swipe animation</span>
              <Toggle on={swipeAnimationOn} onClick={() => setSwipeAnimationOn(!swipeAnimationOn)} />
            </div>
            {swipeAnimationOn && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Slide animation when swiping between tabs.</div>}
            {swipeAnimationOn && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {[
                  { id: "slow", label: "Slow" },
                  { id: "normal", label: "Normal" },
                  { id: "fast", label: "Fast" },
                ].map((opt) => (
                  <div
                    key={opt.id}
                    onClick={() => {
                      setSwipeSpeed(opt.id);
                    }}
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      textAlign: "center",
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: swipeSpeed === opt.id ? t.primary : t.bg,
                      color: swipeSpeed === opt.id ? t.bubbleMeText : t.text,
                      border: `1px solid ${swipeSpeed === opt.id ? t.primary : t.border}`,
                    }}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search bar size */}
          <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Main search bar size</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Adjust the scale and height of the top search bar.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min="0.6" max="2.0" step="0.05" value={searchBarScale} onChange={(e) => setSearchBarScale(Number(e.target.value))} style={{ flex: 1, accentColor: t.primary }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: t.primary, minWidth: 44 }}>{searchBarScale === 1 ? "Default" : `${Math.round(searchBarScale * 100)}%`}</span>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: t.textMuted, cursor: "pointer" }}>
                <input type="checkbox" checked={searchBarScale === 1} onChange={() => setSearchBarScale(1)} style={{ accentColor: t.primary, width: 15, height: 15, cursor: "pointer" }} />
                Default
              </label>
            </div>
          </div>

          {/* Message box height */}
          <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Message box size</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Make the message input taller, shorter, or easier to tap.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min="0.6" max="2.5" step="0.05" value={composerHeight} onChange={(e) => setComposerHeight(Number(e.target.value))} style={{ flex: 1, accentColor: t.primary }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: t.primary, minWidth: 44 }}>{composerHeight === 1 ? "Default" : `${Math.round(composerHeight * 100)}%`}</span>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: t.textMuted, cursor: "pointer" }}>
                <input type="checkbox" checked={composerHeight === 1} onChange={() => setComposerHeight(1)} style={{ accentColor: t.primary, width: 15, height: 15, cursor: "pointer" }} />
                Default
              </label>
            </div>
          </div>

          {/* Bottom bar customizer */}
          <div style={{ padding: "13px 0" }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Bottom bar layout</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10 }}>Toggle and reorder tabs on the bottom navigation bar. Chats is always on.</div>
            {ALL_TABS.map((tabDef) => {
              const activeIdx = navConfig.findIndex((n) => n.key === tabDef.key);
              const isActive = activeIdx !== -1;
              return (
                <div key={tabDef.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isActive ? t.text : t.textMuted, opacity: isActive ? 1 : 0.5 }}>{tabDef.label}{tabDef.mandatory ? " (always on)" : ""}</span>
                  {!tabDef.mandatory && <Toggle on={isActive} onClick={() => toggleTab(tabDef.key)} />}
                  {tabDef.mandatory && <div style={{ width: 46 }} />}
                  {isActive && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <div onClick={() => moveTab(activeIdx, -1)} style={{ width: 26, height: 26, borderRadius: 6, background: activeIdx > 0 ? t.primaryLight : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: activeIdx > 0 ? "pointer" : "default", fontSize: 14, color: activeIdx > 0 ? t.primary : t.textMuted }}>↑</div>
                      <div onClick={() => moveTab(activeIdx, 1)} style={{ width: 26, height: 26, borderRadius: 6, background: activeIdx < navConfig.length - 1 ? t.primaryLight : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: activeIdx < navConfig.length - 1 ? "pointer" : "default", fontSize: 14, color: activeIdx < navConfig.length - 1 ? t.primary : t.textMuted }}>↓</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Row icon={<MessageSquare size={18} color={t.primary} />} label="Link previews" sub={linkPreviewsOn ? "On" : "Off"} right={<Toggle on={linkPreviewsOn} onClick={() => { const next = !linkPreviewsOn; setLinkPreviewsOn(next); localStorage.setItem("nextext_link_previews", next ? "on" : "off"); }} />} />
          <Row icon={<CircleDot size={18} color={t.primary} />} label="Scroll-to-bottom button" sub={showScrollDown ? "On" : "Off"} right={<Toggle on={showScrollDown} onClick={() => setShowScrollDown(!showScrollDown)} />} />
          <Row icon={<CircleDot size={18} color={t.primary} />} label="Animated scroll entry" sub={animatedScrollEntry ? "Smooth jump" : "Instant mount"} right={<Toggle on={animatedScrollEntry} onClick={() => { const next = !animatedScrollEntry; setAnimatedScrollEntry(next); localStorage.setItem("nextext_animated_scroll_entry", next ? "true" : "false"); }} />} />
          <Row icon={<Users size={18} color={t.primary} />} label="Compact chat list" sub={compactList ? "Denser rows" : "Standard spacing"} right={<Toggle on={compactList} onClick={() => { const next = !compactList; setCompactList(next); localStorage.setItem("nextext_compact_list", next ? "true" : "false"); }} />} />
          <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Sort contacts</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Ordering used in the contact list on the Chats tab.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CONTACT_SORT_OPTIONS.map((o) => (
                <div
                  key={o.key}
                  onClick={() => changeContactSort(o.key)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: contactSort === o.key ? t.primary : t.bg,
                    color: contactSort === o.key ? t.bubbleMeText : t.text,
                    border: `1px solid ${contactSort === o.key ? t.primary : t.border}`,
                  }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          </div>
          <Row icon={<Users size={18} color={t.primary} />} label="Hide bottom navigation" sub={hideNav ? "Hidden" : "Visible"} right={<Toggle on={hideNav} onClick={() => setHideNav(!hideNav)} />} />
          <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Sort chats</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Ordering used in the chat list on the Chats tab.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CHAT_SORT_OPTIONS.map((o) => (
                <div
                  key={o.key}
                  onClick={() => changeChatSort(o.key)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: chatSort === o.key ? t.primary : t.bg,
                    color: chatSort === o.key ? t.bubbleMeText : t.text,
                    border: `1px solid ${chatSort === o.key ? t.primary : t.border}`,
                  }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          </div>
          <Row icon={<Search size={18} color={t.primary} />} label="Show search button" sub={searchMode === "button" ? "Search icon hides bar" : "Search bar always visible"} right={<Toggle on={searchMode === "button"} onClick={() => { const next = searchMode === "button" ? "visible" : "button"; setSearchMode(next); localStorage.setItem("nextext_search_mode", next); }} />} />
          <Row icon={<Users size={18} color={t.primary} />} label="Show top bar" sub={topBarVisible ? "Visible" : "Hidden"} right={<Toggle on={topBarVisible} onClick={() => { const next = !topBarVisible; setTopBarVisible(next); localStorage.setItem("nextext_top_bar_visible", String(next)); }} />} />
        </SectionCard>

        {/* ═══ AI CONTROLS ═══ */}
        {userRestrictions?.blockAI !== true && !sysConfig?.hideAiEverywhere && (
          <SectionCard title="AI Controls" emoji="🤖" sectionKey="ai">
            {sysConfig?.aiGloballyDisabled ? (
              <div style={{ padding: "12px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#FF3B30", fontWeight: 600 }}>NexText AI is currently disabled by the administrator.</div>
              </div>
            ) : userDoc?.aiApproved ? (
              <>
                <div style={{ padding: "12px 0", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${t.border}` }}>
                  <Bot size={20} color={t.primary} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>NexText AI Access</div>
                    <div style={{ fontSize: 12.5, color: "#28A745", fontWeight: 600 }}>Approved ✓</div>
                  </div>
                </div>
                <div style={{ padding: "12px 0" }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 14, marginBottom: 8 }}>AI Personality</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {Object.entries(PERSONALITIES).map(([key, p]) => (
                      <div key={key} onClick={() => { setAIPersonality(myUid, key); setLiveUserDoc((prev) => ({ ...(prev || userDoc || {}), aiPersonality: key })); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: userDoc?.aiPersonality === key ? t.primaryLight : t.bg, border: `1px solid ${userDoc?.aiPersonality === key ? t.primary : t.border}`, cursor: "pointer" }}>
                        <span style={{ fontSize: 18 }}>{p.icon}</span>
                        <span style={{ fontWeight: 600, fontSize: 14, color: userDoc?.aiPersonality === key ? t.primary : t.text }}>{p.label}</span>
                        {userDoc?.aiPersonality === key && <span style={{ marginLeft: "auto", color: t.primary, fontWeight: 700 }}>✓</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding: "12px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>Request access to NexText AI, your intelligent chat companion powered by Groq.</div>
                {aiRequestStatus === "requested" || aiRequestStatus === "submitted" || aiRequestStatus === "frozen" ? (
                  <div style={{ fontSize: 13, color: "#856404", fontWeight: 600, padding: "10px 14px", background: "#FFF3CD", borderRadius: 10, lineHeight: 1.5, border: "1px solid #FFEEBA" }}>Request Pending Admin Approval...</div>
                ) : aiRequestStatus === "already_approved" ? (
                  <div style={{ fontSize: 13, color: "#28A745", fontWeight: 600 }}>Already approved! Refresh to see AI features.</div>
                ) : (
                   <button onClick={async () => { if (aiRequestStatus === "frozen") return; setAiRequestStatus("frozen"); try { await requestAIAccess(myUid, userDoc?.username); } catch { /* already submitted */ } }} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer", display: "block", position: "relative", zIndex: 99999, pointerEvents: "auto !important", textAlign: "center" }}>
                    <Sparkles size={16} /> Request AI Access
                  </button>
                )}
              </div>
            )}

            {userDoc?.aiApproved && (
              <>
                <div style={{ padding: "12px 0", borderTop: `1px solid ${t.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>AI Sidebar Widget</div>
                      <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Floating AI shortcut on chat list</div>
                    </div>
                    <div onClick={() => { const next = !aiSidebarOn; setAiSidebarOn(next); localStorage.setItem("nextext_ai_sidebar", next ? "on" : "off"); }} style={{ width: 46, height: 26, borderRadius: 13, background: aiSidebarOn ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: aiSidebarOn ? 23 : 3, transition: "left 0.15s" }} />
                    </div>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        )}

        {/* ═══ ACCOUNT ACTIONS ═══ */}
        <SectionCard title="Account" emoji="⚙️" sectionKey="accountActions">
          <UserStatsCard myUid={myUid} createdAt={userDoc?.createdAt} activeTimeMs={userDoc?.activeTimeMs} />
          <div style={{ marginTop: 8 }} />
          <Row icon={<MessageSquare size={18} color={t.primary} />} label="Send Feedback" sub="Message the admin directly" onClick={() => onNavigate("feedback")} />
          {!sysConfig?.tourDisabled && <Row icon={<Compass size={18} color={t.primary} />} label="Replay Welcome Tour" sub="See the first-run guide again" onClick={(e) => { e.stopPropagation(); onShowTour(); }} />}
          {isAdmin && <Row icon={<ShieldCheck size={18} color={t.primary} />} label="Admin Dashboard" sub="Users, reports, broadcasts" onClick={() => onNavigate("admin")} />}

          <div style={{ padding: "13px 0" }}>
            <button
              onClick={onCheckUpdate}
              disabled={checkingUpdate}
              style={{
                width: "100%", padding: "11px 16px", border: "none",
                background: t.primaryLight, color: t.primary,
                fontWeight: 700, fontSize: 14, cursor: checkingUpdate ? "wait" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: checkingUpdate ? 0.6 : 1,
              }}
            >
              <RefreshCw size={15} style={checkingUpdate ? { animation: "nextext-spin 0.9s linear infinite" } : {}} />
              {checkingUpdate ? "Checking…" : "Check for App Updates"}
            </button>
            {updateStatus && (
              <div style={{ fontSize: 12.5, color: updateStatus.includes("up to date") ? t.primary : "#FF3B30", fontWeight: 600, marginTop: 6, textAlign: "center" }}>{updateStatus}</div>
            )}
            <DownloadApkButton />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Notify me about app updates</span>
              <Toggle on={autoUpdateCheckOn} onClick={() => { const next = !autoUpdateCheckOn; setAutoUpdateCheckOn(next); localStorage.setItem("nextext_auto_update_check", next ? "on" : "off"); }} />
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Automatically check for a new version each time you open the app.</div>
            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 8, textAlign: "center" }}>NexText v{getCurrentVersion()}</div>
          </div>

          <div style={{ padding: "13px 0" }}>
            <button onClick={() => { if (window.confirm("Are you sure you want to reset all settings? This will clear all local preferences (theme, privacy, app lock, etc.) and reload the app. This cannot be undone.")) { const keys = Object.keys(localStorage).filter((k) => k.startsWith("nextext_")); keys.forEach((k) => localStorage.removeItem(k)); window.location.reload(); } }} style={{ width: "100%", padding: "11px 16px", border: "none", background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <RotateCcw size={15} /> Reset all settings
            </button>
          </div>
          {!userDoc?.restrictions?.disableSignOut && (
            <div style={{ padding: "13px 0" }}>
              <button onClick={onLogout} style={{ width: "100%", padding: "11px 16px", borderRadius: 10, border: "none", background: "#FF3B30", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Sign Out</button>
            </div>
          )}
        </SectionCard>

        {/* ═══ DEVELOPER & AI TECH STACK ═══ */}
        {!globalSettings?.hideTechStack && (() => {
          const defaultItems = [
            { label: "Developer", value: "Fred-Systems" },
            { label: "Base App", value: "Built with Claude Sonnet 5" },
            { label: "Advanced Features & Bug Fixing", value: "Big Pickle, Hy 3, DeepSeek V4 Flash, Laguna S 2.1" },
          ];
          const items = techStackDraft || globalSettings?.techStackItems || defaultItems;
          return (
            <SectionCard title="Developer & AI Tech Stack" emoji="🛠️" sectionKey="techstack">
              {items.map((item, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: idx < items.length - 1 ? `1px solid ${t.border}` : "none" }}>
                  {techStackEditing ? (
                    <div style={{ display: "flex", gap: 8, flex: 1, alignItems: "center" }}>
                      <input value={item.label} onChange={(e) => { const next = [...items]; next[idx] = { ...next[idx], label: e.target.value }; setTechStackDraft(next); }} style={{ width: 90, padding: "6px 8px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12, background: t.bg, color: t.text, fontWeight: 600, textTransform: "uppercase" }} placeholder="Label" />
                      <input value={item.value} onChange={(e) => { const next = [...items]; next[idx] = { ...next[idx], value: e.target.value }; setTechStackDraft(next); }} style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, background: t.bg, color: t.text }} placeholder="Value" />
                      <div onClick={() => { const next = items.filter((_, i) => i !== idx); setTechStackDraft(next); }} style={{ width: 28, height: 28, borderRadius: 6, background: "#FFE5E5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, color: "#FF3B30", flexShrink: 0 }}>×</div>
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: t.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{item.label}</div>
                      <div style={{ fontSize: 15, color: t.text, fontWeight: 600, marginTop: 2 }}>{item.value}</div>
                    </div>
                  )}
                </div>
              ))}
              {isAdmin && (
                <div style={{ display: "flex", gap: 8, paddingTop: 10 }}>
                  {techStackEditing ? (
                    <>
                      <div onClick={() => setTechStackDraft([...items, { label: "New", value: "" }])} style={{ padding: "7px 12px", borderRadius: 8, background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 13, cursor: "pointer", flex: 1, textAlign: "center" }}>+ Add Row</div>
                      <div onClick={() => { updateGlobalSettings({ techStackItems: items }, myUid); setTechStackEditing(false); setTechStackDraft(null); }} style={{ padding: "7px 14px", borderRadius: 8, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: "pointer", flex: 1, textAlign: "center" }}>Save</div>
                      <div onClick={() => { setTechStackEditing(false); setTechStackDraft(null); }} style={{ padding: "7px 14px", borderRadius: 8, background: t.border, color: t.textMuted, fontWeight: 700, fontSize: 13, cursor: "pointer", flex: 1, textAlign: "center" }}>Cancel</div>
                    </>
                  ) : (
                    <div onClick={() => setTechStackEditing(true)} style={{ padding: "7px 14px", borderRadius: 8, background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "center" }}>Edit Tech Stack</div>
                  )}
                </div>
              )}
            </SectionCard>
          );
        })()}
      {resetPasswordModal && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { setResetPasswordModal(false); setResetPasswordInput(""); }}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 20, maxWidth: 350, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Reset App Lock Password</span>
              <span onClick={() => { setResetPasswordModal(false); setResetPasswordInput(""); }} style={{ cursor: "pointer", color: t.textMuted, fontSize: 18 }}>×</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 16 }}>Enter your current password to reset the app lock.</div>
            <input
              type="password"
              value={resetPasswordInput}
              onChange={(e) => setResetPasswordInput(e.target.value)}
              placeholder="Current password"
              autoFocus
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14.5, color: t.text, background: t.surface, outline: "none", boxSizing: "border-box", marginBottom: 16 }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <div onClick={() => { setResetPasswordModal(false); setResetPasswordInput(""); }} style={{ padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: t.textMuted }}>Cancel</div>
              <div onClick={() => { const old = localStorage.getItem("nextext_app_lock_pass"); if (resetPasswordInput !== old) { alert("Incorrect password."); return; } localStorage.removeItem("nextext_app_lock_pass"); localStorage.setItem("nextext_app_lock", "pending"); setAppLockPassSaved(false); setResetPasswordModal(false); setResetPasswordInput(""); }} style={{ padding: "9px 16px", borderRadius: 10, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Reset</div>
            </div>
          </div>
        </div>
)}
      {disableLockModal && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 71, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { setDisableLockModal(false); setDisableLockInput(""); setDisableLockError(false); }}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 20, maxWidth: 350, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Turn off App protection lock</span>
              <span onClick={() => { setDisableLockModal(false); setDisableLockInput(""); setDisableLockError(false); }} style={{ cursor: "pointer", color: t.textMuted, fontSize: 18 }}>×</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 16 }}>Enter your current password to turn off the app protection lock.</div>
            <input
              type="password"
              value={disableLockInput}
              onChange={(e) => { setDisableLockInput(e.target.value); setDisableLockError(false); }}
              placeholder="Current password"
              autoFocus
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${disableLockError ? "#FF3B30" : t.border}`, fontSize: 14.5, color: t.text, background: t.surface, outline: "none", boxSizing: "border-box", marginBottom: 16 }}
            />
            {disableLockError && <div style={{ color: "#FF3B30", fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Incorrect password.</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <div onClick={() => { setDisableLockModal(false); setDisableLockInput(""); setDisableLockError(false); }} style={{ padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: t.textMuted }}>Cancel</div>
              <div onClick={() => { const old = localStorage.getItem("nextext_app_lock_pass"); if (disableLockInput !== old) { setDisableLockError(true); return; } setAppLockEnabled(false); setAppLockPassSaved(false); localStorage.setItem("nextext_app_lock", "false"); localStorage.removeItem("nextext_app_lock_pass"); setDisableLockModal(false); setDisableLockInput(""); setDisableLockError(false); }} style={{ padding: "9px 16px", borderRadius: 10, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Turn off</div>
            </div>
          </div>
        </div>
)}
      </div>
    </div>
  );
}

const DEFAULT_NAV_CONFIG = [{ key: "chats" }, { key: "status" }, { key: "groups" }, { key: "settings" }];
const TAB_KEYS = ["chats", "status", "groups", "settings"];

// Coerce any stored shape of the bottom-nav config (older builds persisted a
// bare array of strings like ["chats","status"]) into the canonical
// [{key:...}] form, dropping unknown keys. Returns null when nothing usable
// was stored so callers can fall back to DEFAULT_NAV_CONFIG.
function normalizeNavConfig(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const entry of input) {
    const key = typeof entry === "string" ? entry : entry?.key;
    if (key && TAB_KEYS.includes(key) && !out.some((e) => e.key === key)) out.push({ key });
  }
  return out.length >= 2 ? out : null;
}

const TOUR_STEPS = [
  { target: null, tab: null, emoji: "👋", title: "Welcome to NexText", body: "A fast, private messaging app for you and your friends. I'll walk you through the app — tap Next to explore it live." },
  { target: "chats", tab: "chats", emoji: "💬", title: "Chats", body: "This is your chat list. Tap a conversation to open it, or the + button to start a new chat. Long-press any chat for extra actions. Try tapping the Chats tab at the bottom." },
  { target: "status", tab: "status", emoji: "📸", title: "Status & Media", body: "Post photo/video statuses your contacts can see for 24 hours. In any chat, the paperclip lets you share images, videos, voice notes, and files." },
  { target: "groups", tab: "groups", emoji: "👥", title: "Groups", body: "Create groups with your friends, broadcast lists, and organized conversations. The Groups tab filters your group chats." },
  { target: "settings", tab: "settings", emoji: "🔒", title: "Privacy & Settings", body: "Everything lives here: themes, privacy controls, permissions, chat locks, and parental controls. Swipe or tap the tabs below to move around." },
  { target: null, tab: null, emoji: "🤖", title: "NexText AI", body: "NexText AI is request-only — not everyone has it by default. If you want the assistant (8 personalities, image analysis, chat summaries), ask for access in Settings → NexText AI." },
  { target: null, tab: null, emoji: "🎉", title: "You're all set!", body: "That's the tour! Need help, found a bug, or want something added? Send a message to the admin anytime from Settings → Account → Send Feedback — it goes straight to them. Have fun!" },
];

function TourOverlay({ step, total, onNext, onPrev, onSkip }) {
  const s = TOUR_STEPS[step];
  const [rect, setRect] = useState(null);
  const measure = useCallback(() => {
    if (!s?.target) { setRect(null); return; }
    const el = document.querySelector(`[data-tour-nav="${s.target}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.target]);
  useEffect(() => {
    measure();
    // Re-measure after the page settles (the tour navigates the app live, so
    // the target's position changes as screens mount) and keep polling while
    // the tour is open so the spotlight stays glued to the nav tab even if
    // the user taps around.
    const t = setTimeout(measure, 380);
    const t2 = setTimeout(measure, 900);
    const poll = setInterval(measure, 600);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); clearTimeout(t2); clearInterval(poll); window.removeEventListener("resize", measure); };
  }, [measure]);
  if (!s) return null;
  const zBackdrop = 2147483600;
  const zHole = 2147483645;
  const zCard = 2147483646;
  const cardStyle = {
    position: "fixed", top: 28, left: 14, right: 14, zIndex: zCard,
    background: "#121B22", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18,
    padding: "20px 18px 16px", boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  };
  return (
    <>
      {/* Dim everything except the spotlighted target.
          The spotlight uses a huge box-shadow "hole" so the rest of the app is
          dimmed around the target. CRITICAL: the spread must be screen-sized
          (100vmax), NOT a giant fixed pixel value (9999px) — a ~20,000px
          shadow layer is exactly the kind of massive paint region that stalls
          the Android WebView compositor on cold start (app visually painted
          but interaction-dead, bottom nav not repainted — the "dead app until
          you tap Settings" bug). */}
      {rect ? (
        <div style={{ position: "fixed", left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: zHole, boxShadow: "0 0 0 100vmax rgba(0,0,0,0.72)", borderRadius: 12, pointerEvents: "none", transition: "left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease" }} />
      ) : (
        <div style={{ position: "fixed", inset: 0, zIndex: zBackdrop, background: "rgba(0,0,0,0.72)", pointerEvents: "none" }} />
      )}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 26 }}>{s.emoji}</span>
          <span style={{ fontWeight: 800, fontSize: 18, color: "#fff" }}>{s.title}</span>
        </div>
        <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.55, marginBottom: 16 }}>{s.body}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {TOUR_STEPS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i === step ? "#10B981" : "rgba(255,255,255,0.25)", transition: "all 0.25s" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && <button onClick={onPrev} style={{ padding: "11px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "#fff", fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Back</button>}
          <button onClick={onSkip} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "#fff", fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Skip</button>
          <button onClick={onNext} style={{ flex: 1.5, padding: "11px 0", borderRadius: 12, border: "none", background: "#10B981", color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>{step === total - 1 ? "Start Using NexText" : "Next"}</button>
        </div>
      </div>
    </>
  );
}

function AppShell({ appLocked, setAppLocked }) {
  const { t, themeKey, setThemeKey, hideNav, appFont } = useTheme();
  const auth = useAuth();
  useSystemInsets();
  const globalSettings = useGlobalSettings();
  const sysConfig = useSystemConfigHook();
  const [screen, setScreen] = useState("list");
  const [activeChat, setActiveChat] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);
  const [uiScale, setUiScale] = useState(() => Number(localStorage.getItem(UI_SCALE_KEY)) || 1);
  const [recordingBarScale, setRecordingBarScale] = useState(() => { try { const v = Number(localStorage.getItem("nextext_recording_bar_scale")); return v && v >= 0.6 && v <= 1.6 ? v : 1; } catch { return 1; } });
  const [showScrollDown, setShowScrollDown] = useState(() => localStorage.getItem(SCROLL_DOWN_KEY) !== "false");
  const [animatedScrollEntry, setAnimatedScrollEntry] = useState(() => localStorage.getItem("nextext_animated_scroll_entry") === "true");
  const [compactList, setCompactList] = useState(() => localStorage.getItem("nextext_compact_list") === "true");
  const [showThemeSheet, setShowThemeSheet] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState("chats");
  const [userRestrictions, setUserRestrictions] = useState(null);
  const [liveUserDoc, setLiveUserDoc] = useState(auth.userDoc);
  const [navConfig, setNavConfig] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("nextext_nav_config"));
      const normalized = normalizeNavConfig(stored);
      if (normalized) return normalized;
    } catch { /* ignore */ }
    return DEFAULT_NAV_CONFIG;
  });
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(() => localStorage.getItem("nextext_splash_enabled") !== "off");
  const [splashVisible, setSplashVisible] = useState(() => localStorage.getItem("nextext_splash_enabled") !== "off");
  const [splashFading, setSplashFading] = useState(false);
  const [aiSidebarOn, setAiSidebarOn] = useState(() => localStorage.getItem("nextext_ai_sidebar") !== "off");
  const [searchMode, setSearchMode] = useState(() => localStorage.getItem("nextext_search_mode") || "visible");
  const [topBarVisible, setTopBarVisible] = useState(() => localStorage.getItem("nextext_top_bar_visible") !== "false");
  const [animateOnTap, setAnimateOnTap] = useState(() => localStorage.getItem("nextext_animate_on_tap") === "true");
  const [swipeAnimationOn, setSwipeAnimationOn] = useState(() => localStorage.getItem("nextext_swipe_animation") !== "off");
  const [swipeSpeed, setSwipeSpeed] = useState(() => { try { return localStorage.getItem("nextext_swipe_speed") || "normal"; } catch { return "normal"; } });
  const [searchBarScale, setSearchBarScale] = useState(() => { try { return Number(localStorage.getItem("nextext_search_bar_scale")) || 1; } catch { return 1; } });
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pagerDragging, setPagerDragging] = useState(false);
  const [linkPreviewsOn, setLinkPreviewsOn] = useState(() => localStorage.getItem("nextext_link_previews") !== "off");
  const [pinchZoomOn, setPinchZoomOn] = useState(() => localStorage.getItem("nextext_pinch_zoom") !== "false");
  const [voiceEndChimeOn, setVoiceEndChimeOn] = useState(() => localStorage.getItem("nextext_voice_end_chime") !== "off");
  const [pingSoundId, setPingSoundId] = useState(() => { try { return localStorage.getItem("nextext_voice_ping_sound") || "warm"; } catch { return "warm"; } });
  const [voicePlayerStyle, setVoicePlayerStyle] = useState(() => { try { return localStorage.getItem("nextext_voice_player_style") || "waveform"; } catch { return "waveform"; } });
  const [micMode, setMicMode] = useState(() => { try { return localStorage.getItem("nextext_mic_mode") || "hold"; } catch { return "hold"; } });
  const changeMicMode = (mode) => {
    setMicMode(mode);
    try { localStorage.setItem("nextext_mic_mode", mode); } catch {}
  };
  const [autoUpdateCheckOn, setAutoUpdateCheckOn] = useState(() => localStorage.getItem("nextext_auto_update_check") !== "off");
  const shellRef = useRef(null);
  const pageRefs = useRef({});
  const pagerDragRef = useRef(null);
  // True for the brief snap window after a swipe ends, so React applies the
  // animated transition while the transform jumps to the target index (CSS
  // animates from the last drag position). Avoids the old setTimeout-deferred
  // nav commit that could be dropped on unmount/background and strand the
  // pager on a stale page.
  const [snapAnimating, setSnapAnimating] = useState(false);
  const snapTimerRef = useRef(null);

  // ── App state persistence ──────────────────────────────────────────
  // Persists navigation state to localStorage so relaunching the app
  // restores the last screen, active tab, open chat/group and bottom nav
  // configuration. Keyed by uid so one user's state never leaks to another.
  // Transient overlays (splash, theme sheet, story viewer) are intentionally
  // excluded — they must never be reopened from a cold start.
  const saveAppState = () => {
    try {
      const state = {
        myUid,
        screen,
        activeNavTab,
        activeChat,
        activeGroup,
        uiScale,
        showScrollDown,
        animatedScrollEntry,
        compactList,
        navConfig,
        searchMode,
        topBarVisible,
        animateOnTap,
        searchBarScale,
        aiSidebarOn,
      };
      localStorage.setItem("nextext_app_state", JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save app state:", e);
    }
  };

  // Always-fresh reference so the backgrounded listener (registered once in
  // a []-dep effect) never captures stale state via a closure.
  const saveAppStateRef = useRef(saveAppState);
  saveAppStateRef.current = saveAppState;

  // Declared before restoreAppState: the restore effect below references it in
  // its dependency array, and deps are evaluated during render (a const
  // declared later in the same scope would be in the temporal dead zone).
  const myUid = auth.user?.uid;
  // Ref mirror of myUid so mount-only effects (notification tap/mark-read
  // handlers) can read the CURRENT uid without a stale closure.
  const myUidRef = useRef(myUid);
  useEffect(() => { myUidRef.current = myUid; }, [myUid]);

  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  const storyViewerOpenRef = useRef(storyViewerOpen);
  useEffect(() => { storyViewerOpenRef.current = storyViewerOpen; }, [storyViewerOpen]);
  const tourVisibleRef = useRef(showTour);
  useEffect(() => { tourVisibleRef.current = showTour; }, [showTour]);

  const restoreAppState = () => {
    try {
      const raw = localStorage.getItem("nextext_app_state");
      if (!raw) return;
      const state = JSON.parse(raw);
      // Strict per-uid guard: only restore state saved by this exact user.
      // (A state saved mid-sign-out has myUid null/undefined and must not
      // steer a fresh sign-in onto a stale screen — the cause of a missing
      // bottom nav / blank pager on first login.)
      if (state.myUid !== myUid) return;
      // Always land on the chat list on cold start — restoring a deep screen
      // like "chat" left the bottom bar hidden and the user stranded inside a
      // conversation they couldn't back out of without first tapping the
      // unrelated Settings gear. Tabs (activeNavTab) only meaningfully apply
      // on the list screen, so we also normalize that back to "chats" so the
      // first thing the user sees is every chat (groups + 1-on-1s).
      setScreen("list");
      setActiveNavTab("chats");
      // Still restore other persisted prefs/configs below:
      if (state.activeChat) setActiveChat(state.activeChat);
      if (state.activeGroup) setActiveGroup(state.activeGroup);
      if (state.uiScale !== undefined) setUiScale(state.uiScale);
      if (state.showScrollDown !== undefined) setShowScrollDown(state.showScrollDown);
      if (state.animatedScrollEntry !== undefined) setAnimatedScrollEntry(state.animatedScrollEntry);
      if (state.compactList !== undefined) setCompactList(state.compactList);
      if (Array.isArray(state.navConfig)) {
        const normalized = normalizeNavConfig(state.navConfig);
        if (normalized) setNavConfig(normalized);
      }
      if (state.searchMode) setSearchMode(state.searchMode);
      if (state.topBarVisible !== undefined) setTopBarVisible(state.topBarVisible);
      if (state.animateOnTap !== undefined) setAnimateOnTap(state.animateOnTap);
      if (state.searchBarScale !== undefined) setSearchBarScale(state.searchBarScale);
      if (state.aiSidebarOn !== undefined) setAiSidebarOn(state.aiSidebarOn);
    } catch (e) {
      console.warn("Failed to restore app state:", e);
    }
  };

  // Restore the last session once the user identity is known.
  useEffect(() => {
    if (!myUid) return;
    restoreAppState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid]);

// Cold-start safety net. Runs IMMEDIATELY AFTER the restore effect so any late
  // state writes (a notification tap routing to screen="chat" before the chat
  // list loaded, a stale mid-sign-out app_state, a blocked tab in navConfig)
  // are corrected. Guarantees the app always lands on the chat list with the
  // bottom nav visible — the reported "bottom bar missing / dead group row
  // until I tap Settings" cold start. Only fires once per user session.
  // Also forces a fresh re-render of the pager (mirroring the manual "tap
  // Settings" navigation that the user confirmed fixes it) so a stale inline
  // transform or paint glitch on a pager page can't strand the app.
  const [bootKick, setBootKick] = useState(0);
  const bootLockedRef = useRef(false);
  const [coldStartComplete, setColdStartComplete] = useState(false);
  // While true, the in-app splash stays fully opaque. The awake-kick releases
  // it once the cold-start repair has run, so the Settings-trip recovery
  // happens invisibly behind the splash instead of flashing the screen.
  const [splashHold, setSplashHold] = useState(true);
  // Hold the splash long enough for the awake-kick cold-start repair to run
  // BEHIND it. On the auth screen (no chat interface yet) a plain 8s fallback
  // releases it. After login/sign-up the splash is re-held until the awake-kick
  // finishes, so the recovery's screen trip can never flash — even when the
  // user spent minutes on the sign-up screen (the old mount-only timer would
  // have expired long before the chat interface first appeared).
  useEffect(() => {
    if (!myUid) {
      const t = setTimeout(() => setSplashHold(false), 8000);
      return () => clearTimeout(t);
    }
    if (localStorage.getItem("nextext_splash_enabled") !== "off") {
      setSplashFading(false);
      setSplashVisible(true);
    }
    setSplashHold(true);
    // Hard fallback so the re-held splash can never trap the user even if the
    // awake-kick effect is deferred (e.g. by the welcome tour).
    const t = setTimeout(() => setSplashHold(false), 12000);
    return () => clearTimeout(t);
  }, [myUid]);
  // Opaque full-screen cover shown ONLY while the Settings-trip recovery runs.
  // Unlike the splash (skippable in Settings / never shows if the user turned
  // it off), this cover is independent of any setting, so the trip is always
  // guaranteed hidden even on devices with the splash disabled.
  const [repairCoverOn, setRepairCoverOn] = useState(false);
  useEffect(() => {
    if (!myUid) return;
    // Run synchronously (0ms) to ensure coldStartComplete is true before
    // any notification tap handler can process a pending chatId.
    const t = setTimeout(() => {
      setScreen((prev) => {
        if (["list", "status", "settings"].includes(prev)) return prev;
        return "list";
      });
      setActiveNavTab((prev) => (TAB_KEYS.includes(prev) ? prev : "chats"));
      setBootKick((n) => n + 1);
      setColdStartComplete(true);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid]);

  // Story-viewer invariant: the viewer is only ever mounted while the Status
  // tab is on screen. If storyViewerOpen sticks true on any other screen it
  // silently hides the bottom nav (bar renders only when !hideNav &&
  // !storyViewerOpen && screen is a tab), stranding the user. Enforce it on
  // every render so a stale viewer can never suppress the bar again.
  useEffect(() => {
    if (storyViewerOpen && screen !== "status") setStoryViewerOpen(false);
  }, [storyViewerOpen, screen]);

  // Boot diagnostic: record the bottom-bar-relevant state once the cold-start
  // safety net has run. If the bar is ever reported missing again this is the
  // ground truth (state vs geometry) — e.g. it will show hideNav=true (bar
  // intentionally hidden), uiScale>1 (scale clipping), or a healthy snapshot
  // that points to a rendering/geometry issue instead of app state.
  useEffect(() => {
    if (!coldStartComplete) return;
    try {
      window.__nxCapturedErrors.push(
        `DIAG boot screen=${screen} tab=${activeNavTab} hideNav=${hideNav} story=${storyViewerOpen} uiScale=${uiScale} topBar=${topBarVisible} navKeys=${(navConfig || []).map((n) => n.key).join(",")} viewport=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`
      );
    } catch {
      /* diagnostics must never crash the app */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coldStartComplete]);

  // Awake-kick watchdog. On cold starts the Android WebView compositor can
  // stall right after the app's first frame: the bottom nav is painted out of
  // the frame entirely (its DOM node is present, but never composited on top —
  // the "bar missing" symptom) and only a real navigation forces a fresh
  // composite that includes it. Only such a navigation reliably fixes it
  // (translateZ promotion and single-task repaint nudges don't — an identical
  // painted output legitimately never triggers a repaint). So this replicates
  // the user's manual Settings trip, but runs it BEHIND the still-opaque
  // splash screen: the splash is held open until the repair completes, so the
  // user never sees the flash or a missing bar — it just appears with the bar
  // already there.
  //   1. Probe whether the compositor is actually alive: requestAnimationFrame
  //      is driven by the WebView's frame scheduler, so a stalled compositor
  //      stops servicing RAF callbacks.
  //   2. Hit-test the bar at multiple points; if it isn't on top, try invisible
  //      repaint kicks first (a persistent 0.1px layout change included), and
  //      only fall back to the visible-free Settings trip if they don't take.
  //   3. Always release the splash hold afterwards (a 6s safety fallback also
  //      guarantees the splash can never trap the user).
  // Deferred while the welcome tour is up (its backdrop legitimately covers the
  // bar and re-runs when the tour ends).
  useEffect(() => {
    if (!coldStartComplete) return;
    if (showTour) return; // defer — re-runs when the tour ends
    let cancelled = false;
    const settle = setTimeout(async () => {
      const waitForBarDom = () => new Promise((resolve) => {
        let waited = 0;
        const check = () => {
          if (cancelled) { resolve(); return; }
          if (document.querySelector("[data-tour-nav]")) { resolve(); return; }
          waited += 200;
          if (waited >= 2500) { resolve(); return; }
          setTimeout(check, 200);
        };
        check();
      });
      await waitForBarDom();
      if (cancelled) { setSplashHold(false); return; }
      let diag = "DIAG awake-skip";
      try {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));
        const rafAlive = () => new Promise((resolve) => {
          if (document.visibilityState === "hidden") { resolve(true); return; }
          let settled = false;
          const done = (v) => { if (!settled) { settled = true; resolve(v); } };
          try { requestAnimationFrame(() => done(true)); } catch { done(false); }
          setTimeout(() => done(false), 300);
        });
        const barOnTop = () => {
          try {
            // Multi-point probe across the bar (25%/50%/75% width) so a single
            // point landing on a tab border/gap can't cause a false negative.
            for (const fx of [0.25, 0.5, 0.75]) {
              const cx = Math.floor(window.innerWidth * fx);
              const cy = Math.max(0, Math.floor(window.innerHeight - 30));
              let node = document.elementFromPoint(cx, cy);
              while (node && node !== document.documentElement) {
                if (node.hasAttribute && node.hasAttribute("data-tour-nav")) return true;
                node = node.parentElement;
              }
            }
          } catch { /* best-effort */ }
          return false;
        };
        // Force the bar into the compositor's frame. The PERSISTENT 0.1px
        // change is the important part: reverted-in-one-task kicks leave the
        // painted output identical, so the WebView correctly skips repainting
        // an unchanged frame and the bar never gets recomposited.
        const forceRepaint = () => {
          const shellEl = document.getElementById("nextext-app-shell");
          if (shellEl) {
            try {
              const prevTransform = shellEl.style.transform;
              const prevTransition = shellEl.style.transition;
              shellEl.style.transition = "none";
              shellEl.style.transform = "scale(0.9998)";
              shellEl.style.transformOrigin = "top left";
              if (!/0\.1px/.test(shellEl.style.paddingBottom || "")) {
                shellEl.style.paddingBottom = "calc(var(--safe-bottom) + 0.1px)";
              }
              void shellEl.offsetHeight;
              shellEl.style.transform = prevTransform;
              shellEl.style.transition = prevTransition;
            } catch { /* best-effort */ }
          }
          try {
            const bar = document.querySelector("[data-tour-nav]");
            const wrap = bar?.parentElement;
            if (wrap) {
              const prevVis = wrap.style.visibility;
              const prevZ = wrap.style.zIndex;
              wrap.style.visibility = "hidden";
              wrap.style.zIndex = "1001";
              void wrap.offsetHeight;
              wrap.style.visibility = prevVis;
              wrap.style.zIndex = prevZ;
            }
          } catch { /* best-effort */ }
        };
        const tripRecovery = async () => {
          // A real navigation is the only thing that reliably forces the
          // compositor to re-composite WITH the bottom bar. Run it under the
          // opaque repair cover so it can never flash — this cover works even
          // when the splash is disabled (unlike the splash-hold). The trip
          // itself stays on the same-looking list UI (a chats <-> groups tab
          // toggle, or list <-> status) instead of jumping to Settings, so
          // even if the cover were somehow never painted the user would only
          // ever see the chat list — never a Settings flash.
          const cur = screenRef.current;
          setRepairCoverOn(true);
          if (cur === "status") {
            setScreen("list");
            setActiveNavTab("chats");
            await delay(50);
            await delay(350);
            setScreen("status");
          } else {
            setScreen("list");
            setActiveNavTab((prev) => (prev === "groups" ? "chats" : "groups"));
            await delay(50);
            await delay(350);
            setActiveNavTab("chats");
          }
          setBootKick((n) => n + 1);
          await delay(120);
          setRepairCoverOn(false);
        };
        const onTab = ["list", "status", "settings"].includes(screenRef.current);
        const wantBar = onTab && !hideNav && !storyViewerOpenRef.current && !tourVisibleRef.current;
        const barOK = !wantBar || barOnTop();
        const rafOK = await rafAlive();
        if (!rafOK) {
          // Compositor is probably stalled (double-check: a single missed frame
          // can happen while fonts/layout settle).
          await delay(500);
          const rafOK2 = await rafAlive();
          if (!rafOK2) {
            diag = `DIAG awake RECOVERED screen=${screenRef.current} tabOk=${onTab} wantBar=${wantBar} barHit=${barOK} raf=dead`;
            if (!cancelled) await tripRecovery();
            const recovered = await rafAlive();
            diag += ` after=${recovered ? "alive" : "STILL-DEAD"}`;
          } else {
            diag = `DIAG awake ok screen=${screenRef.current} tabOk=${onTab} wantBar=${wantBar} barHit=${barOK} raf=slow`;
          }
        } else if (wantBar && !barOK) {
          // Bar DOM exists but isn't composited on top. Try invisible repaints
          // first; only fall back to the Settings trip (hidden under the
          // repair cover) if they genuinely don't take.
          let fixed = false;
          for (let attempt = 0; attempt < 2 && !fixed; attempt++) {
            forceRepaint();
            await delay(200);
            fixed = barOnTop();
          }
          if (fixed) {
            diag = `DIAG awake bar-fixed screen=${screenRef.current} tabOk=${onTab} wantBar=${wantBar} barHit=->true raf=alive invisible`;
          } else {
            diag = `DIAG awake BARFIX screen=${screenRef.current} tabOk=${onTab} wantBar=${wantBar} barHit=${barOK} raf=alive trip`;
            if (!cancelled) await tripRecovery();
          }
        } else {
          diag = `DIAG awake ok screen=${screenRef.current} tabOk=${onTab} wantBar=${wantBar} barHit=${barOK} raf=alive`;
        }
      } catch (err) {
        diag = `DIAG awake-error ${err?.message || err}`;
      }
      try { window.__nxCapturedErrors.push(diag); } catch { /* best-effort */ }
      // Release the splash so it fades normally — any recovery above already
      // ran under the opaque repair cover (or behind the still-held splash),
      // so nothing ever flashes. A separate 8s fallback guarantees the splash
      // can't trap the user even if this effect never reaches this point.
      setSplashHold(false);
    }, 2200);
    return () => { cancelled = true; clearTimeout(settle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coldStartComplete, showTour]);

  const swipeAnimationEnabled = () => swipeAnimationOn;

  // Duration (s) for the swipe snap animation, chosen by the Settings slider.
  // WhatsApp/iOS use a short, fast slide (~200-250ms) — we keep that feel.
  const swipeDuration = () => {
    if (swipeSpeed === "slow") return 0.32;
    if (swipeSpeed === "fast") return 0.1;
    return 0.18;
  };

  // iOS-style momentum curve: very fast start, smooth deceleration, no bounce.
  // Using transform translate3d with this curve yields iOS-feel smooth swiping.
  const swipeBezier = () => "cubic-bezier(0.16, 1, 0.3, 1)";

  // Tap navigation transitions — by default OFF (instant page jump).
  // The "Animate tab taps (animateOnTap)" Setting overrides this so that
  // tapping a bottom or top bar nav button uses the same slide animation
  // as a swipe would.
  const tapTransition = () => {
    if (!animateOnTap) return "none";
    return `left ${swipeDuration()}s ${swipeBezier()}`;
  };

  usePresenceHeartbeat(myUid);
  useAppUsageTracker(myUid);

  const [pendingNotifChatId, setPendingNotifChatId] = useState(null);

  useEffect(() => {
    setNotificationTapHandler((chatId) => setPendingNotifChatId(chatId));
    // A tapped notification on a cold start fires before any JS listener
    // exists; the native side holds the chatId until we poll for it here.
    pollPendingNotificationTap();
    // "Mark as read" action on a notification: zero the chat's unread badge
    // without opening the conversation. Same cold-start polling applies.
    setNotificationMarkReadHandler((chatId) => {
      if (myUidRef.current && chatId) markChatRead(chatId, myUidRef.current).catch(() => {});
    });
    pollPendingMarkRead();
    // Retry once the splash is out of the way in case the bridge wasn't
    // ready for the first read.
    const retry = setTimeout(() => pollPendingNotificationTap(), 2500);
    const retryMarkRead = setTimeout(() => pollPendingMarkRead(), 2500);
    return () => { setNotificationTapHandler(null); setNotificationMarkReadHandler(null); clearTimeout(retry); clearTimeout(retryMarkRead); };
  }, []);

  useEffect(() => {
    if (!myUid) return;
    // Ask for notification permission once per user (a short delay after login
    // so it doesn't interrupt first paint). They can manage it later from
    // Settings → Privacy & Security → Permissions.
    const key = `nextext_notif_asked_${myUid}`;
    if (localStorage.getItem(key) === "true") return;
    localStorage.setItem(key, "true");
    const t = setTimeout(() => { initNotifications(myUid).catch(() => {}); }, 5000);
    return () => clearTimeout(t);
  }, [myUid]);

  // First-run welcome tour: shown once per installed version (so an update
  // brings it back so users can see what's new), skippable, unless the admin
  // has disabled tours globally. Re-takeable from Settings.
  useEffect(() => {
    if (!myUid || !auth.userDoc?.profileComplete) return;
    if (sysConfig?.tourDisabled) return;
    const seenKey = `nextext_tour_seen_${myUid}`;
    if (localStorage.getItem(seenKey) === getCurrentVersion()) return;
    localStorage.setItem(seenKey, getCurrentVersion());
    const t = setTimeout(() => { startTour(); }, 4200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, auth.userDoc?.profileComplete]);

  const finishTour = () => { setShowTour(false); setTourStep(0); };
  const startTour = useCallback(() => {
    console.log("[Tour] startTour called");
    setTourStep(0);
    setShowTour(true);
  }, []);

  // Interactive tour navigation: each step may jump to a tab so the user sees
  // the real screens the guide is describing (spotlighted by TourOverlay).
  const goTourStep = (idx) => {
    const s = TOUR_STEPS[idx];
    if (s?.tab) navigateToTab(s.tab);
    setTourStep(idx);
  };

  const { contacts } = useContacts(myUid);
  const { chats: myChats } = useChats(myUid);
  const totalUnreadChats = (myChats || []).reduce((sum, c) => sum + (c.unreadCount?.[myUid] || 0), 0);
  const contactUids = (contacts || []).filter((c) => c.status === "accepted").map((c) => c.uid);
  const allStatusUids = [myUid, ...contactUids];
  const allStatuses = useStatuses(myUid ? allStatusUids : []);

  const VIEWED_KEY = "nextext_status_viewed";
  let unreadStatusCount = 0;
  if (myUid) {
    try {
      const raw = localStorage.getItem(VIEWED_KEY);
      const viewedMap = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const activeOwnerUids = new Set(allStatuses.filter((s) => s.ownerId !== myUid).map((s) => s.ownerId));
      for (const uid of activeOwnerUids) {
        const viewedTs = viewedMap[uid];
        if (!viewedTs || (now - viewedTs) > 24 * 60 * 60 * 1000) unreadStatusCount++;
      }
    } catch { unreadStatusCount = 0; }
  }

  useEffect(() => { localStorage.setItem("nextext_nav_config", JSON.stringify(navConfig)); }, [navConfig]);

  useEffect(() => {
    if (!myUid) return;
    purgeExpiredStatuses(myUid);
  }, [myUid]);

  // Auto-delete chat media that has passed its expiry window (default 3 days,
  // admin-adjustable). Deletes the Supabase storage files and flags the
  // message docs as expired. Runs once per signed-in session.
  useEffect(() => {
    if (!myUid || globalSettings?.mediaExpiryDays == null) return;
    purgeExpiredChatMedia(myUid, globalSettings.mediaExpiryDays).catch(() => {});
  }, [myUid, globalSettings?.mediaExpiryDays]);

  useEffect(() => {
    if (!auth.user?.uid) return;
    const unsub = onSnapshot(doc(db, "users", auth.user.uid), (snap) => {
      const data = snap.data() || null;
      setUserRestrictions(data?.restrictions || null);
      setLiveUserDoc(data);
    });
    return unsub;
  }, [auth.user?.uid]);

  // Client-side foreground notifications: Firestore onSnapshot on each chat's
  // messages collection that fires showLocalNotification when a new message
  // arrives from someone else while the app is in the foreground. This is the
  // ONLY notification path (no Cloud Functions → no real FCM push), so without
  // this the user gets zero audible/visible alerts on Android 11.
  useEffect(() => {
    if (!auth.user?.uid) return;
    const uid = auth.user.uid;
    const since = Date.now();
    const unsubs = [];
    // Cache of sender display names so a one-off Firestore lookup isn't
    // repeated per message. Keyed by sender uid.
    const nameCache = {};
    const resolveSenderName = async (senderId) => {
      if (nameCache[senderId]) return nameCache[senderId];
      const known = (contacts || []).find((c) => c.uid === senderId);
      if (known?.profile?.displayName || known?.profile?.username) {
        nameCache[senderId] = known.profile.displayName || known.profile.username;
        return nameCache[senderId];
      }
      try {
        const snap = await getDoc(doc(db, "users", senderId));
        const data = snap.exists() ? snap.data() : null;
        nameCache[senderId] = data?.displayName || data?.username || "Unknown";
      } catch {
        nameCache[senderId] = "Unknown";
      }
      return nameCache[senderId];
    };
    // Watch the user's chats collection, attach a message listener to each.
    const chatsQuery = query(collection(db, "chats"), where("participants", "array-contains", uid));
    // Live chat-doc map so message listeners always read the current lock
    // state even if a chat gets locked/group-renamed after they attached.
    const chatDataMap = {};
    const unsubChats = onSnapshot(chatsQuery, (snap) => {
      snap.docChanges().forEach((change) => {
        const chatId = change.doc.id;
        if (change.type !== "added" && change.type !== "modified") return;
        chatDataMap[chatId] = change.doc.data() || {};
        // Attach a message listener to this chat if we haven't already.
        if (unsubs.find((u) => u.chatId === chatId)) return;
        const msgQ = query(collection(db, "chats", chatId, "messages"), orderBy("sentAt", "desc"));
        const unsubMsg = onSnapshot(msgQ, (msgSnap) => {
          msgSnap.docChanges().forEach(async (mc) => {
            if (mc.type !== "added") return;
            const m = mc.doc.data();
            if (!m.sentAt?.toMillis) return;
            if (m.sentAt.toMillis() < since) return;         // skip old messages
            if (m.senderId === uid) return;                  // skip own messages
            if (m.deletedForSelf?.includes(uid)) return;
            // Parental controls: don't alert for blocked message types (the
            // bubbles are hidden in-chat too, so the notification must not
            // leak them).
            if (m.type === "voice" && userRestrictions?.blockVoiceNotes === true) return;
            if (m.type === "image" && userRestrictions?.blockIncomingPhotos === true) return;
            if (m.type === "video" && userRestrictions?.blockIncomingVideos === true) return;
            if (m.isScheduled && m.scheduledFor?.toMillis && m.scheduledFor.toMillis() > Date.now()) return;
            // Don't notify if the user is currently inside THIS chat.
            if (activeChat?.chatId === chatId && document.visibilityState === "visible") return;
            const senderName = await resolveSenderName(m.senderId);
            const chatData = chatDataMap[chatId] || {};
            const isGroup = !!chatData.groupName;
            // Privacy: a chat locked by this user, or the whole-app lock, hides
            // sender + content from the notification — just a generic alert.
            const appLockEnabled = localStorage.getItem("nextext_app_lock") === "true" || (localStorage.getItem("nextext_app_lock") === "pending" && !!localStorage.getItem("nextext_app_lock_pass"));
            const privateNotif = !!chatData.lockedBy?.[uid] || appLockEnabled;
            const chatName = isGroup ? chatData.groupName : senderName;
            const body = m.type === "text" ? (m.text || "") : m.type === "image" ? "📷 Photo" : m.type === "video" ? "🎥 Video" : m.type === "voice" ? "🎤 Voice note" : m.type === "file" ? "📎 File" : m.type === "location" ? "📍 Location" : "New message";
            // Native notifications use senderName/groupName/messageText to
            // build a proper title (sender for DMs, group name for groups with
            // the sender as sub-text) and a chatId so tapping the notification
            // opens the conversation.
            if (privateNotif) {
              showLocalNotification("New message", "You have a new message", chatId, {
                chatId,
                senderName: "",
                groupName: "",
                messageText: "",
                private: true,
              });
            } else {
              showLocalNotification(chatName, body.length > 60 ? body.slice(0, 60) + "…" : body, chatId, {
                chatId,
                senderName,
                groupName: isGroup ? chatName : "",
                messageText: body,
                private: false,
              });
            }
          });
        });
        unsubs.push({ chatId, unsub: unsubMsg });
      });
    });
    unsubs.push({ chatId: "__chats__", unsub: unsubChats });
    return () => { unsubs.forEach((u) => { try { u.unsub(); } catch {} }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, userRestrictions]);


  useEffect(() => {
    if (!showSplash) {
      setSplashVisible(false);
      return;
    }
    if (splashHold) return;
    const fadeTimer = setTimeout(() => setSplashFading(true), 300);
    const dismissTimer = setTimeout(() => { setSplashVisible(false); }, 1000);
    return () => { clearTimeout(fadeTimer); clearTimeout(dismissTimer); };
  }, [showSplash, splashHold]);

  // Auto-check for app updates once after login (delayed 5s to not block load).
  // Only runs when the "Notify me about app updates" setting is on, and skips
  // versions the user has already seen/dismissed. On transient failure (network
  // blip, GitHub rate limit on a shared mobile IP) retry a few times instead of
  // silently treating it as "no update".
  useEffect(() => {
    if (!myUid) return;
    if (localStorage.getItem("nextext_auto_update_check") === "off") return;
    let cancelled = false;
    let attempt = 0;
    const run = async () => {
      if (cancelled) return;
      try {
        const update = await checkForUpdate();
        if (cancelled) return;
        if (update && getLastSeenRelease() !== update.version) {
          setPendingUpdate(update);
          setShowUpdatePrompt(true);
        }
      } catch {
        if (cancelled || attempt >= 3) return;
        attempt++;
        setTimeout(run, 15000);
      }
    };
    const timer = setTimeout(run, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [myUid]);

  const handleManualUpdateCheck = async () => {
    setCheckingUpdate(true);
    setUpdateStatus("");
    try {
      const update = await checkForUpdate();
      if (update) {
        setPendingUpdate(update);
        setShowUpdatePrompt(true);
        setUpdateStatus("");
      } else {
        setUpdateStatus("Your app is up to date!");
        setTimeout(() => setUpdateStatus(""), 3000);
      }
    } catch (err) {
      setUpdateStatus(err?.code === "RATE_LIMITED" ? err.message : "Could not check for updates.");
      setTimeout(() => setUpdateStatus(""), 3000);
    }
    setCheckingUpdate(false);
  };

  const handleDownloadUpdate = async () => {
    setDownloadingUpdate(true);
    setUpdateStatus("");
    try {
      const url = pendingUpdate?.downloadUrl;
      if (url) {
        await downloadUpdate(url);
      } else if (pendingUpdate?.releaseUrl) {
        openDownloadUrl(pendingUpdate.releaseUrl);
      }
      if (pendingUpdate?.version) setLastSeenRelease(pendingUpdate.version);
    } catch (err) {
      // e.g. install-unknown-apps permission not yet granted — keep the prompt
      // open and explain what to do instead of silently closing it.
      setUpdateStatus(err?.message || "Download failed.");
      return;
    } finally {
      setDownloadingUpdate(false);
    }
    setUpdateStatus("");
    setShowUpdatePrompt(false);
  };

  const handleDismissUpdate = () => {
    if (pendingUpdate?.version) setLastSeenRelease(pendingUpdate.version);
    setShowUpdatePrompt(false);
  };

  const handleSaveApkToDevice = async () => {
    const url = pendingUpdate?.downloadUrl;
    if (!url) return;
    setSavingUpdate(true);
    try {
      await saveApkToDevice(url);
      if (pendingUpdate?.version) setLastSeenRelease(pendingUpdate.version);
    } catch (err) {
      setUpdateStatus("Couldn't save the APK: " + (err?.message || "unknown error"));
      setTimeout(() => setUpdateStatus(""), 4000);
    } finally {
      setShowUpdatePrompt(false);
      setSavingUpdate(false);
    }
  };

  useEffect(() => { localStorage.setItem(UI_SCALE_KEY, String(uiScale)); }, [uiScale]);
  useEffect(() => { localStorage.setItem("nextext_recording_bar_scale", String(recordingBarScale)); }, [recordingBarScale]);
  useEffect(() => { localStorage.setItem(SCROLL_DOWN_KEY, String(showScrollDown)); }, [showScrollDown]);
  useEffect(() => { localStorage.setItem("nextext_animate_on_tap", String(animateOnTap)); }, [animateOnTap]);
  useEffect(() => { localStorage.setItem("nextext_swipe_animation", swipeAnimationOn ? "on" : "off"); }, [swipeAnimationOn]);
  useEffect(() => { localStorage.setItem("nextext_swipe_speed", swipeSpeed); }, [swipeSpeed]);
  useEffect(() => { localStorage.setItem("nextext_search_bar_scale", String(searchBarScale)); }, [searchBarScale]);

  // Re-lock app whenever the user returns to it from the background.
  // Uses Capacitor's appStateChange (fires reliably on Android WebView when the
  // app is backgrounded) plus visibilitychange as a fallback for browsers.
  // Also persists app state (last screen/tab/chat/bottom-nav) when leaving so
  // the next launch restores it.
  useEffect(() => {
    const relock = () => {
      if (document.visibilityState === "visible") {
        onForeground();
        return;
      }
      if (document.visibilityState !== "hidden") return;
      saveAppStateRef.current();
      const enabled = localStorage.getItem("nextext_app_lock") === "true";
      const pass = localStorage.getItem("nextext_app_lock_pass");
      const shouldLock = enabled && !!pass;
      if (shouldLock) setAppLocked(true);
    };
    const relockNative = ({ isActive }) => {
      if (isActive) { onForeground(); return; }
      saveAppStateRef.current();
      const enabled = localStorage.getItem("nextext_app_lock") === "true";
      const pass = localStorage.getItem("nextext_app_lock_pass");
      const shouldLock = enabled && !!pass;
      if (shouldLock) setAppLocked(true);
    };
    // On resume, self-heal a story viewer left open on a non-status screen so
    // the bottom nav is never hidden when the app comes back to the front.
    const onForeground = () => {
      if (storyViewerOpenRef.current && screenRef.current !== "status") {
        setStoryViewerOpen(false);
      }
    };
    document.addEventListener("visibilitychange", relock);
    let capListener = null;
    if (window.Capacitor?.isNativePlatform?.()) {
      CapApp.getState().then(({ isActive }) => { if (!isActive) relockNative({ isActive: false }); }).catch(() => {});
      CapApp.addListener("appStateChange", relockNative).then((l) => { capListener = l; }).catch(() => {});
    }
    return () => {
      document.removeEventListener("visibilitychange", relock);
      capListener?.remove();
    };
  }, []);

  const [initialViewStatuses, setInitialViewStatuses] = useState(null);
  const [statusOrigin, setStatusOrigin] = useState("status");

  // Locked-chat gate: opening a chat that is locked by me requires the locked
  // chats password, verified once per session. `lockPromptChat` holds the
  // pending open request while the code prompt is on screen.
  const [lockPromptChat, setLockPromptChat] = useState(null);
  const [lockPromptError, setLockPromptError] = useState("");
  const lockPromptInputRef = useRef(null);
  const verifiedLockedChatsRef = useRef(new Set());

  const confirmLockPrompt = () => {
    const pass = localStorage.getItem("nextext_locked_chats_password") || "";
    const entered = lockPromptInputRef.current?.value || "";
    if (entered !== pass) {
      setLockPromptError("Incorrect lock code.");
      return;
    }
    const pending = lockPromptChat;
    setLockPromptChat(null);
    setLockPromptError("");
    if (pending?.chatDoc?.id) verifiedLockedChatsRef.current.add(pending.chatDoc.id);
    openChat(pending.chatDoc, pending.otherUid, pending.contact, { ...(pending.options || {}), lockVerified: true });
  };

  const openChat = (chatDoc, otherUid, contact, options) => {
    if (options?.isAI) {
      setScreen("aiChat");
      return;
    }
    if (options?.openProfile) {
      setActiveChat({ chatId: chatDoc?.id || null, otherUid, contact, origin: "list" });
      setScreen("contactProfile");
      return;
    }
    if (options?.openStatus) {
      setStatusOrigin("chat");
      setInitialViewStatuses({ statuses: options.openStatus, ownerUid: otherUid });
      setScreen("status");
      return;
    }
    // When opening from the contacts list (chatDoc=null), look up the
    // existing chat doc from myChats so the lock check works. Without this,
    // a locked direct chat was bypassable by tapping the chat icon next to
    // the contact name (chatDoc was null → lockedBy check was skipped).
    let resolvedChatDoc = chatDoc;
    if (!resolvedChatDoc && otherUid && myUid) {
      const directChatId = [myUid, otherUid].sort().join("_");
      resolvedChatDoc = (myChats || []).find((c) => c.id === directChatId) || null;
    }
    const chatId = resolvedChatDoc?.id;
    const isLockedForMe = !!resolvedChatDoc?.lockedBy?.[myUid];
    const hasLockPass = !!localStorage.getItem("nextext_locked_chats_password");
    if (isLockedForMe && hasLockPass && !options?.lockVerified && !verifiedLockedChatsRef.current.has(chatId)) {
      setLockPromptChat({ chatDoc: resolvedChatDoc, otherUid, contact, options });
      return;
    }
    if (chatId) verifiedLockedChatsRef.current.add(chatId);
    setActiveChat({ chatId, otherUid, contact, origin: "chat", openSettings: options?.openSettings || false });
    setScreen("chat");
  };

  // Route into a chat when the user taps a notification (or a background
  // payload arrived while the app was closed). Waits for the chat list to load
  // on cold start, then drops the request if the chat can't be found.
  // On cold start, we don't auto-open the chat until the bootKick has run
  // (so the bottom nav is guaranteed visible). After cold start, open immediately.
  useEffect(() => {
    if (!pendingNotifChatId) return;
    const chat = (myChats || []).find((c) => c.id === pendingNotifChatId);
    if (chat) {
      if (!coldStartComplete) {
        // Cold start not complete — wait and retry
        const t = setTimeout(() => {}, 200);
        return () => clearTimeout(t);
      }
      setPendingNotifChatId(null);
      const otherUid = (chat.participants || []).find((p) => p !== myUid);
      openChat(chat, otherUid, (contacts || []).find((c) => c.uid === otherUid));
    } else if ((myChats || []).length > 0) {
      const t = setTimeout(() => setPendingNotifChatId((cur) => (cur === pendingNotifChatId ? null : cur)), 8000);
      return () => clearTimeout(t);
    }
  }, [pendingNotifChatId, myChats, myUid, contacts, coldStartComplete]);

  const openGroupInfo = (chat) => {
    setActiveGroup({ chatId: chat?.id, groupName: chat?.groupName });
    setScreen("groupInfo");
  };

  const openContactProfile = (uid, contact) => {
    setActiveChat({ chatId: null, otherUid: uid, contact, origin: "list" });
    setScreen("contactProfile");
  };

  // ── Swipeable tab pager (WhatsApp-style drag + snap) ──────────────
  const orderedTabs = navConfig
    .filter(({ key }) => {
      if (key === "status" && userRestrictions?.blockStatus === true) return false;
      if (key === "groups" && userRestrictions?.blockGroups === true) return false;
      return TAB_KEYS.includes(key);
    })
    .map(({ key }) => key);
  if (!topBarVisible && !orderedTabs.includes("settings")) orderedTabs.push("settings");
  if (!orderedTabs.includes("chats")) orderedTabs.unshift("chats");

  const currentTabKey = screen === "status" ? "status"
    : screen === "settings" ? "settings"
    : screen === "list" ? activeNavTab
    : null;
  const currentTabIndex = currentTabKey ? Math.max(0, orderedTabs.indexOf(currentTabKey)) : -1;

  // Sync the pager position whenever the active tab changes via bottom bar,
  // top-bar buttons, or programmatic navigation (e.g. opening a status).
  // All tabs stay mounted as direct shell children (positioned via `transform`),
  // so a failed mount can never silently blank the pages.
  useEffect(() => {
    if (currentTabIndex === -1) return;
    if (!pagerDragRef.current?.active) setPageIndex(currentTabIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTabKey, screen, orderedTabs.join(",")]);

  // Cold-start pager resync. The user reported the chat list + bottom bar are
  // missing/dead until they manually tap the Settings gear (a re-render). The
  // reliable trigger is a fresh re-render that re-applies each page's
  // transform; this layout effect replicates that automatically by snapping
  // any stale inline transform (left by a swipe) back to the derived active
  // index before paint. Driven by bootKick (bumped by the safety net shortly
  // after sign-in) so it runs once on real cold starts.
  useLayoutEffect(() => {
    if (bootKick === 0) return;
    if (bootLockedRef.current) return;
    bootLockedRef.current = true;
    setActiveNavTab("chats");
    const target = currentTabIndex >= 0 ? currentTabIndex : 0;
    orderedTabs.forEach((key, i) => {
      const el = pageRefs.current[key];
      if (el) {
        el.style.transition = "none";
        el.style.left = `${(i - target) * 100}%`;
      }
    });
    setPageIndex(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootKick]);

  // Cold-start pager lock: runs inside the pager sync effect when orderedTabs
  // is first populated (after navConfig restore). Forces activeNavTab="chats"
  // and snaps the Chats page to origin. Uses a ref to run only once.
  // This is the primary cold-start fix; bootKick layoutEffect is the fallback.
  useEffect(() => {
    if (!myUid || bootLockedRef.current) return;
    if (orderedTabs.length === 0) return;
    const target = orderedTabs.indexOf("chats");
    if (target === -1) return;
    bootLockedRef.current = true;
    setActiveNavTab("chats");
    setPageIndex(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedTabs.join(","), myUid]);

  const navigateToTab = (key) => {
    const idx = orderedTabs.indexOf(key);
    if (idx === -1) return;
    setPageIndex(idx);
    if (key === "status") { setStatusOrigin("status"); setScreen("status"); }
    else if (key === "settings") setScreen("settings");
    else { setActiveNavTab(key); setScreen("list"); }
  };

  const pagerTouchStart = (e) => {
    if (screen !== "list" && screen !== "status" && screen !== "settings") return;
    if (storyViewerOpen) return;
    // A new drag interrupts any in-flight snap animation — snap back to the
    // tap transition immediately.
    if (snapTimerRef.current) { clearTimeout(snapTimerRef.current); snapTimerRef.current = null; }
    setSnapAnimating(false);
    const shell = shellRef.current;
    if (!shell) return;
    const width = shell.clientWidth || 1;
    pagerDragRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startIndex: Math.max(0, currentTabIndex),
      offset: 0,
      width,
      active: false,
      lastX: e.touches[0].clientX,
      lastT: performance.now(),
      velocity: 0,
    };
  };

  const pagerTouchMove = (e) => {
    const drag = pagerDragRef.current;
    if (!drag) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return; // too early to tell
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 12) {
        // Vertical scroll — hand it back to the scroller.
        pagerDragRef.current = null;
        return;
      }
      drag.active = true;
      setPagerDragging(true);
    }
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.velocity = (e.touches[0].clientX - drag.lastX) / dt;
    drag.lastX = e.touches[0].clientX;
    drag.lastT = now;
    let offset = dx;
    const len = orderedTabs.length;
    if (drag.startIndex === 0 && offset > 0) offset *= 0.35; // edge resistance
    if (drag.startIndex === len - 1 && offset < 0) offset *= 0.35;
    drag.offset = offset;
    orderedTabs.forEach((key, i) => {
      const el = pageRefs.current[key];
      if (el) {
        el.style.transition = "none";
        el.style.left = `${(i - drag.startIndex) * drag.width + offset}px`;
      }
    });
    if (e.cancelable) e.preventDefault();
  };

  const pagerTouchEnd = () => {
    const drag = pagerDragRef.current;
    if (!drag || !drag.active) { pagerDragRef.current = null; return; }
    pagerDragRef.current = null;
    const len = orderedTabs.length;
    const threshold = drag.width * 0.2;
    let target = drag.startIndex;
    if (drag.offset < -threshold || drag.velocity < -0.4) target = Math.min(drag.startIndex + 1, len - 1);
    else if (drag.offset > threshold || drag.velocity > 0.4) target = Math.max(drag.startIndex - 1, 0);
    if (target !== drag.startIndex) {
      const key = orderedTabs[target];
      // snapAnimating makes React apply the animated transition to the index
      // jump, so CSS animates from the last drag offset to the snapped page.
      // There is NO deferred setTimeout nav commit here — the tab state lands
      // immediately, so a backgrounded app or unmounted component can never
      // strand the pager on a stale page (the old cold-start bug).
      const dur = swipeAnimationEnabled() ? swipeDuration() * 1000 : 0;
      const trans = swipeAnimationEnabled() ? `left ${swipeDuration()}s ${swipeBezier()}` : "none";
      // Snap every page to its target `left` explicitly so the DOM always
      // matches the committed tab (React's reconciliation won't touch a page
      // whose rendered `left` is unchanged, which could otherwise leave a
      // mid-drag inline offset stuck on the page).
      orderedTabs.forEach((k, i) => {
        const el = pageRefs.current[k];
        if (el) {
          el.style.transition = trans;
          el.style.left = `${(i - target) * 100}%`;
        }
      });
      setSnapAnimating(true);
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(() => setSnapAnimating(false), dur || 1);
      setPageIndex(target);
      if (key === "status") { setStatusOrigin("status"); setScreen("status"); }
      else if (key === "settings") setScreen("settings");
      else { setActiveNavTab(key); setScreen("list"); }
    }
    setPagerDragging(false);
  };

  const pagerTouchCancel = () => {
    const drag = pagerDragRef.current;
    pagerDragRef.current = null;
    if (drag?.active) {
      // Cancel: restore every page to its React-owned position (no nav change).
      orderedTabs.forEach((key, i) => {
        const el = pageRefs.current[key];
        if (el) {
          el.style.transition = "";
          el.style.left = `${(i - pageIndex) * 100}%`;
        }
      });
      setPagerDragging(false);
    }
  };

  // UI-scale scaling. The shell is scaled from the top-left corner; to keep the
  // scaled output EXACTLY filling the viewport we pre-shrink the box to
  // 100/uiScale% (both axes) so scale(uiScale) expands it right back to 100%.
  // Without this, uiScale > 1 pushed the whole shell below the visible bottom
  // edge — the bottom nav (positioned at bottom:0 inside the shell) ended up
  // off-screen, which read as "bottom bar missing on every app reopen" because
  // the setting persists across restarts.
  const containerStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
    fontFamily: appFont,
    width: uiScale === 1 ? "100%" : `${(100 / uiScale).toFixed(4)}%`,
    height: uiScale === 1 ? "100%" : `${(100 / uiScale).toFixed(4)}%`,
    paddingTop: "var(--safe-top)",
    paddingBottom: "var(--safe-bottom)",
    ...(uiScale !== 1 ? { transform: `scale(${uiScale})`, transformOrigin: "top left" } : {}),
  };

  if (auth.loading) {
    return <div style={{ ...containerStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0B141A" }}>
      <img src="./icon.png" alt="" style={{ width: 100, height: 100, objectFit: "contain", marginBottom: 20 }} onError={(e) => { e.target.style.display = "none"; }} />
      <div style={{ width: 40, height: 40, border: "4px solid rgba(16, 185, 129, 0.25)", borderTopColor: "#10B981", borderRadius: "50%", animation: "nextext-spin 0.9s linear infinite", marginBottom: 16 }} />
      <span style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>Loading…</span>
      <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 14, marginTop: 8 }}>Connecting to server</span>
      <style>{`@keyframes nextext-spin { to { transform: rotate(360deg); } }`}</style>
    </div>;
  }
  if (!auth.user) {
    return <div style={containerStyle}><AuthScreen auth={auth} /></div>;
  }
  if (auth.userDoc?.profileComplete === false) {
    return <div style={containerStyle}><CompleteProfileScreen auth={auth} /></div>;
  }
  const isAdmin = auth.userDoc?.role === "admin" || auth.userDoc?.isAdmin === true;

  return (
    <>
    <div
      ref={shellRef}
      id="nextext-app-shell"
      style={{ ...containerStyle }}
      onTouchStart={pagerTouchStart}
      onTouchMove={pagerTouchMove}
      onTouchEnd={pagerTouchEnd}
      onTouchCancel={pagerTouchCancel}
    >
        {orderedTabs.map((key, idx) => {
          // Placement is ALWAYS derived from the live active tab (except while
          // a swipe drag is in flight, where inline transforms drive it). This
          // guarantees the first paint, every navigation, and every re-render
          // land on the correct page — no first-render flag, no effect-ordering
          // dependency, no stale pageIndex to strand the pager on cold start.
          const activeIdx = currentTabIndex >= 0 ? currentTabIndex : pageIndex;
          const effectiveIndex = pagerDragRef.current?.active ? pageIndex : activeIdx;
          const pageStyle = {
            position: "absolute", top: 0, bottom: 0, width: "100%",
            overflow: "hidden",
            // Pages are positioned with plain `left` offsets (no transforms,
            // no willChange, no GPU compositor layers at rest). Promoting every
            // page to its own compositor layer via translate3d re-triggered the
            // WebView paint bug that left the app blank/dead on cold start
            // until a forced re-render (v1.1.18 regression of the v1.1.12 fix).
            // `left` is layout-only and paints reliably on every WebView load.
            // Swipe drags still position pages directly (see pagerTouchMove).
            left: `${(idx - effectiveIndex) * 100}%`,
            // During a swipe drag: no CSS transition (we drive `left` directly).
            // Right after a swipe ends (snapAnimating): the animated slide from
            // the last drag offset to the snapped page.
            // Tap jumps: animated only when animateOnTap is enabled.
            transition: pagerDragging
              ? "none"
              : snapAnimating
                ? (swipeAnimationEnabled() ? `left ${swipeDuration()}s ${swipeBezier()}` : "none")
                : tapTransition(),
          };
          const pageRef = (el) => { pageRefs.current[key] = el; };
          if (key === "chats") return (
            <div key="chats" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Chats">
                <ChatListScreen myUid={myUid} userDoc={liveUserDoc || auth.userDoc} onOpenChat={openChat} onOpenGroupInfo={openGroupInfo} onOpenSettings={() => setScreen("settings")} hideNav={hideNav} navTab="chats" compactList={compactList} searchMode={searchMode} topBarVisible={topBarVisible} searchBarScale={searchBarScale} />
              </PageErrorBoundary>
            </div>
          );
          if (key === "groups") return (
            <div key="groups" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Groups">
                <ChatListScreen myUid={myUid} userDoc={liveUserDoc || auth.userDoc} onOpenChat={openChat} onOpenGroupInfo={openGroupInfo} onOpenSettings={() => setScreen("settings")} hideNav={hideNav} navTab="groups" compactList={compactList} searchMode={searchMode} topBarVisible={topBarVisible} searchBarScale={searchBarScale} />
              </PageErrorBoundary>
            </div>
          );
          if (key === "status") return (
            <div key="status" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Status">
                <StatusScreen myUid={myUid} myName={auth.userDoc?.displayName || auth.userDoc?.username} onBack={() => { setScreen("list"); setActiveNavTab("chats"); setStoryViewerOpen(false); }} onStoryViewerChange={setStoryViewerOpen} initialViewStatuses={initialViewStatuses} statusOrigin={statusOrigin} onConsumeInitialView={() => setInitialViewStatuses(null)} />
              </PageErrorBoundary>
            </div>
          );
          if (key === "settings") return (
            <div key="settings" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Settings">
                <SettingsScreen
                myUid={myUid}
                isAdmin={isAdmin}
                themeKey={themeKey}
                onOpenTheme={() => setShowThemeSheet(true)}
                uiScale={uiScale}
                setUiScale={setUiScale}
                recordingBarScale={recordingBarScale}
                setRecordingBarScale={setRecordingBarScale}
                showScrollDown={showScrollDown}
                setShowScrollDown={setShowScrollDown}
                animatedScrollEntry={animatedScrollEntry}
                setAnimatedScrollEntry={setAnimatedScrollEntry}
                compactList={compactList}
                setCompactList={setCompactList}
                onBack={() => setScreen("list")}
                onNavigate={setScreen}
                onLogout={() => auth.logOut()}
                userDoc={liveUserDoc || auth.userDoc}
                navConfig={navConfig}
                setNavConfig={setNavConfig}
                aiSidebarOn={aiSidebarOn}
                setAiSidebarOn={setAiSidebarOn}
                showSplash={showSplash}
                setShowSplash={setShowSplash}
                searchMode={searchMode}
                setSearchMode={setSearchMode}
                topBarVisible={topBarVisible}
                setTopBarVisible={setTopBarVisible}
                onCheckUpdate={handleManualUpdateCheck}
                checkingUpdate={checkingUpdate}
                updateStatus={updateStatus}
                animateOnTap={animateOnTap}
                setAnimateOnTap={setAnimateOnTap}
                swipeAnimationOn={swipeAnimationOn}
                setSwipeAnimationOn={setSwipeAnimationOn}
                swipeSpeed={swipeSpeed}
                setSwipeSpeed={setSwipeSpeed}
                onShowTour={startTour}
                searchBarScale={searchBarScale}
                setSearchBarScale={setSearchBarScale}
                setLiveUserDoc={setLiveUserDoc}
                micMode={micMode}
                setMicMode={setMicMode}
                changeMicMode={changeMicMode}
                pinchZoomOn={pinchZoomOn}
                setPinchZoomOn={setPinchZoomOn}
                voiceEndChimeOn={voiceEndChimeOn}
                setVoiceEndChimeOn={setVoiceEndChimeOn}
                pingSoundId={pingSoundId}
                setPingSoundId={setPingSoundId}
                voicePlayerStyle={voicePlayerStyle}
                setVoicePlayerStyle={setVoicePlayerStyle}
                autoUpdateCheckOn={autoUpdateCheckOn}
                setAutoUpdateCheckOn={setAutoUpdateCheckOn}
                linkPreviewsOn={linkPreviewsOn}
                setLinkPreviewsOn={setLinkPreviewsOn}
              />
              </PageErrorBoundary>
            </div>
          );
          return null;
        })}

      {screen === "chat" && activeChat && (
        <ConversationScreen
          myUid={myUid}
          chatId={activeChat.chatId}
          otherUid={activeChat.otherUid}
          contact={activeChat.contact}
          openSettings={activeChat.openSettings}
          userDoc={liveUserDoc || auth.userDoc}
          onBack={() => setScreen("list")}
          onOpenProfile={() => setScreen("contactProfile")}
          onOpenGroupInfo={openGroupInfo}
          onOpenChat={openChat}
          showScrollDownSetting={showScrollDown}
          animatedScrollEntry={animatedScrollEntry}
          micMode={micMode}
          recordingBarScale={recordingBarScale}
        />
      )}
      {screen === "contactProfile" && activeChat && (
         <ContactProfileScreen
          myUid={myUid}
          otherUid={activeChat.otherUid}
          contact={activeChat.contact}
          isAdmin={isAdmin}
          onBack={() => {
            if (activeChat.origin === "list") setScreen("list");
            else setScreen("chat");
          }}
          onOpenStatus={() => setScreen("status")}
        />
      )}
      {screen === "groupInfo" && activeGroup && (
        <GroupInfoScreen
          myUid={myUid}
          chatId={activeGroup.chatId}
          onBack={() => setScreen("list")}
          onOpenChat={openChat}
          onOpenContactProfile={openContactProfile}
        />
      )}
      {screen === "privacy" && <PrivacyScreen myUid={myUid} onBack={() => setScreen("settings")} />}
      {screen === "permissions" && <PermissionsScreen myUid={myUid} onBack={() => setScreen("settings")} />}
      {screen === "parental" && <ParentalControlsScreen myUid={myUid} onBack={() => setScreen("settings")} />}
      {screen === "feedback" && <FeedbackScreen myUid={myUid} myUsername={auth.userDoc?.username} onBack={() => setScreen("settings")} />}
      {screen === "admin" && isAdmin && <AdminDashboard myUid={myUid} onBack={() => setScreen("settings")} />}
      {screen === "aiChat" && (
        <AIChatScreen myUid={myUid} onBack={() => setScreen("list")} />
      )}

      {aiSidebarOn && !storyViewerOpen && screen === "list" && (
        <AISidebarWidget myUid={myUid} userDoc={liveUserDoc || auth.userDoc} onOpenAI={() => setScreen("aiChat")} />
      )}

      {showThemeSheet && (
        <ThemeSheet current={themeKey} onSelect={(k) => { setThemeKey(k); setShowThemeSheet(false); }} onClose={() => setShowThemeSheet(false)} />
      )}



      {!hideNav && !storyViewerOpen && (screen === "list" || screen === "status" || screen === "settings") && (() => {
        const ALL_TABS = {
          chats: { icon: MessageSquare, label: "Chats" },
          status: { icon: CircleDot, label: "Status" },
          groups: { icon: Users, label: "Groups" },
          settings: { icon: SettingsIcon, label: "Settings" },
        };
        const navTabs = navConfig
          .filter(({ key }) => {
            if (key === "status" && userRestrictions?.blockStatus === true) return false;
            if (key === "groups" && userRestrictions?.blockGroups === true) return false;
            return ALL_TABS[key];
          })
          .map(({ key }) => ({ key, ...ALL_TABS[key] }));
        // Force settings onto bottom bar when top bar is hidden
        if (!topBarVisible && !navTabs.some((t) => t.key === "settings")) {
          navTabs.push({ key: "settings", ...ALL_TABS.settings });
        }
        // Chats is always on: without this a malformed/legacy stored config
        // could leave the whole bottom bar blank.
        if (!navTabs.some((t) => t.key === "chats")) {
          navTabs.unshift({ key: "chats", ...ALL_TABS.chats });
        }
        if (!navTabs.length) return null;
        return (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", background: t.surface, borderTop: `1px solid ${t.border}`, zIndex: 1000, transform: "translateZ(0)", paddingBottom: "max(0px, calc(var(--safe-bottom)))" }}>
            {navTabs.map(({ key, icon: Icon, label }) => {
              const isActive = key === "settings" ? screen === "settings" : key === "status" ? screen === "status" : (screen === "list" && activeNavTab === key);
              return (
              <div key={key} data-tour-nav={key} onClick={() => navigateToTab(key)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 0 12px", cursor: "pointer", color: isActive ? t.primary : t.textMuted, position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <Icon size={20} />
                  {key === "chats" && totalUnreadChats > 0 && (
                    <div style={{ position: "absolute", top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 8, background: "#FF3B30", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", border: `2px solid ${t.surface}` }}>{totalUnreadChats > 99 ? "99+" : totalUnreadChats}</div>
                  )}
                  {key === "status" && unreadStatusCount > 0 && (
                    <div style={{ position: "absolute", top: -2, right: -4, width: 8, height: 8, borderRadius: "50%", background: t.accent, border: `2px solid ${t.surface}` }} />
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500 }}>{label}</span>
              </div>
              );
            })}
          </div>
        );
      })()}

      {createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 2147483400, background: "#121B22",
            // Always mounted (not conditionally) so the opaque layer is part of
            // the WebView's initial composite. Toggling opacity 0↔1 on an
            // existing layer forces a fresh re-composite of the whole frame
            // (which is what re-includes the bottom bar) without ever creating
            // a new compositor layer mid-recovery.
            opacity: repairCoverOn ? 1 : 0,
            pointerEvents: repairCoverOn ? "auto" : "none",
          }}
        />,
        document.body
      )}

      {createPortal(splashVisible && (
        <div
          onTransitionEnd={() => { if (splashFading) setSplashVisible(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 999999, background: "#121B22",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28,
            opacity: splashFading ? 0 : 1, transition: "opacity 0.6s ease-out",
            pointerEvents: splashFading ? "none" : "auto",
          }}
        >
          <img src="./icon.png" alt="" style={{ width: 180, height: 180, objectFit: "contain" }} />
          <div
            style={{
              width: 34, height: 34,
              border: "3px solid rgba(16, 185, 129, 0.25)",
              borderTopColor: "#10B981",
              borderRadius: "50%",
            }}
          />
        </div>
      ), document.body)}

      {createPortal(showTour ? (
        <TourOverlay
          step={tourStep}
          total={TOUR_STEPS.length}
          onNext={() => { if (tourStep >= TOUR_STEPS.length - 1) finishTour(); else goTourStep(tourStep + 1); }}
          onPrev={() => { if (tourStep > 0) goTourStep(tourStep - 1); }}
          onSkip={finishTour}
        />
      ) : null, document.body)}

      {createPortal(lockPromptChat && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999998, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28 }}>
          <div style={{ width: "100%", maxWidth: 320, background: t.surface, borderRadius: 16, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: t.text, marginBottom: 4 }}>Locked chat</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 12 }}>Enter your locked-chats password to open this conversation.</div>
            <input ref={lockPromptInputRef} type="password" placeholder="Lock code…" onKeyDown={(e) => { if (e.key === "Enter") confirmLockPrompt(); }} autoFocus style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${lockPromptError ? "#FF3B30" : t.border}`, fontSize: 14, boxSizing: "border-box", marginBottom: lockPromptError ? 6 : 12, color: t.text, background: t.bg }} />
            {lockPromptError && <div style={{ color: "#FF3B30", fontSize: 12, marginBottom: 10 }}>{lockPromptError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setLockPromptChat(null); setLockPromptError(""); }} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Cancel</button>
              <button onClick={confirmLockPrompt} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Unlock</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {showUpdatePrompt && pendingUpdate && (
        <UpdatePrompt
          update={pendingUpdate}
          onDownload={handleDownloadUpdate}
          onDismiss={handleDismissUpdate}
          downloading={downloadingUpdate}
          saving={savingUpdate}
          onSaveToDevice={handleSaveApkToDevice}
          error={updateStatus || null}
        />
      )}
    </div>
    </>
  );
}

export default function App() {
  const [appLocked, setAppLocked] = useState(() => {
    const lockState = localStorage.getItem("nextext_app_lock");
    const pass = localStorage.getItem("nextext_app_lock_pass");
    const enabled = lockState === "true" || (lockState === "pending" && !!pass);
    return enabled && !!pass;
  });

  return (
    <ThemeProvider>
      <AppShell appLocked={appLocked} setAppLocked={setAppLocked} />
      {appLocked && <AppLockScreen onUnlock={() => setAppLocked(false)} />}
    </ThemeProvider>
  );
}

