import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ThemeProvider, useTheme, themes, ROTATE_INTERVALS, isThemeDark } from "./theme/ThemeContext";

// Resolves the notification dark-mode flag. An explicit user choice in the
// notification settings ("actual"/"lettering") wins; otherwise the card
// follows the app's current theme so a dark theme yields a dark notification.
function getNotifDark() {
  const explicit = localStorage.getItem("nextext_notif_dark");
  if (explicit === "actual" || explicit === "lettering") return explicit;
  try {
    const key = localStorage.getItem("nextext_theme_key") || "emeraldNight";
    const theme = key === "custom"
      ? JSON.parse(localStorage.getItem("nextext_custom_theme") || "null")
      : (themes[key] || themes.emeraldNight);
    return isThemeDark(theme) ? "actual" : "off";
  } catch {
    return "off";
  }
}
import { useAuth } from "./firebase/useAuth";
import { usePresenceHeartbeat, useAppUsageTracker } from "./firebase/presence";
import { purgeExpiredStatuses, useStatuses } from "./firebase/status";
import { useContacts } from "./firebase/contacts";
import { useChats, purgeExpiredChatMedia, markChatRead } from "./firebase/chats";
import { setGlobalWallpaper, fileToWallpaperDataUrl } from "./theme/wallpaper";
import { ChevronLeft, ChevronRight, Palette, Shield, Lock, MessageSquare, X, ShieldCheck, Phone, Image as ImageIcon, Users, CircleDot, RotateCcw, Camera, Settings as SettingsIcon, Bot, Sparkles, RefreshCw, Search, User, Compass, Bell, BellOff, Smile, Megaphone } from "lucide-react";
import { FONTS } from "./theme/ThemeContext";
import Avatar from "./components/Avatar";
import AvatarColorPicker from "./components/AvatarColorPicker";
import { uploadChatFile } from "./supabase/media";
import { doc, getDoc, updateDoc, setDoc, onSnapshot, collection, query, where, orderBy } from "firebase/firestore";
import { db } from "./firebase/config";
import AuthScreen from "./screens/AuthScreen";
import CompleteProfileScreen from "./screens/CompleteProfileScreen";
import ChatListScreen from "./screens/ChatListScreen";
import ConversationScreen from "./screens/ConversationScreen";
import AskAIPanel from "./components/AskAIPanel";
import PrivacyScreen from "./screens/PrivacyScreen";
import ParentalControlsScreen from "./screens/ParentalControlsScreen";
import FeedbackScreen from "./screens/FeedbackScreen";
import ContactProfileScreen from "./screens/ContactProfileScreen";
import AdminDashboard from "./screens/AdminDashboard";
import AIChatScreen from "./screens/AIChatScreen";
import { useSystemConfigHook, requestAIAccess, setAIPersonality, setSystemConfig, PERSONALITIES, AI_CONTACT_UID } from "./firebase/ai";
import AppLockScreen from "./screens/AppLockScreen";
import StatusScreen from "./screens/StatusScreen";
import GroupInfoScreen from "./screens/GroupInfoScreen";
import CalculatorScreen from "./screens/CalculatorScreen";
import NotepadScreen from "./screens/NotepadScreen";
import AnnouncementsScreen from "./screens/AnnouncementsScreen";
import IconPickerScreen from "./screens/IconPickerScreen";
import { getActiveProfileId, syncNativeProfile, ICON_PROFILES, setNotepadKeyword, setActiveProfile } from "./services/iconManager";
import { initNotifications, setNotificationTapHandler, showLocalNotification, getNotificationsStatus, enableNotifications, pollPendingNotificationTap, setNotificationMarkReadHandler, pollPendingMarkRead, VIBRATION_PRESETS, previewNotificationFeedback } from "./firebase/notifications";
import { App as CapApp } from "@capacitor/app";
import PermissionsScreen from "./screens/PermissionsScreen";
import UpdatePrompt from "./components/UpdatePrompt";
import DownloadApkButton from "./components/DownloadApkButton";
import UserStatsCard from "./components/UserStatsCard";
import PageErrorBoundary from "./components/PageErrorBoundary";
import { checkForUpdate, downloadUpdate, getCurrentVersion, getLastSeenRelease, openDownloadUrl, saveApkToDevice, setLastSeenRelease } from "./updater/updateChecker";
import { PING_SOUNDS, playVoicePing } from "./utils/pingSounds";
import { updateGlobalSettings, useGlobalSettings, subscribe as subscribeGlobalSettings, getQuotaSnapshot } from "./firebase/config-settings";
import { BUBBLE_STYLE_ORDER, BUBBLE_STYLE_LABELS, getBubbleStyle, setBubbleStyle, resolveBubble } from "./theme/bubbleStyles";
import { setCloudinaryProxyEnabled } from "./media/mediaProxy";
import { runPreWarmPing } from "./firebase/prewarm";
import { useSystemInsets } from "./utils/useSystemInsets";
import { changeNames, isNameChangeBlocked, isUsernameAvailable } from "./firebase/names";

const UI_SCALE_KEY = "nextext_ui_scale";
const SCROLL_DOWN_KEY = "nextext_show_scrolldown";

function ThemeSheet({ current, onSelect, onClose }) {
  const { t, customTheme, setCustomThemeColors, rotateDays, setRotateDays } = useTheme();
  const [tab, setTab] = useState("presets");
  const [bubbleSel, setBubbleSel] = useState(getBubbleStyle());
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
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100000, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: t.surface, width: "100%", borderRadius: "20px 20px 0 0", padding: "20px 20px 30px", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box", WebkitOverflowScrolling: "touch" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: t.text, fontSize: 18 }}>Theme</h3>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[["presets", "Presets"], ["bubbles", "Bubble style"], ["custom", "Custom colors"], ["rotate", "Auto-switch"]].map(([key, label]) => (
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

        {tab === "bubbles" && (
          <div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
              Choose how your message bubbles look. Tap a style to preview it live — your choice applies across all chats.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {BUBBLE_STYLE_ORDER.map((key) => {
                const sel = bubbleSel === key;
                const mine = resolveBubble(key, true, t);
                const them = resolveBubble(key, false, t);
                return (
                  <div key={key} onClick={() => { setBubbleStyle(key); setBubbleSel(key); }} style={{ border: `2px solid ${sel ? t.primary : t.border}`, borderRadius: 14, padding: "10px 12px", cursor: "pointer", background: t.bg }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, marginBottom: 8 }}>{BUBBLE_STYLE_LABELS[key]}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ alignSelf: "flex-start", maxWidth: "72%", padding: "7px 11px", fontSize: 13, ...them }}>{BUBBLE_STYLE_LABELS[key]} preview</div>
                      <div style={{ alignSelf: "flex-end", maxWidth: "72%", padding: "7px 11px", fontSize: 13, ...mine }}>Hey there! 👋</div>
                    </div>
                  </div>
                );
              })}
            </div>
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

function SettingsRow({ icon, label, sub, onClick, t, dataTour }) {
  return (
    <div onClick={onClick} data-tour={dataTour} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", cursor: onClick ? "pointer" : "default", borderBottom: `1px solid ${t.border}` }}>
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

// Notification sound + vibration picker. Extracted into its own component so
// its useState hooks live at THIS component's top level (not inside the
// collapsed SectionCard IIFE in SettingsScreen) — calling hooks inside a nested
// function/IIFE violates the Rules of Hooks and threw React #310 ("rendered
// fewer hooks than expected") whenever the section expanded/collapsed.
function NotificationPrefsRow({ t, auth, myUid }) {
  const [vibKey, setVibKey] = useState(() => localStorage.getItem("nextext_notif_vibration") || "default");
  const [soundKey, setSoundKey] = useState(() => localStorage.getItem("nextext_notif_sound") || "default");
  const [vibOn, setVibOn] = useState(() => localStorage.getItem("nextext_notif_vibrate_on") !== "false");
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("nextext_notif_sound_on") !== "false");
  const [darkNotif, setDarkNotif] = useState(() => localStorage.getItem("nextext_notif_dark") || "off");
  const [hideSaveButton, setHideSaveButton] = useState(() => localStorage.getItem("nextext_hide_save_button") === "on");
  // Mirror notification prefs into the Firestore user doc so the FCM worker can
  // honour them for background (app-killed) notifications, not just foreground.
  const syncNotif = (patch) => {
    const uid = (auth && auth.user && auth.user.uid) || myUid;
    if (!uid) return;
    try { updateDoc(doc(db, "users", uid), patch).catch(() => {}); } catch {}
  };
  const vibOptions = [
    { key: "default", label: "Default (2 short)" },
    { key: "short", label: "Short (1 buzz)" },
    { key: "long", label: "Long (triple)" },
    { key: "heartbeat", label: "Heartbeat" },
    { key: "none", label: "No vibration" },
  ];
  // Native system tones — these are bundled raw assets (ping1/2/3) that play
  // identically whether the app is open or killed, unlike Web Audio chimes.
  const soundOptions = [
    { key: "default", label: "Default system sound" },
    { key: "none", label: "No sound" },
    { key: "ping1", label: "Ping 1 (low)" },
    { key: "ping2", label: "Ping 2 (mid)" },
    { key: "ping3", label: "Ping 3 (high)" },
  ];
  const Toggle = ({ label, value, onChange }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: `1px solid ${t.border}` }}>
      <span style={{ fontSize: 13.5, color: t.text, fontWeight: 600 }}>{label}</span>
      <div onClick={() => onChange(!value)} style={{ width: 46, height: 26, borderRadius: 13, background: value ? t.primary : t.border, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: value ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
      </div>
    </div>
  );
  const Picker = ({ label, value, options, onPick }) => (
    <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}` }}>
      <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => onPick(o.key)}
            style={{ padding: "7px 12px", borderRadius: 16, fontSize: 12.5, fontWeight: value === o.key ? 700 : 500, cursor: "pointer", background: value === o.key ? t.primary : t.surface, color: value === o.key ? t.bubbleMeText : t.text, border: `1px solid ${value === o.key ? t.primary : t.border}` }}
          >
            {o.label}
          </div>
        ))}
      </div>
    </div>
  );
  const preview = (vk, sk) => {
    const p = vibOn ? (VIBRATION_PRESETS[vk] || VIBRATION_PRESETS.default) : null;
    const s = soundOn ? sk : "none";
    previewNotificationFeedback(p, s);
  };
  return (
    <>
      <Toggle label="Vibrate on new message" value={vibOn} onChange={(v) => { setVibOn(v); try { localStorage.setItem("nextext_notif_vibrate_on", String(v)); } catch {} syncNotif({ notifVibrateOn: v }); if (v) preview(vibKey, soundKey); }} />
      <Toggle label="Play sound on new message" value={soundOn} onChange={(v) => { setSoundOn(v); try { localStorage.setItem("nextext_notif_sound_on", String(v)); } catch {} syncNotif({ notifSoundOn: v }); if (v) preview(soundKey, soundKey); }} />
      <Picker label="Vibration style" value={vibKey} options={vibOptions} onPick={(k) => { setVibKey(k); try { localStorage.setItem("nextext_notif_vibration", k); } catch {} syncNotif({ notifVibration: k }); preview(k, soundKey); }} />
      <Picker label="Ping sound" value={soundKey} options={soundOptions} onPick={(k) => { setSoundKey(k); try { localStorage.setItem("nextext_notif_sound", k); } catch {} syncNotif({ notifSound: k }); preview(vibKey, k); }} />
      <Picker
        label="Dark notification theme"
        value={darkNotif}
        options={[
          { key: "off", label: "Off (default)" },
          { key: "actual", label: "Actual dark" },
          { key: "lettering", label: "Dark lettering" },
        ]}
        onPick={(k) => { setDarkNotif(k); try { localStorage.setItem("nextext_notif_dark", k); } catch {} syncNotif({ notifDark: k }); }}
      />
      <Toggle label="Show 'Save to device' button" value={!hideSaveButton} onChange={(v) => { setHideSaveButton(!v); try { localStorage.setItem("nextext_hide_save_button", !v ? "on" : "off"); } catch {} }} />      <div style={{ padding: "12px 16px", borderTop: `1px solid ${t.border}` }}>
        <div onClick={async () => {
          const p = vibOn ? (VIBRATION_PRESETS[vibKey] || VIBRATION_PRESETS.default) : null;
          const s = soundOn ? soundKey : "none";
          await showLocalNotification("Test notification", "This is a test notification using your current settings.", "nextext-test", {
            chatId: "test",
            senderName: "NexText",
            groupName: "",
            messageText: "Test notification",
            private: false,
            vibrationPattern: p,
            sound: s,
            senderColor: t.primary,
            imageUrl: "",
            dark: darkNotif === "off" ? "off" : darkNotif,
          });
        }} style={{ padding: "12px 16px", borderRadius: 10, background: t.primaryLight, color: t.primary, fontSize: 13.5, fontWeight: 600, cursor: "pointer", textAlign: "center", border: `1px solid ${t.border}` }}>
          🔔 Send test notification
        </div>
      </div>
      <div style={{ padding: "4px 16px 12px", fontSize: 11.5, color: t.textMuted }}>
        Tip: open a chat, tap the contact's name → "Notifications for …" to give one person a different ping/vibration. Tap a style above to feel/hear it instantly.
        <br />
        Note: to hear the ping, make sure your device's notification sound is turned on (the app can't override a muted phone).
      </div>
    </>
  );
}

function SettingsScreen({ myUid, isAdmin, themeKey, onOpenTheme, uiScale, setUiScale, recordingBarScale, setRecordingBarScale,   showScrollDown, setShowScrollDown, scrollDownSize, setScrollDownSize, scrollDownPos, setScrollDownPos, animatedScrollEntry, setAnimatedScrollEntry, compactList, setCompactList, onBack, onNavigate, onLogout, userDoc, navConfig, setNavConfig, aiSidebarOn, setAiSidebarOn, showSplash, setShowSplash, searchMode, setSearchMode, topBarVisible, setTopBarVisible, onCheckUpdate, checkingUpdate, updateStatus, animateOnTap, setAnimateOnTap, swipeAnimationOn, setSwipeAnimationOn, swipeSpeed, setSwipeSpeed, swipeBounce, setSwipeBounce, onShowTour, searchBarScale, setSearchBarScale, setLiveUserDoc, pinchZoomOn, setPinchZoomOn, voiceEndChimeOn, setVoiceEndChimeOn, voiceStreakChimeOn, setVoiceStreakChimeOn, emojiBigOn, setEmojiBigOn, pingSoundId, setPingSoundId, voicePlayerStyle, setVoicePlayerStyle, autoUpdateCheckOn, setAutoUpdateCheckOn, linkPreviewsOn, setLinkPreviewsOn, contacts, navConfigLocked, setNavConfigLocked, composerButtonOrder, setComposerButtonOrder, launchPage, setLaunchPage, onLaunchPageSelect, auth, appGlobalSettings, darkLettering, setDarkLettering, actualDarkTheme, setActualDarkTheme, splashDuration, setSplashDuration, moreRounded, setMoreRounded,   voiceSpacing, setVoiceSpacing, setThemeKey, pendingSplashDuration, setPendingSplashDuration }) {
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

  // Keep the Cloudinary media-optimization proxy flag in sync with the DB so the
  // proxy utility (src/media/mediaProxy.js) rewrites media URLs app-wide.
  useEffect(() => {
    setCloudinaryProxyEnabled(globalSettings?.cloudinaryProxyEnabled === true);
  }, [globalSettings?.cloudinaryProxyEnabled]);

  // Cache the admin version override in localStorage so the updater can read it synchronously.
  useEffect(() => {
    const override = sysConfig?.appVersionOverride;
    if (override && typeof override === "string" && override.trim()) {
      localStorage.setItem("nextext_app_version_override", override.trim());
    } else {
      localStorage.removeItem("nextext_app_version_override");
    }
  }, [sysConfig?.appVersionOverride]);
  const [settingsRerenderTick, setSettingsRerenderTick] = useState(0);
  const forceSettingsRerender = () => setSettingsRerenderTick((x) => x + 1);

  // Login & security: change password / change email (email/password accounts only).
  const [credModal, setCredModal] = useState(null); // "password" | "email" | null
  const [credOldPass, setCredOldPass] = useState("");
  const [credNewPass, setCredNewPass] = useState("");
  const [credConfirmPass, setCredConfirmPass] = useState("");
  const [credNewEmail, setCredNewEmail] = useState("");
  const [credBusy, setCredBusy] = useState(false);
  const [credError, setCredError] = useState("");
  const [credSuccess, setCredSuccess] = useState("");
  const isEmailAccount = !!(auth && auth.isEmailPasswordAccount && auth.isEmailPasswordAccount());

  const submitCredChange = async (typeOverride) => {
    const mode = typeOverride || credModal;
    setCredError("");
    setCredSuccess("");
    setCredBusy(true);
    try {
      if (mode === "password") {
        if (!credOldPass || !credNewPass) throw new Error("Enter both your current and new password.");
        if (credNewPass.length < 6) throw new Error("New password must be at least 6 characters.");
        if (credNewPass !== credConfirmPass) throw new Error("New password and confirmation do not match.");
        await auth.changePassword(credOldPass, credNewPass);
        setCredSuccess("Password changed successfully.");
        setCredOldPass(""); setCredNewPass(""); setCredConfirmPass("");
      } else if (mode === "email") {
        if (!credOldPass || !credNewEmail) throw new Error("Enter your password and the new email.");
        await auth.changeEmail(credNewEmail, credOldPass);
        setCredSuccess("Email changed successfully.");
        setCredOldPass(""); setCredNewEmail("");
      }
    } catch (e) {
      setCredError(e?.message || "Something went wrong. Please try again.");
    } finally {
      setCredBusy(false);
    }
  };
  const readList = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback.slice();
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const toggleList = (key, value, fallback) => {
    const list = readList(key, fallback);
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    localStorage.setItem(key, next.join(","));
    forceSettingsRerender();
  };
  const ActionChips = ({ title, desc, storageKey, options, fallback, lockedKeys = [] }) => (
    <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
      <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>{title}</div>
      {desc && <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1, marginBottom: 8 }}>{desc}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: desc ? 0 : 8 }}>
        {options.map((opt) => {
          const active = readList(storageKey, fallback).includes(opt.key);
          const locked = lockedKeys.includes(opt.key);
          return (
            <div
              key={opt.key}
              onClick={() => { if (!locked) toggleList(storageKey, opt.key, fallback); }}
              style={{
                padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: locked ? "not-allowed" : "pointer",
                background: active ? t.primary : t.bg, color: active ? t.bubbleMeText : t.text,
                border: `1px solid ${active ? t.primary : t.border}`, opacity: locked ? 0.5 : 1,
              }}
            >{opt.label}{locked ? " (AI only)" : ""}</div>
          );
        })}
      </div>
    </div>
  );
  const [sttEnabled, setSttEnabled] = useState(() => localStorage.getItem("nextext_stt_enabled") !== "off");
  const [sttAutoSend, setSttAutoSend] = useState(() => localStorage.getItem("nextext_stt_autosend") !== "off");
  const [sttShowInterim, setSttShowInterim] = useState(() => localStorage.getItem("nextext_stt_show_interim") === "on");
  const [sttCancelButton, setSttCancelButton] = useState(() => localStorage.getItem("nextext_stt_cancel_button") !== "off");
  const [hideVersion, setHideVersion] = useState(() => localStorage.getItem("nextext_hide_version") !== "off");
  const [hideComposerCamera, setHideComposerCamera] = useState(() => localStorage.getItem("nextext_hide_composer_camera") === "on");
  const [useCustomPrompt, setUseCustomPrompt] = useState(() => localStorage.getItem("nextext_ai_custom_instructions_enabled") !== "off");
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
  const [appearanceSubs, setAppearanceSubs] = useState({});
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

  const Row = ({ icon, label, sub, onClick, right, dataTour }) => (
    <div onClick={onClick} data-tour={dataTour} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", cursor: onClick ? "pointer" : "default", borderBottom: `1px solid ${t.border}` }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>{label}</div>{sub && <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>{sub}</div>}</div>
      {right}
    </div>
  );

  // Memoized so its identity stays stable across App re-renders — defining it
  // inline would unmount/remount every card (losing input focus) on any state
  // change, e.g. the admin tech-stack editor's first keystroke.
  const renderSub = (title, children, defaultOpen = false) => {
    const open = (appearanceSubs && appearanceSubs[title]) ?? defaultOpen;
    return (
      <div style={{ borderTop: `1px solid ${t.border}` }}>
        <div
          onClick={() => setAppearanceSubs((p) => ({ ...(p || {}), [title]: !open }))}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", cursor: "pointer" }}
        >
          <span style={{ fontWeight: 700, color: t.text, fontSize: 14 }}>{title}</span>
          <span style={{ color: t.textMuted, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
        </div>
        {open && <div style={{ padding: "2px 0 10px" }}>{children}</div>}
      </div>
    );
  };
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
    if (navConfigLocked) return;
    const next = [...navConfig];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setNavConfig(next);
  };

  // Pointer-based drag-to-reorder for the bottom bar layout editor.
  const [dragIndex, setDragIndex] = useState(null);
  const rowRefs = useRef({});
  const onEditorPointerMove = (e) => {
    if (dragIndex == null || navConfigLocked) return;
    const y = e.clientY;
    const keys = navConfig.map((n) => n.key);
    let target = dragIndex;
    for (let i = 0; i < keys.length; i++) {
      const el = rowRefs.current[keys[i]];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) { target = i; break; }
      target = i;
    }
    if (target !== dragIndex) {
      const next = [...navConfig];
      const [m] = next.splice(dragIndex, 1);
      next.splice(target, 0, m);
      setNavConfig(next);
      setDragIndex(target);
    }
  };
  const onEditorPointerUp = () => setDragIndex(null);

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
          {!hideVersion && <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: t.primary }}>v{getCurrentVersion()}</span>}
        </div>
      <div className="nx-scroll" style={{ padding: "12px 16px", paddingBottom: 100 }}>

        {/* ═══ ACCOUNT & PROFILE ═══ */}
        <SectionCard title="Profile" emoji="👤" sectionKey="account">
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

        {isEmailAccount && !appGlobalSettings?.hideLoginSecurity && (
          <SectionCard title="Login & Security" emoji="🔐" sectionKey="loginSecurity">
            {appGlobalSettings?.forceCredForms ? (
              <>
                <div style={{ padding: "12px 0", borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 14.5, marginBottom: 8 }}>Change password</div>
                  <input type="password" value={credOldPass} onChange={(e) => setCredOldPass(e.target.value)} placeholder="Current password" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, marginBottom: 8, background: t.bg, color: t.text, boxSizing: "border-box" }} />
                  <input type="password" value={credNewPass} onChange={(e) => setCredNewPass(e.target.value)} placeholder="New password" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, marginBottom: 8, background: t.bg, color: t.text, boxSizing: "border-box" }} />
                  <input type="password" value={credConfirmPass} onChange={(e) => setCredConfirmPass(e.target.value)} placeholder="Confirm new password" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, marginBottom: 8, background: t.bg, color: t.text, boxSizing: "border-box" }} />
                  <button onClick={() => submitCredChange("password")} disabled={credBusy} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: credBusy ? 0.6 : 1 }}>{credBusy ? "Please wait…" : "Save new password"}</button>
                </div>
                <div style={{ padding: "12px 0" }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 14.5, marginBottom: 8 }}>Change email</div>
                  <input type="email" value={credNewEmail} onChange={(e) => setCredNewEmail(e.target.value)} placeholder="New email" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, marginBottom: 8, background: t.bg, color: t.text, boxSizing: "border-box" }} />
                  <input type="password" value={credOldPass} onChange={(e) => setCredOldPass(e.target.value)} placeholder="Your password" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, marginBottom: 8, background: t.bg, color: t.text, boxSizing: "border-box" }} />
                  <button onClick={() => submitCredChange("email")} disabled={credBusy} style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: credBusy ? 0.6 : 1 }}>{credBusy ? "Please wait…" : "Save new email"}</button>
                </div>
                {credError && <div style={{ color: "#FF3B30", fontSize: 12.5, marginTop: 4 }}>{credError}</div>}
                {credSuccess && <div style={{ color: "#28A745", fontSize: 12.5, marginTop: 4 }}>{credSuccess}</div>}
                {appGlobalSettings?.hideLoginSecurityNote === false && (
                  <div style={{ padding: "8px 0 4px", fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
                    If these options don’t work on your device, use the web version at <a href={sysConfig?.webFallbackUrl || "https://nextext.pages.dev"} target="_blank" rel="noopener noreferrer" style={{ color: t.primary, textDecoration: "underline" }}>{sysConfig?.webFallbackUrl || "nextext.pages.dev"}</a> to change your password or email.
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", cursor: "pointer", borderBottom: `1px solid ${t.border}` }} onClick={() => { setCredError(""); setCredSuccess(""); setCredOldPass(""); setCredNewPass(""); setCredNewEmail(""); setCredModal("password"); }}>
                  <div>
                    <div style={{ fontWeight: 600, color: t.text, fontSize: 14.5 }}>Change password</div>
                    <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Requires your current password</div>
                  </div>
                  <ChevronRight size={18} color={t.textMuted} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", cursor: "pointer" }} onClick={() => { setCredError(""); setCredSuccess(""); setCredOldPass(""); setCredNewPass(""); setCredNewEmail(""); setCredModal("email"); }}>
                  <div>
                    <div style={{ fontWeight: 600, color: t.text, fontSize: 14.5 }}>Change email</div>
                    <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Requires your password to confirm</div>
                  </div>
                  <ChevronRight size={18} color={t.textMuted} />
                </div>
                {appGlobalSettings?.hideLoginSecurityNote === false && (
                  <div style={{ padding: "8px 0 4px", fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>
                    If these options don’t work on your device, use the web version at <a href={sysConfig?.webFallbackUrl || "https://nextext.pages.dev"} target="_blank" rel="noopener noreferrer" style={{ color: t.primary, textDecoration: "underline" }}>{sysConfig?.webFallbackUrl || "nextext.pages.dev"}</a> to change your password or email.
                  </div>
                )}
              </>
            )}
          </SectionCard>
        )}

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
          <Row icon={<Palette size={18} color={t.primary} />} label="App icon & name" sub="Change launcher icon or hide as Calculator / Notes" onClick={() => onNavigate("iconPicker")} />
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
                </>
              );
            })()}
          </div>

        </SectionCard>

        <SectionCard title="Voice Notes" emoji="🎤" sectionKey="voiceNotes">
          <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
            {(globalSettings?.hideVoiceNotesSettings !== true) && (
              <>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Store voice notes in database</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>When ON, incoming voice notes are saved to the database so multiple notes queue up and play automatically. <strong>Note:</strong> If OFF, voice notes use the instant delete pipeline (user must download each). Downloaded notes are cached locally and remain visible even after 3 days, marked as downloaded. <em>Tip: Transcription of a voice note stays even after 3 days.</em></div>
                <div
              onClick={() => {
                const next = !(globalSettings?.voiceNotesStoreInDb ?? true);
                updateGlobalSettings({ voiceNotesStoreInDb: next, voiceNotesInPipeline: !next }, myUid);
              }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", cursor: "pointer" }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Store voice notes in database</div>
                    <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Save incoming voice notes for auto-play and queue</div>
                  </div>
                  <div
                    style={{ width: 46, height: 26, borderRadius: 13, background: (globalSettings?.voiceNotesStoreInDb ?? true) ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                  >
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: (globalSettings?.voiceNotesStoreInDb ?? true) ? 23 : 3, transition: "left 0.15s" }} />
                  </div>
                </div>
              </>
            )}

            {/* Voice note chimes */}
            <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Voice note chimes</span>
                <div
                  onClick={() => { const next = !voiceEndChimeOn; setVoiceEndChimeOn(next); localStorage.setItem("nextext_voice_end_chime", next ? "on" : "off"); }}
                  style={{ width: 46, height: 26, borderRadius: 13, background: voiceEndChimeOn ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: voiceEndChimeOn ? 23 : 3, transition: "left 0.15s" }} />
                </div>
              </div>
            </div>
            {voiceEndChimeOn && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.text }}>Special "2+ voice notes in a row" chime</span>
                <div
                  onClick={() => { const next = !voiceStreakChimeOn; setVoiceStreakChimeOn(next); localStorage.setItem("nextext_voice_streak_chime", next ? "on" : "off"); }}
                  style={{ width: 46, height: 26, borderRadius: 13, background: voiceStreakChimeOn ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: voiceStreakChimeOn ? 23 : 3, transition: "left 0.15s" }} />
                </div>
              </div>
            )}
            {voiceEndChimeOn && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>A chime plays after every voice note. With the special 2+ chime on (default), a brighter completion chime plays when a streak of 2+ notes ends.</div>}
            {voiceEndChimeOn && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {PING_SOUNDS.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setPingSoundId(s.id);
                      localStorage.setItem("nextext_voice_ping_sound", s.id);
                      playVoicePing();
                    }}
                    style={{ padding: "5px 10px", borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: "pointer", background: pingSoundId === s.id ? t.primary : t.bg, color: pingSoundId === s.id ? t.bubbleMeText : t.text, border: `1px solid ${pingSoundId === s.id ? t.primary : t.border}` }}
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
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Recording bar size</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.primary, minWidth: 44 }}>{Math.round(recordingBarScale * 100)}%</span>
            </div>
            <input type="range" min="0.6" max="1.6" step="0.05" value={recordingBarScale} onChange={(e) => setRecordingBarScale(Number(e.target.value))} style={{ flex: 1, width: "100%", accentColor: t.primary, marginTop: 6 }} />
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Adjust the size of the recording controls when the mic is active.</div>
          </div>
        </SectionCard>

        {/* ═══ NOTIFICATION SOUND & VIBRATION ═══ */}
        <SectionCard title="Notification Sound & Vibration" emoji="🔔" sectionKey="notifprefs">
          <NotificationsRow myUid={myUid} t={t} />
          <NotificationPrefsRow t={t} auth={auth} myUid={myUid} />
        </SectionCard>

        {/* ═══ APPEARANCE & INTERFACE ═══ */}
        <SectionCard title="Appearance & Interface" emoji="🎨" sectionKey="appearance">
          {renderSub("Theme & Display", (<>
            <Row icon={<Palette size={18} color={t.primary} />} label="Theme" sub={themes[themeKey]?.name || "Default Theme"} onClick={onOpenTheme} dataTour="theme" />
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

            {/* Splash duration — how long the launch screen (with the words) shows */}
            <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 8 }}>Launch screen duration</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                  <div
                    key={s}
                    onClick={() => setPendingSplashDuration(s)}
                    style={{ padding: "6px 12px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: pendingSplashDuration === s ? t.primary : t.bg, color: pendingSplashDuration === s ? t.bubbleMeText : t.text, border: `1px solid ${pendingSplashDuration === s ? t.primary : t.border}` }}
                  >{s}s</div>
                ))}
              </div>
              <button
                onClick={() => { setSplashDuration(pendingSplashDuration); window.location.reload(); }}
                style={{ marginTop: 10, width: "100%", padding: "10px 0", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
              >Save &amp; preview (restarts app to show launch screen)</button>
            </div>

            {/* More rounded UI */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Rounded UI</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Use softer, more rounded corners on cards, buttons and bubbles.</div>
              </div>
              <div
                onClick={() => setMoreRounded(!moreRounded)}
                style={{ width: 46, height: 26, borderRadius: 13, background: moreRounded ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: moreRounded ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>

            {/* Hide my verified badge */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Hide my verified badge</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>If you've been verified, hide the blue check from your profile and search results.</div>
              </div>
              <div
                onClick={() => { const next = !userDoc?.hideVerified; try { updateDoc(doc(db, "users", auth.user.uid), { hideVerified: next }); } catch (e) { setSendError?.("Couldn't update: " + e.message); } }}
                style={{ width: 46, height: 26, borderRadius: 13, background: userDoc?.hideVerified ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: userDoc?.hideVerified ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>

            {/* Dark lettering (inverted text on light bg) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Dark lettering</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Force dark text/icons on light backgrounds (inverted contrast).</div>
              </div>
              <div
                onClick={() => { const next = !darkLettering; setDarkLettering(next); localStorage.setItem("nextext_dark_lettering", next ? "on" : "off"); }}
                style={{ width: 46, height: 26, borderRadius: 13, background: darkLettering ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: darkLettering ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>

            {/* Dark theme (dark bg, light text) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Dark theme</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Switch to a dark theme preset (dark background, light text).</div>
              </div>
              <div
                onClick={() => { const next = !actualDarkTheme; setActualDarkTheme(next); localStorage.setItem("nextext_actual_dark_theme", next ? "on" : "off"); if (next) setThemeKey("emeraldNight"); else setThemeKey("default"); }}
                style={{ width: 46, height: 26, borderRadius: 13, background: actualDarkTheme ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: actualDarkTheme ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>
          </>), true)}

          {!globalSettings?.hideStt && renderSub("Speech to Text", (<>
            {/* Voice-to-Text toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Speech to Text</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Show a mic in every chat and in Ask AI to speak your messages. What you say is turned into text you can review and send.</div>
              </div>
              <div
                onClick={() => { const next = !sttEnabled; setSttEnabled(next); localStorage.setItem("nextext_stt_enabled", next ? "on" : "off"); }}
                style={{ width: 46, height: 26, borderRadius: 13, background: sttEnabled ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sttEnabled ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>

            {/* Auto-send transcribed messages toggle */}
            {sttEnabled && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Composer button order</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Choose whether Speech-to-Text or Voice Note appears next to the message box.</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["stt-voice", "voice-stt"].map((key) => (
                    <div key={key} onClick={() => { setComposerButtonOrder(key); localStorage.setItem("nextext_composer_button_order", key); }} style={{ flex: 1, padding: "7px 0", textAlign: "center", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: composerButtonOrder === key ? t.primary : t.bg, color: composerButtonOrder === key ? t.bubbleMeText : t.text, border: `1px solid ${composerButtonOrder === key ? t.primary : t.border}` }}>{key === "stt-voice" ? "STT → Voice" : "Voice → STT"}</div>
                  ))}
                </div>
              </div>
            )}
            {/* Voice button spacing */}
            {sttEnabled && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Space the voice buttons</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Add a gap between the voice-note and speech-to-text buttons so they don't touch.</div>
                </div>
                <div onClick={() => setVoiceSpacing(!voiceSpacing)} style={{ width: 50, height: 30, borderRadius: 15, background: voiceSpacing ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}>
                  <div style={{ position: "absolute", top: 3, left: voiceSpacing ? 23 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                </div>
              </div>
            )}
            {/* Message bubble style */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Message bubble style</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Choose the shape of your chat bubbles.</div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 210 }}>
                {[["default", "Default"], ["rounded", "Rounded"], ["square", "Square"], ["pill", "Pill"], ["outlined", "Outlined"]].map(([k, label]) => (
                  <div key={k} onClick={() => { try { localStorage.setItem("nextext_bubble_style", k); } catch {} forceSettingsRerender(); }} style={{ padding: "5px 8px", borderRadius: 7, fontSize: 10.5, fontWeight: 700, cursor: "pointer", background: (localStorage.getItem("nextext_bubble_style") || "default") === k ? t.primary : t.bg, color: (localStorage.getItem("nextext_bubble_style") || "default") === k ? t.bubbleMeText : t.text, border: `1px solid ${(localStorage.getItem("nextext_bubble_style") || "default") === k ? t.primary : t.border}` }}>{label}</div>
                ))}
              </div>
            </div>
            {/* Unread badge shows */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Unread badge shows</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Count of chats with new messages, or total unread messages.</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["chats", "Chats"], ["messages", "Messages"]].map(([k, label]) => (
                  <div key={k} onClick={() => { try { localStorage.setItem("nextext_badge_mode", k); } catch {} forceSettingsRerender(); }} style={{ padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: "pointer", background: (localStorage.getItem("nextext_badge_mode") || "chats") === k ? t.primary : t.bg, color: (localStorage.getItem("nextext_badge_mode") || "chats") === k ? t.bubbleMeText : t.text, border: `1px solid ${(localStorage.getItem("nextext_badge_mode") || "chats") === k ? t.primary : t.border}` }}>{label}</div>
                ))}
              </div>
            </div>
            {/* Hide composer camera button */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Hide camera button in composer</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Remove the quick camera icon from the message box (you can still send photos via the gallery button).</div>
              </div>
              <div onClick={() => { const next = !hideComposerCamera; setHideComposerCamera(next); try { localStorage.setItem("nextext_hide_composer_camera", next ? "on" : "off"); } catch {} }} style={{ width: 50, height: 30, borderRadius: 15, background: hideComposerCamera ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 3, left: hideComposerCamera ? 23 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </div>
            </div>
            {/* Forward arrow placement */}
            {sttEnabled && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Auto-send transcribed text</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Send your speech immediately when you stop talking instead of reviewing it first.</div>
                </div>
                <div
                  onClick={() => { const next = localStorage.getItem("nextext_stt_autosend") === "off"; localStorage.setItem("nextext_stt_autosend", next ? "on" : "off"); forceSettingsRerender(); }}
                  style={{ width: 46, height: 26, borderRadius: 13, background: localStorage.getItem("nextext_stt_autosend") !== "off" ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: localStorage.getItem("nextext_stt_autosend") !== "off" ? 23 : 3, transition: "left 0.15s" }} />
                </div>
              </div>
            )}
            {/* Live transcription preview */}
            {sttEnabled && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Show live transcription preview</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>While dictating, show the words being detected above the mic. Off by default to keep the chat clean.</div>
                </div>
                <div
                  onClick={() => { const next = !sttShowInterim; setSttShowInterim(next); localStorage.setItem("nextext_stt_show_interim", next ? "on" : "off"); }}
                  style={{ width: 46, height: 26, borderRadius: 13, background: sttShowInterim ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sttShowInterim ? 23 : 3, transition: "left 0.15s" }} />
                </div>
              </div>
            )}
            {/* Auto-send cancel button */}
            {sttEnabled && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Show auto-send cancel button</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>When auto-send is on, show a 3-second countdown with a Cancel button so you can keep the text in the composer instead of sending immediately.</div>
                </div>
                <div
                  onClick={() => { const next = !sttCancelButton; setSttCancelButton(next); localStorage.setItem("nextext_stt_cancel_button", next ? "on" : "off"); forceSettingsRerender(); }}
                  style={{ width: 46, height: 26, borderRadius: 13, background: sttCancelButton ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: sttCancelButton ? 23 : 3, transition: "left 0.15s" }} />
                </div>
              </div>
            )}
            {/* Start chime */}
            {sttEnabled && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Play chime when starting</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Play the selected voice-note ping (default Warm chime) when you begin dictation. Uses the same sound chosen in voice-note ping settings.</div>
                </div>
                <div
                  onClick={() => { const cur = localStorage.getItem("nextext_stt_start_chime") !== "off"; const next = !cur; localStorage.setItem("nextext_stt_start_chime", next ? "on" : "off"); forceSettingsRerender(); }}
                  style={{ width: 46, height: 26, borderRadius: 13, background: (localStorage.getItem("nextext_stt_start_chime") !== "off") ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: (localStorage.getItem("nextext_stt_start_chime") !== "off") ? 23 : 3, transition: "left 0.15s" }} />
                </div>
              </div>
            )}
          </>))}
          {renderSub("Chat Performance", (<>
            {/* Messages shown in a chat — performance vs. history trade-off */}
            <div style={{ padding: "13px 0" }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Messages loaded at once</div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>
                How many recent messages stay on screen. Fewer messages = a much faster, smoother chat — scrolling and swiping replies feel instant even in very long conversations. You can always tap "Load earlier" to reveal older ones.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  { id: "25", label: "25" },
                  { id: "50", label: "50" },
                  { id: "100", label: "100" },
                  { id: "200", label: "200" },
                  { id: "all", label: "All" },
                ].map((opt) => {
                  const active = (localStorage.getItem("nextext_message_limit") || "50") === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => { localStorage.setItem("nextext_message_limit", opt.id); forceSettingsRerender(); }}
                      style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: active ? t.primary : t.bg, color: active ? t.bubbleMeText : t.text, border: `1px solid ${active ? t.primary : t.border}` }}
                    >
                      {opt.label}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6 }}>
                Tip: 50 is the sweet spot for speed. Pick "All" only if you need the full history visible at once.
              </div>
            </div>
            {/* Hide app version number */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Hide app version</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Don't show the version number (e.g. v1.6.45) in the top-right of Settings.</div>
              </div>
              <div
                onClick={() => { const next = !hideVersion; setHideVersion(next); localStorage.setItem("nextext_hide_version", next ? "on" : "off"); }}
                style={{ width: 46, height: 26, borderRadius: 13, background: hideVersion ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: hideVersion ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>

            {/* Lock + button position */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Lock + button position</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Prevent the + button from being moved by accident.</div>
              </div>
              <div
                onClick={() => { const next = localStorage.getItem("nextext_fab_locked") === "on"; localStorage.setItem("nextext_fab_locked", next ? "off" : "on"); forceSettingsRerender(); }}
                style={{ width: 46, height: 26, borderRadius: 13, background: localStorage.getItem("nextext_fab_locked") === "on" ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: localStorage.getItem("nextext_fab_locked") === "on" ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>

            {/* Lock AI widget position */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Lock AI widget position</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Prevent the AI widget from being moved by accident.</div>
              </div>
              <div
                onClick={() => { const next = localStorage.getItem("nextext_ai_locked") === "on"; localStorage.setItem("nextext_ai_locked", next ? "off" : "on"); forceSettingsRerender(); }}
                style={{ width: 46, height: 26, borderRadius: 13, background: localStorage.getItem("nextext_ai_locked") === "on" ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: localStorage.getItem("nextext_ai_locked") === "on" ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>

            {/* Reset FAB & AI positions */}
            <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <button
                onClick={() => { localStorage.removeItem("nextext_fab_pos"); localStorage.removeItem("nextext_ai_pos"); forceSettingsRerender(); }}
                style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: "none", background: t.bg, color: t.text, fontWeight: 600, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: `1px solid ${t.border}` }}
              >
                <RefreshCw size={16} />
                <span>Reset + button & AI widget to default positions</span>
              </button>
            </div>
          </>))}

          {isAdmin && (() => {
            const nativeGalleryOn = sysConfig?.nativeGallery === true;
            return (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Native photo picker (Gallery)</div>
                  <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Open Android's built-in gallery instead of the Files app when picking media.</div>
                </div>
                <div
                  onClick={() => { setSystemConfig({ nativeGallery: !nativeGalleryOn }, myUid); }}
                  style={{ width: 46, height: 26, borderRadius: 13, background: nativeGalleryOn ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: nativeGalleryOn ? 23 : 3, transition: "left 0.15s" }} />
                </div>
              </div>
            );
          })()}

          {renderSub("Message Actions", (<>
            {/* Forward arrow placement */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>Forward arrows outside messages</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 1 }}>Show a forward button beside each message. Turn off to keep it inside the message bubble.</div>
              </div>
              <div
                onClick={() => { const next = localStorage.getItem("nextext_forward_arrows_outside") !== "false"; const val = next ? "off" : "on"; localStorage.setItem("nextext_forward_arrows_outside", val); forceSettingsRerender(); }}
                style={{ width: 46, height: 26, borderRadius: 13, background: localStorage.getItem("nextext_forward_arrows_outside") !== "false" ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: localStorage.getItem("nextext_forward_arrows_outside") !== "false" ? 23 : 3, transition: "left 0.15s" }} />
              </div>
            </div>
            <ActionChips
              title="Buttons outside messages"
              desc="Choose which action buttons appear beside each message. Forward is always shown."
              storageKey="nextext_outside_actions"
              fallback={userDoc?.aiApproved ? ["forward", "askai"] : ["forward"]}
              lockedKeys={[]}
              options={[
                { key: "forward", label: "Forward" },
                { key: "copy", label: "Copy" },
                ...(userDoc?.aiApproved ? [{ key: "askai", label: "Ask AI" }] : []),
              ]}
            />
            <ActionChips
              title="Long-press menu actions"
              desc="Choose which actions appear when you hold a message."
              storageKey="nextext_longpress_actions"
              fallback={userDoc?.aiApproved ? ["reply", "copy", "forward", "delete", "askai"] : ["reply", "copy", "forward", "delete"]}
              lockedKeys={[]}
              options={[
                { key: "reply", label: "Reply" },
                { key: "copy", label: "Copy" },
                { key: "forward", label: "Forward" },
                { key: "delete", label: "Delete" },
                ...(userDoc?.aiApproved ? [{ key: "askai", label: "Ask AI" }] : []),
              ]}
            />
          </>))}
          {renderSub("Text, Fonts & Animations", (<>
            {/* Fullscreen mode toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0" }}>
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
            <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 6 }}>Font</div>
              <select value={appFontId} onChange={(e) => setAppFontId(e.target.value)} style={{ width: "100%", padding: "10px 14px", paddingRight: 16, boxSizing: "border-box", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, background: t.bg, color: t.text, cursor: "pointer" }}>
                {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>

            {/* App-wide text scaling */}
            <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
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
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Animate tab taps (animateOnTap)</span>
              <Toggle on={animateOnTap} onClick={() => setAnimateOnTap(!animateOnTap)} />
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Force page animation when tapping bottom or top bar navigation buttons. (Default: off)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Page swipe animation</span>
              <Toggle on={swipeAnimationOn} onClick={() => setSwipeAnimationOn(!swipeAnimationOn)} />
            </div>
            {swipeAnimationOn && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Slide animation when swiping between tabs.</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Overscroll bounce</span>
              <Toggle on={swipeBounce} onClick={() => setSwipeBounce(!swipeBounce)} />
            </div>
            {swipeBounce && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Shows the bounce/glow indicator when you scroll past the top or bottom of a list, and when swiping past the first or last tab.</div>}
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
          </>))}

          {renderSub("Search & Composer", (<>
            {/* Search bar size */}
            <div style={{ padding: "13px 0" }}>
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
          </>))}

          {renderSub("Navigation & Bottom Bar", (<>
            {/* Bottom bar customizer */}
            <div style={{ padding: "13px 0" }} onPointerMove={onEditorPointerMove} onPointerUp={onEditorPointerUp} onPointerLeave={onEditorPointerUp}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Bottom bar layout</div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10 }}>
                {navConfigLocked
                  ? "Tab order is locked. Unlock to drag tabs to reorder."
                  : "Drag the ⠿ handle to reorder tabs, or use the arrows. Chats is always on."}
              </div>
              {ALL_TABS.map((tabDef) => {
                const activeIdx = navConfig.findIndex((n) => n.key === tabDef.key);
                const isActive = activeIdx !== -1;
                return (
                  <div
                    key={tabDef.key}
                    ref={(el) => { if (el) rowRefs.current[tabDef.key] = el; }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${t.border}`, opacity: isActive ? 1 : 0.5, background: dragIndex === activeIdx ? t.primaryLight : "transparent" }}
                  >
                    <span
                      onPointerDown={(e) => { if (navConfigLocked || !isActive) return; e.preventDefault(); setDragIndex(activeIdx); }}
                      title="Drag to reorder"
                      style={{ cursor: navConfigLocked || !isActive ? "default" : "grab", color: t.textMuted, fontSize: 18, lineHeight: 1, touchAction: "none", userSelect: "none" }}
                    >⠿</span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isActive ? t.text : t.textMuted }}>{tabDef.label}{tabDef.mandatory ? " (always on)" : ""}</span>
                    {!tabDef.mandatory && <Toggle on={isActive} onClick={() => navConfigLocked ? null : toggleTab(tabDef.key)} disabled={navConfigLocked} />}
                    {tabDef.mandatory && <div style={{ width: 46 }} />}
                    {isActive && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <div onClick={() => moveTab(activeIdx, -1)} style={{ width: 26, height: 26, borderRadius: 6, background: navConfigLocked || activeIdx <= 0 ? "transparent" : t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: navConfigLocked || activeIdx <= 0 ? "default" : "pointer", fontSize: 14, color: navConfigLocked || activeIdx <= 0 ? t.textMuted : t.primary }}>↑</div>
                        <div onClick={() => moveTab(activeIdx, 1)} style={{ width: 26, height: 26, borderRadius: 6, background: navConfigLocked || activeIdx >= navConfig.length - 1 ? "transparent" : t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: navConfigLocked || activeIdx >= navConfig.length - 1 ? "default" : "pointer", fontSize: 14, color: navConfigLocked || activeIdx >= navConfig.length - 1 ? t.textMuted : t.primary }}>↓</div>
                        {navConfigLocked && <Lock size={14} color={t.textMuted} style={{ marginLeft: 4, marginTop: 2 }} />}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: t.text }}>Lock tab order</span>
                <Toggle on={navConfigLocked} onClick={() => setNavConfigLocked(!navConfigLocked)} />
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Prevent accidental reordering of bottom bar tabs.</div>
{!appGlobalSettings?.hideLaunchPage && (
              <div style={{ padding: "13px 0", borderTop: `1px solid ${t.border}` }}>
                <div style={{ fontWeight: 600, color: t.text, fontSize: 15, marginBottom: 4 }}>Launch page</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Choose which tab the app opens on when launched.</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {["chats", "status", "groups", "settings"].map((key) => (
                    <div key={key} onClick={() => onLaunchPageSelect ? onLaunchPageSelect(key) : (setLaunchPage(key), localStorage.setItem("nextext_launch_page", key))} style={{ flex: 1, minWidth: 70, padding: "8px 0", textAlign: "center", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: launchPage === key ? t.primary : t.bg, color: launchPage === key ? t.bubbleMeText : t.text, border: `1px solid ${launchPage === key ? t.primary : t.border}` }}>{key.charAt(0).toUpperCase() + key.slice(1)}</div>
                  ))}
                </div>
              </div>
)}
            </div>
          </>))}
        {renderSub("Lists & Other", (<>
          <Row icon={<MessageSquare size={18} color={t.primary} />} label="Link previews" sub={linkPreviewsOn ? "On" : "Off"} right={<Toggle on={linkPreviewsOn} onClick={() => { const next = !linkPreviewsOn; setLinkPreviewsOn(next); localStorage.setItem("nextext_link_previews", next ? "on" : "off"); }} />} />
          <Row icon={<CircleDot size={18} color={t.primary} />} label="Scroll-to-bottom button" sub={showScrollDown ? "On" : "Off"} right={<Toggle on={showScrollDown} onClick={() => setShowScrollDown(!showScrollDown)} />} />
          {showScrollDown && (
            <div style={{ padding: "0 0 8px 36px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.text }}>Button size</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: t.primary, minWidth: 40 }}>{Math.round((scrollDownSize / 22) * 100)}%</span>
              </div>
              <input type="range" min="14" max="40" step="1" value={scrollDownSize} onChange={(e) => setScrollDownSize(Number(e.target.value))} style={{ width: "100%", accentColor: t.primary }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.text }}>Position</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {[["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([key, label]) => (
                  <div key={key} onClick={() => setScrollDownPos(key)} style={{ flex: 1, padding: "7px 0", textAlign: "center", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: scrollDownPos === key ? t.primary : t.bg, color: scrollDownPos === key ? t.bubbleMeText : t.text, border: `1px solid ${scrollDownPos === key ? t.primary : t.border}` }}>{label}</div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { setScrollDownSize(22); setScrollDownPos("center"); }}
                style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: t.primary, background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
              >
                <RotateCcw size={13} /> Reset to default
              </button>
            </div>
          )}
          <Row icon={<CircleDot size={18} color={t.primary} />} label="Animated scroll entry" sub={animatedScrollEntry ? "Smooth jump" : "Instant mount"} right={<Toggle on={animatedScrollEntry} onClick={() => { const next = !animatedScrollEntry; setAnimatedScrollEntry(next); localStorage.setItem("nextext_animated_scroll_entry", next ? "true" : "false"); }} />} />
          <Row icon={<Users size={18} color={t.primary} />} label="Compact chat list" sub={compactList ? "Denser rows" : "Standard spacing"} right={<Toggle on={compactList} onClick={() => { const next = !compactList; setCompactList(next); localStorage.setItem("nextext_compact_list", next ? "true" : "false"); }} />} />
          <Row icon={<Smile size={18} color={t.primary} />} label="Large emoji-only messages" sub={emojiBigOn ? "Emoji-only messages shown big" : "Same size as text"} right={<Toggle on={emojiBigOn} onClick={() => { const next = !emojiBigOn; setEmojiBigOn(next); localStorage.setItem("nextext_emoji_big", next ? "on" : "off"); }} />} />
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
          </>))}
        </SectionCard>

         {/* ═══ AI CONTROLS ═══ */}
         {userRestrictions?.blockAI !== true && !sysConfig?.hideAiEverywhere && !userDoc?.hideAISettings && (
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
                 <div style={{ padding: "12px 0", borderTop: `1px solid ${t.border}` }}>
                   <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                     <div style={{ fontWeight: 600, color: t.text, fontSize: 14 }}>Custom Instructions (optional)</div>
                     <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, flexShrink: 0 }}>
                       <input type="checkbox" checked={useCustomPrompt} onChange={(e) => { const v = e.target.checked ? "on" : "off"; setUseCustomPrompt(e.target.checked); try { localStorage.setItem("nextext_ai_custom_instructions_enabled", v); } catch {} }} style={{ opacity: 0, width: 0, height: 0 }} />
                       <span style={{ position: "absolute", cursor: "pointer", inset: 0, background: useCustomPrompt ? t.primary : "#ccc", borderRadius: 24, transition: "background .2s" }}><span style={{ position: "absolute", height: 18, width: 18, left: useCustomPrompt ? 23 : 3, top: 3, background: "#fff", borderRadius: "50%", transition: "left .2s" }} /></span>
                     </label>
                   </div>
                   <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 8 }}>Add instructions for how the AI should behave, answer, or format responses. These are prepended to the AI's system prompt. Enabled by default.</div>
                   <textarea
                     defaultValue={localStorage.getItem("nextext_ai_custom_instructions") || ""}
                     onChange={(e) => { try { localStorage.setItem("nextext_ai_custom_instructions", e.target.value); } catch {} }}
                     placeholder="e.g. Always answer in short paragraphs. Use bullet points for lists. Be concise but friendly."
                     style={{ width: "100%", minHeight: 80, padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", outline: "none" }}
                   />
                   <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6 }}>Saved locally on this device. Clear to use defaults.</div>
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
          <UserStatsCard myUid={myUid} createdAt={userDoc?.createdAt} activeTimeMs={userDoc?.activeTimeMs} contacts={contacts} />
          <div style={{ marginTop: 8 }} />
          <Row icon={<MessageSquare size={18} color={t.primary} />} label="Send Feedback" sub="Message the admin directly" onClick={() => onNavigate("feedback")} />
          {!sysConfig?.tourDisabled && <Row icon={<Compass size={18} color={t.primary} />} label="Replay Welcome Tour" sub="See the first-run guide again" onClick={(e) => { e.stopPropagation(); onShowTour(); }} />}
          {isAdmin && <Row icon={<ShieldCheck size={18} color={t.primary} />} label="Admin Dashboard" sub="Users, reports, broadcasts" onClick={() => onNavigate("admin")} />}
          {!appGlobalSettings?.hideAnnouncements && <Row icon={<Megaphone size={18} color={t.primary} />} label="Announcements" sub="Posts from the admin" onClick={() => onNavigate("announcements")} />}

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
      {credModal && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999999, padding: 20 }} onClick={() => !credBusy && setCredModal(null)}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 18, width: "100%", maxWidth: 340, boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 14 }}>{credModal === "password" ? "Change password" : "Change email"}</div>
            {credModal === "password" ? (
              <>
                <input type="password" placeholder="Current password" value={credOldPass} onChange={(e) => setCredOldPass(e.target.value)} style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", marginBottom: 10, background: t.bg, color: t.text }} />
                <input type="password" placeholder="New password (min 6 chars)" value={credNewPass} onChange={(e) => setCredNewPass(e.target.value)} style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", background: t.bg, color: t.text }} />
              </>
            ) : (
              <>
                <input type="password" placeholder="Your password" value={credOldPass} onChange={(e) => setCredOldPass(e.target.value)} style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", marginBottom: 10, background: t.bg, color: t.text }} />
                <input type="email" placeholder="New email address" value={credNewEmail} onChange={(e) => setCredNewEmail(e.target.value)} style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, boxSizing: "border-box", background: t.bg, color: t.text }} />
              </>
            )}
            {credError && <div style={{ color: "#FF3B30", fontSize: 12.5, marginTop: 10 }}>{credError}</div>}
            {credSuccess && <div style={{ color: "#28A745", fontSize: 12.5, marginTop: 10 }}>{credSuccess}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setCredModal(null)} disabled={credBusy} style={{ flex: 1, padding: 11, borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitCredChange} disabled={credBusy} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: credBusy ? 0.6 : 1 }}>{credBusy ? "Please wait…" : "Save"}</button>
            </div>
          </div>
        </div>
      , document.body)}
      </div>
    </div>
  );
}

const DEFAULT_NAV_CONFIG = [{ key: "chats" }, { key: "status" }, { key: "groups" }, { key: "settings" }];
const TAB_KEYS = ["chats", "status", "groups", "settings"];

// Single source of truth for the visible tab order (pager + bottom bar).
// Applies restrictions, forces "chats" to front, "settings" to end when top bar hidden.
function getEffectiveTabs(navConfig, userRestrictions, topBarVisible) {
  const tabs = navConfig
    .filter(({ key }) => {
      if (key === "status" && userRestrictions?.blockStatus === true) return false;
      if (key === "groups" && userRestrictions?.blockGroups === true) return false;
      return TAB_KEYS.includes(key);
    })
    .map(({ key }) => key);
  if (!topBarVisible && !tabs.includes("settings")) tabs.push("settings");
  // Chats must always be reachable; if a (bad) navConfig dropped it, append it.
  // NOTE: we no longer force chats to the front — that broke the user's chosen
  // launch page (cold start must open on launchPage, not always the chat list).
  if (!tabs.includes("chats")) tabs.push("chats");
  return tabs;
}

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
  { target: null, tab: null, emoji: "👋", title: "Welcome to NexText", body: "A fast, private messaging app for you and your friends. I'll walk you through the app live — tap Next to explore each screen.", arrow: null },
  { target: "chats", tab: "chats", emoji: "💬", title: "Your chats", body: "Every direct conversation lives here. Tap any chat to open it. The filter chips let you jump between All, Unread, Favorites, Groups, Broadcast, and any custom lists you've made.", arrow: "up" },
  { target: "chats", tab: "chats", emoji: "➕", title: "Starting a new chat", body: "Tap the green + button to create a new chat, group, broadcast list, or custom list filter. Long-press a chat for quick actions like mute, archive, favorite, and lock.", arrow: "up", selector: "[title='Sort chats']", requireTap: true, tapHint: "Tap the sort button next to the + to try it, then Next." },
  { target: "status", tab: "status", emoji: "📸", title: "Statuses", body: "Post photo, video, text, or voice-note statuses your contacts can see for 24 hours. Tap the + here to open the Status Builder.", arrow: "up" },
  { target: "status", tab: "status", emoji: "🎙️", title: "Status Builder", body: "Inside the Status Builder you can record a voice note, post multiple photos, type with custom fonts, or paint with the text creator. Voice notes also live in the media tab.", arrow: null, selector: "[data-tour-status-builder]", requireTap: true, tapHint: "Open the Status Builder, then come back." },
  { target: "groups", tab: "groups", emoji: "👥", title: "Groups & broadcasts", body: "The Groups tab only shows your group conversations. From the Chats tab you can also create broadcast lists and custom lists for organized conversations.", arrow: "up" },
  { target: "settings", tab: "settings", emoji: "🔒", title: "Privacy & settings", body: "Themes, privacy controls, permissions, app lock, locked chats, and parental controls all live in Settings. Tap Next to see the most-used sections.", arrow: "up" },
  { target: "settings", tab: "settings", emoji: "🎨", title: "Themes & UI", body: "Inside Settings → Theme you can pick a preset, design your own colors, or auto-rotate themes on a schedule. Search bar size, recording bar size, and message box size are all customizable too.", arrow: null, selector: "[data-tour-theme]", requireTap: true, tapHint: "Tap the Theme row to preview it." },
  { target: "settings", tab: "settings", emoji: "🔔", title: "Voice note chimes", body: "Settings → Voice note chimes lets you turn the end-of-voice-note sound on or off. You'll hear a soft ping when a voice note finishes — and a brighter chime when a streak of 2+ notes ends.", arrow: null, selector: "[data-tour-voice-chime]", requireTap: true, tapHint: "Tap the Voice note chimes row." },
  { target: "settings", tab: "settings", emoji: "🤖", title: "NexText AI", body: "NexText AI is request-only — not everyone has it by default. From Settings → NexText AI you can ask for access. Once approved you get 6 personalities, image analysis, and chat summaries.", arrow: null },
  { target: null, tab: null, emoji: "👤", title: "Your profile", body: "Tap your avatar at the top of the Chats tab (or open Me) to view your profile. You can change your display name and username there, and see your 'NexText member since' date.", arrow: null },
  { target: null, tab: null, emoji: "🎉", title: "You're all set!", body: "That's the full tour. Found a bug or want a new feature? Send a message to the admin anytime from Settings → Account → Send Feedback — it goes straight to them. Have fun!", arrow: null },
];

function TourOverlay({ step, total, onNext, onPrev, onSkip }) {
  const s = TOUR_STEPS[step];
  const [rect, setRect] = useState(null);
  // Minimized mode: drop the dark backdrop + card so the user can actually
  // DO what the tour asks (tap the real control, open a screen, etc.), but
  // KEEP the arrow pointing at the current target so they still know what to
  // interact with. A small floating "Resume tour" pill brings the full tour
  // back. Toggling does not change the step, so progress is never lost.
  const [minimized, setMinimized] = useState(false);
  const measure = useCallback(() => {
    if (!s) { setRect(null); return; }
    if (s.selector) {
      const el = document.querySelector(s.selector);
      if (el) { const r = el.getBoundingClientRect(); setRect({ x: r.left, y: r.top, w: r.width, h: r.height }); return; }
    }
    if (s.target) {
      const el = document.querySelector(`[data-tour-nav="${s.target}"]`);
      if (el) { const r = el.getBoundingClientRect(); setRect({ x: r.left, y: r.top, w: r.width, h: r.height }); return; }
    }
    setRect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.target, s?.selector]);
  useEffect(() => {
    measure();
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
  const zArrow = 2147483647;
  // Position the card so it never overlaps the spotlight.
  let cardTop = 28, cardLeft = 14, cardRight = 14;
  let arrow = null;
  if (rect && s.arrow) {
    if (s.arrow === "up") {
      // Place the card ABOVE the spotlight with an arrow pointing down.
      const above = rect.y - 8;
      if (above > 240) {
        cardTop = Math.max(28, above - 280);
        arrow = { top: cardTop + 270, left: rect.x + rect.w / 2 - 12, rotation: 180 };
      } else {
        cardTop = rect.y + rect.h + 8;
        arrow = { top: rect.y + rect.h - 4, left: rect.x + rect.w / 2 - 12, rotation: 0 };
      }
    }
  }
  const cardStyle = {
    position: "absolute", top: cardTop, left: cardLeft, right: cardRight, zIndex: zCard,
    background: "#121B22", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18,
    padding: "18px 18px 16px", boxShadow: "0 12px 40px rgba(0,0,0,0.5)", transition: "top 0.25s ease",
  };
  return (
    <>
      {!minimized && (
        rect ? (
          <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: zHole, boxShadow: "0 0 0 100vmax rgba(0,0,0,0.72)", borderRadius: 12, pointerEvents: "none", transition: "left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, zIndex: zBackdrop, background: "rgba(0,0,0,0.72)", pointerEvents: "none" }} />
        )
      )}
      {arrow && (
        <div style={{ position: "absolute", top: arrow.top, left: arrow.left, zIndex: zArrow, width: 0, height: 0, borderLeft: "12px solid transparent", borderRight: "12px solid transparent", borderTop: `16px solid #10B981`, transform: `rotate(${arrow.rotation}deg)`, pointerEvents: "none", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }} />
      )}
      {minimized ? (
        // Minimized: just the arrow (above) + a floating resume pill so the
        // user can complete the step and come back. No dark backdrop, so the
        // app underneath is fully interactive.
        <button
          onClick={() => setMinimized(false)}
          style={{ position: "absolute", bottom: "calc(env(safe-area-inset-bottom) + 18px)", left: "50%", transform: "translateX(-50%)", zIndex: zArrow, display: "flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 99, border: "none", background: "#10B981", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
        >
          ▸ Resume tour ({step + 1}/{total})
        </button>
      ) : (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 26 }}>{s.emoji}</span>
          <span style={{ fontWeight: 800, fontSize: 18, color: "#fff" }}>{s.title}</span>
          <button
            onClick={() => setMinimized(true)}
            title="Minimize tour"
            aria-label="Minimize tour"
            style={{ marginLeft: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 8px", cursor: "pointer" }}
          >
            – Minimize
          </button>
        </div>
        <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.55, marginBottom: s.tapHint ? 10 : 16 }}>{s.body}</div>
        {s.tapHint && (
          <div style={{ fontSize: 12, color: "#10B981", fontWeight: 700, marginBottom: 14, padding: "8px 10px", borderRadius: 10, background: "rgba(16,185,129,0.12)", border: "1px dashed rgba(16,185,129,0.4)" }}>
            👉 {s.tapHint}
          </div>
        )}
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
      )}
    </>
  );
}

function AppShell({ appLocked, setAppLocked }) {
  const { t, themeKey, setThemeKey, hideNav, appFont, voiceSpacing, setVoiceSpacing } = useTheme();
  const auth = useAuth();
  useSystemInsets();
  const globalSettings = useGlobalSettings();
  const sysConfig = useSystemConfigHook();
  // Mirror the admin-configured AI icon style into the shared singleton so the
  // Avatar component re-renders with the chosen look.
  useEffect(() => {
    import("./services/aiIcon").then((m) => m.setAIIconStyle(globalSettings?.aiIconStyle || "neon"));
  }, [globalSettings?.aiIconStyle]);
  // Stealth pre-warm: keep the Render FCM worker awake while users are active.
  // Runs on app launch and again whenever the app returns to the foreground
  // (e.g. user switches back to it an hour later). No-ops when an admin has the
  // feature disabled server-side.
  useEffect(() => {
    runPreWarmPing();
    const onVisibility = () => {
      if (document.visibilityState === "visible") runPreWarmPing();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [screen, setScreen] = useState("list");
  // App-icon / app-name disguise gate. Reads the active profile from
  // iconManager on every render. When the profile is a "calculator" or
  // "notes" disguise AND `disguiseUnlocked` is still false, we render the
  // disguise screen INSTEAD of the real app — the user has to enter their
  // PIN (calculator) or type their keyword in a note (notes) to get past
  // it. The disguise's onUnlock callback flips `disguiseUnlocked` to true,
  // and from that moment on we render the regular app (so coming back into
  // a focused WebView doesn't re-trigger the gate).
  const [disguiseUnlocked, setDisguiseUnlocked] = useState(false);
  // Size the shell to the VISUAL viewport height (window.innerHeight), not the
  // CSS `100%` chain. On Android the `<html>/<body>` `height:100%` resolves to
  // the layout viewport, which is taller than the visible area once the
  // on-screen navigation bar is accounted for — pushing anything pinned to
  // `bottom: 0` (the bottom nav bar) below the fold on first paint. Tapping
  // Settings later forced a reflow that "fixed" it; sizing to innerHeight makes
  // it correct from the very first frame.
  const [appHeight, setAppHeight] = useState(() => (typeof window !== "undefined" ? window.visualViewport?.height || window.innerHeight : 0));
  // True on phone-sized screens. We scale the app with native viewport scaling
  // ONLY on mobile — CSS `zoom` breaks touch hit-testing on the F21 Pro WebView,
  // but it works fine on desktop, so desktop keeps responsive + CSS-zoom. This
  // keeps the desktop (wide) view from being locked into a 390px column.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 429px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 429px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange); else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);
  useEffect(() => {
    const update = () => setAppHeight(window.visualViewport?.height || window.innerHeight || 0);
    update();
    window.addEventListener("resize", update);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", update);
      window.visualViewport.addEventListener("scroll", update);
    }
    return () => {
      window.removeEventListener("resize", update);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", update);
        window.visualViewport.removeEventListener("scroll", update);
      }
    };
  }, []);
  // The active icon profile drives the disguise gate. localStorage is the
  // fast path, but it can be dropped independently of native storage, so we
  // reconcile against the native SharedPreferences value on every cold start.
  const [iconProfileId, setIconProfileId] = useState(() => getActiveProfileId());
  useEffect(() => {
    let cancelled = false;
    syncNativeProfile().then((id) => { if (!cancelled) setIconProfileId(id); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const activeProfile = ICON_PROFILES.find((p) => p.id === iconProfileId) || ICON_PROFILES[0];
  const baseDisguiseKind = activeProfile && (activeProfile.kind === "calculator" || activeProfile.kind === "notes") ? activeProfile.kind : null;
  // Admin "force notepad disguise" switch. When on, every client (regardless of
  // the chosen launcher icon) opens into the Notes disguise, and the unlock
  // keyword is forced to the admin-configured value (default "Rosh").
  const disguiseKind = globalSettings?.forceNotepadDisguise ? "notes" : baseDisguiseKind;
  const [activeChat, setActiveChat] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);
  const [uiScale, setUiScale] = useState(() => Number(localStorage.getItem(UI_SCALE_KEY)) || 1);
  const [recordingBarScale, setRecordingBarScale] = useState(() => { try { const v = Number(localStorage.getItem("nextext_recording_bar_scale")); return v && v >= 0.6 && v <= 1.6 ? v : 1; } catch { return 1; } });
  const [showScrollDown, setShowScrollDown] = useState(() => localStorage.getItem(SCROLL_DOWN_KEY) !== "false");
  const [animatedScrollEntry, setAnimatedScrollEntry] = useState(() => localStorage.getItem("nextext_animated_scroll_entry") === "true");
  const [emojiAnimations, setEmojiAnimations] = useState(() => localStorage.getItem("nextext_emoji_animations") !== "off");
  // Emoji-only messages render large by default (a long-standing NexText feel).
  // This toggle lets the user revert to normal-sized text for emoji-only
  // messages. Default ON.
  const [emojiBigOn, setEmojiBigOn] = useState(() => localStorage.getItem("nextext_emoji_big") !== "off");
  const [compactList, setCompactList] = useState(() => localStorage.getItem("nextext_compact_list") === "true");
  const [showThemeSheet, setShowThemeSheet] = useState(false);
  const [launchPage, setLaunchPage] = useState(() => localStorage.getItem("nextext_launch_page") || "groups");
  const [activeNavTab, setActiveNavTab] = useState(() => localStorage.getItem("nextext_launch_page") || "groups");
  // Lifted "Ask AI about this" panel: rendered at the App-shell level (not inside
  // a scrollable/conversation subtree) so its position:fixed inset:0 resolves to
  // the fixed-size phone shell instead of a content-grown container.
  const [askAIGlobal, setAskAIGlobal] = useState(null);
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
  const [splashDuration, setSplashDuration] = useState(() => Number(localStorage.getItem("nextext_splash_duration")) || 4);
  const [pendingSplashDuration, setPendingSplashDuration] = useState(splashDuration);
  useEffect(() => { try { localStorage.setItem("nextext_splash_duration", String(splashDuration)); } catch {} }, [splashDuration]);
  const [moreRounded, setMoreRounded] = useState(() => localStorage.getItem("nextext_more_rounded") === "on");
  useEffect(() => { try { localStorage.setItem("nextext_more_rounded", moreRounded ? "on" : "off"); } catch {} }, [moreRounded]);
  const [hangBanner, setHangBanner] = useState(false);

  // If auth stays "loading" too long (e.g. Firebase auth hangs on a particular
  // WebView), show a non-blocking banner instead of an indefinite dark screen,
  // plus auto-retry once after 25s.
  useEffect(() => {
    if (!auth.loading) { setHangBanner(false); return; }
    setHangBanner(false);
    const t1 = setTimeout(() => setHangBanner(true), 15000);
    const t2 = setTimeout(() => { if (auth.loading) window.location.reload(); }, 25000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [auth.loading]);

  // First-boot local-data migration: if a previous install (or a debug build
  // with a different signature) left stale/corrupt local data, wipe it so the
  // app starts clean instead of hanging on bad auth/persistence state. Runs
  // once whenever the stored schema version is behind APP_DATA_VERSION.
  const APP_DATA_VERSION = 3;
  useEffect(() => {
    try {
      const key = "nx_app_data_version";
      const v = parseInt(localStorage.getItem(key) || "0", 10);
      if (v < APP_DATA_VERSION) {
        console.warn("[nextext] app data v" + v + " < " + APP_DATA_VERSION + " — clearing local data for a clean start");
        localStorage.clear();
        if (indexedDB && indexedDB.databases) {
          indexedDB.databases().then((dbs) => {
            (dbs || []).forEach((d) => { try { indexedDB.deleteDatabase(d.name); } catch {} });
          }).catch(() => {});
        }
        localStorage.setItem(key, String(APP_DATA_VERSION));
      }
    } catch { /* best-effort */ }
  }, []);
  const [darkLettering, setDarkLettering] = useState(() => localStorage.getItem("nextext_dark_lettering") === "on");
  const [actualDarkTheme, setActualDarkTheme] = useState(() => localStorage.getItem("nextext_actual_dark_theme") !== "off");
const [splashVisible, setSplashVisible] = useState(() => localStorage.getItem("nextext_splash_enabled") !== "off");
  const [splashFading, setSplashFading] = useState(false);
  const [splashHold, setSplashHold] = useState(true);
  const splashStartRef = useRef(0);
  const [aiSidebarOn, setAiSidebarOn] = useState(() => localStorage.getItem("nextext_ai_sidebar") !== "off");
  const [searchMode, setSearchMode] = useState(() => localStorage.getItem("nextext_search_mode") || "visible");
  const [topBarVisible, setTopBarVisible] = useState(() => localStorage.getItem("nextext_top_bar_visible") !== "false");
  const [animateOnTap, setAnimateOnTap] = useState(() => localStorage.getItem("nextext_animate_on_tap") === "true");
  const [swipeAnimationOn, setSwipeAnimationOn] = useState(() => localStorage.getItem("nextext_swipe_animation") !== "off");
  const [swipeSpeed, setSwipeSpeed] = useState(() => { try { return localStorage.getItem("nextext_swipe_speed") || "normal"; } catch { return "normal"; } });
  const [swipeBounce, setSwipeBounce] = useState(() => localStorage.getItem("nextext_swipe_bounce") !== "off");
  const [navConfigLocked, setNavConfigLocked] = useState(() => localStorage.getItem("nextext_nav_config_locked") === "true");
  const [composerButtonOrder, setComposerButtonOrder] = useState(() => localStorage.getItem("nextext_composer_button_order") || "stt-voice");
  const [searchBarScale, setSearchBarScale] = useState(() => { try { return Number(localStorage.getItem("nextext_search_bar_scale")) || 1.25; } catch { return 1.25; } });
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
  const [voiceStreakChimeOn, setVoiceStreakChimeOn] = useState(() => localStorage.getItem("nextext_voice_streak_chime") !== "off");
  const [scrollDownSize, setScrollDownSize] = useState(() => { try { const v = Number(localStorage.getItem("nextext_scroll_down_size")); return v >= 14 && v <= 40 ? v : 22; } catch { return 22; } });
  const [scrollDownPos, setScrollDownPos] = useState(() => { try { const v = localStorage.getItem("nextext_scroll_down_pos"); return ["center", "left", "right"].includes(v) ? v : "center"; } catch { return "center"; } });
  const [barEpoch, setBarEpoch] = useState(0);
  const [pingSoundId, setPingSoundId] = useState(() => { try { return localStorage.getItem("nextext_voice_ping_sound") || "warm"; } catch { return "warm"; } });
  const [voicePlayerStyle, setVoicePlayerStyle] = useState(() => { try { return localStorage.getItem("nextext_voice_player_style") || "waveform"; } catch { return "waveform"; } });
  const [autoUpdateCheckOn, setAutoUpdateCheckOn] = useState(() => localStorage.getItem("nextext_auto_update_check") !== "off");
  const shellRef = useRef(null);
  const pageRefs = useRef({});
  const pagerContainerRef = useRef(null);
  const pagerRowRef = useRef(null);

  const glowRef = useRef(null);

  // Guard against a horizontal document scroll that offsets the entire pager.
  // On the F21 Pro WebView a stray scrollLeft (autofocus / transient wide
  // element) shifts every absolutely-positioned page left by that amount,
  // which reads as a uniform -Npx offset in getBoundingClientRect (the
  // "Groups on cold start" bug). Keep the root scroll fully locked.
  useEffect(() => {
    const lock = () => {
      try {
        if (document.documentElement.scrollLeft !== 0) document.documentElement.scrollLeft = 0;
        if (document.body.scrollLeft !== 0) document.body.scrollLeft = 0;
      } catch {}
    };
    lock();
    document.addEventListener("scroll", lock, true);
    window.addEventListener("resize", lock);
    return () => {
      document.removeEventListener("scroll", lock, true);
      window.removeEventListener("resize", lock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [snapAnimating, setSnapAnimating] = useState(false);
  const snapTimerRef = useRef(null);
  const pagerDragRef = useRef(null);

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

  // Persist the chosen splash duration to the user's profile so it's consistent
  // across devices (localStorage is per-origin and doesn't carry from a desktop
  // browser to the mobile app's WebView). Also migrate an existing localStorage
  // value into the profile on first sign-in.
  const applySplashDuration = (s) => {
    setSplashDuration(s);
    try { localStorage.setItem("nextext_splash_duration", String(s)); } catch {}
    // Use setDoc(merge) so this works even if the profile doc was just created
    // and isn't visible to the rules yet (avoids "No document to update").
    if (myUid) { try { setDoc(doc(db, "users", myUid), { splashDuration: s }, { merge: true }); } catch {} }
  };
  useEffect(() => {
    if (!myUid) return;
    const prof = auth.userDoc?.splashDuration;
    if (typeof prof === "number" && prof > 0) {
      if (prof !== splashDuration) { setSplashDuration(prof); try { localStorage.setItem("nextext_splash_duration", String(prof)); } catch {} }
    } else {
      const local = Number(localStorage.getItem("nextext_splash_duration"));
      if (local > 0) { try { setDoc(doc(db, "users", myUid), { splashDuration: local }, { merge: true }); } catch {} }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, auth.userDoc?.splashDuration]);

  // While any in-app camera is open we hide the bottom navigation bar so its
  // shutter/capture controls are never covered by the nav. Camera components
  // signal open/close via these window events (GlobalCamera, ChatListScreen).
  const [cameraOpen, setCameraOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setCameraOpen(true);
    const onClose = () => setCameraOpen(false);
    window.addEventListener("nx-camera-open", onOpen);
    window.addEventListener("nx-camera-close", onClose);
    return () => {
      window.removeEventListener("nx-camera-open", onOpen);
      window.removeEventListener("nx-camera-close", onClose);
    };
  }, []);
  // Ref mirror of myUid so mount-only effects (notification tap/mark-read
  // handlers) can read the CURRENT uid without a stale closure.
  const myUidRef = useRef(myUid);
  useEffect(() => { myUidRef.current = myUid; }, [myUid]);

  // Ref mirrors of chats/contacts/openChat are set up further down, AFTER those
  // values are declared, to avoid a Temporal Dead Zone error (see openChatRef
  // block just after openChat's definition).

  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  // In-app navigation history so the Android hardware Back button walks back
  // through screens instead of immediately closing the app.
  const navHistoryRef = useRef([screen]);
  useEffect(() => {
    navHistoryRef.current.push(screen);
    if (navHistoryRef.current.length > 40) navHistoryRef.current.shift();
  }, [screen]);
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
      navigateToTab(launchPage);
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
  const [coldStartComplete, setColdStartComplete] = useState(false);
  // Temporary boot diagnostic (v1.6.21): shows the real tab state for 12s so a
   const [pagerDebug, setPagerDebug] = useState("");
   // While true, the in-app splash stays fully opaque. The awake-kick releases
  // it once the cold-start repair has run, so the Settings-trip recovery
  // happens invisibly behind the splash instead of flashing the screen.
  // Hold the splash long enough for the awake-kick cold-start repair to run
  // BEHIND it. On the auth screen (no chat interface yet) a plain 8s fallback
  // releases it. After login/sign-up the splash is re-held until the awake-kick
  // finishes, so the recovery's screen trip can never flash — even when the
  // user spent minutes on the sign-up screen (the old mount-only timer would
  // have expired long before the chat interface first appeared).
  useEffect(() => {
    if (!myUid) {
      const t = setTimeout(() => setSplashHold(false), splashDuration * 1000);
      return () => clearTimeout(t);
    }
    if (localStorage.getItem("nextext_splash_enabled") !== "off") {
      setSplashFading(false);
      setSplashVisible(true);
    }
    setSplashHold(true);
    splashStartRef.current = Date.now();
    // Hold for the user-configured splash duration.
    const t = setTimeout(() => setSplashHold(false), splashDuration * 1000);
    return () => clearTimeout(t);
  }, [myUid, splashDuration]);
  useLayoutEffect(() => {
    if (!myUid) return;
    // Run SYNCHRONOUSLY (useLayoutEffect) so the target screen/tab is set
    // before the pager layout effect reads it. This prevents the "bottom bar
    // shows one tab but content shows another" cold-start desync. The chosen
    // launch page (chats/status/groups/settings) is what opens.
    // If admin has hidden the launch page setting, always force Groups.
    const effectiveLaunchPage = globalSettings?.hideLaunchPage ? "groups" : launchPage;
    const targetTab = orderedTabs.includes(effectiveLaunchPage) ? effectiveLaunchPage : "chats";
    navigateToTab(targetTab);
    // Defensive: force the pager row to the target page imperatively (list tabs
    // only — status/settings aren't pager pages).
    const row = pagerRowRef.current;
    if (row && targetTab !== "status" && targetTab !== "settings") {
      const idx = Math.max(0, orderedTabs.indexOf(targetTab));
      row.style.transition = "none";
      row.style.transform = `translateX(${-idx * 100}%)`;
    }
    setColdStartComplete(true);
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
    return; // disabled: flex layout removed the compositor race this watchdog worked around
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
              // Force a layout/reflow to nudge the compositor into repainting.
              // IMPORTANT: we must NOT touch `transform` here. Toggling a
              // transform on the shell creates a containing block for any fixed
              // descendants, and on older Android WebViews (Android 11 /
              // Duoqin F21 Pro) that permanently mis-positions them — which is
              // exactly the "bottom bar disappears / taps get eaten" cold-start
              // bug. A padding nudge + forced reflow repaints without that risk.
              if (!/0\.1px/.test(shellEl.style.paddingBottom || "")) {
                const prevPad = shellEl.style.paddingBottom;
                shellEl.style.paddingBottom = "calc(var(--safe-bottom) + 0.1px)";
                void shellEl.offsetHeight;
                shellEl.style.paddingBottom = prevPad;
              } else {
                void shellEl.offsetHeight;
              }
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
        } else if (wantBar) {
          // Deterministic cold-start recomposite. The barOnTop() DOM probe can
          // false-positive on some WebViews (it reports the bar is on top when
          // it is actually painted behind the pages), which previously left the
          // bar dead / misaligned until the user manually navigated. So we
          // ALWAYS force an invisible repaint + a bar remount on cold start —
          // that guarantees the first interactive frame has a working, correctly
          // positioned bottom bar instead of relying on the probe.
          forceRepaint();
          await delay(60);
          forceRepaint();
          if (!cancelled) setBarEpoch((n) => n + 1);
          diag = `DIAG awake bar-recomposited screen=${screenRef.current} tabOk=${onTab} wantBar=${wantBar} raf=alive`;
        } else {
          diag = `DIAG awake ok screen=${screenRef.current} tabOk=${onTab} wantBar=${wantBar} barHit=${barOK} raf=alive`;
        }
      } catch (err) {
        diag = `DIAG awake-error ${err?.message || err}`;
      }
      try { window.__nxCapturedErrors.push(diag); } catch { /* best-effort */ }
      // Release the splash so it fades normally — any recovery above already
      // ran under the opaque repair cover (or behind the still-held splash),
      // so nothing ever flashes. Respect the user's splash duration: don't
      // release until at least splashDuration has elapsed since the splash
      // was shown (the auth-screen timer is the real authority, this just
      // waits for it so the repair never cuts the splash short).
      const elapsed = Date.now() - splashStartRef.current;
      const wait = Math.max(0, splashDuration * 1000 - elapsed);
      setTimeout(() => setSplashHold(false), wait);
      // Force a fresh bar remount the moment the splash is
      // released. On Android WebViews with a stuck compositor, the bar's
      // `key={barEpoch}` might not re-attach to the new frame until the React
      // tree repaints — bumping it here is the most reliable way to make the
      // bar appear the instant the splash lets go of pointer events.
      setBarEpoch((n) => n + 1);
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
    setNotificationTapHandler((chatId) => {
      // Route directly into the conversation. This works from ANY screen
      // (including Settings) so a notification tap while the app is already open
      // always brings the user to the chat. If the chat list hasn't loaded yet
      // (cold start), buffer it via pendingNotifChatId for the watcher below.
      const chat = (myChatsRef.current || []).find((c) => c.id === chatId);
      if (chat) {
        const otherUid = (chat.participants || []).find((p) => p !== myUidRef.current);
        openChatRef.current(chat, otherUid, (contactsRef.current || []).find((c) => c.uid === otherUid));
      } else {
        setPendingNotifChatId(chatId);
      }
    });
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
  // Badge count mode: "chats" = number of chats that have unread messages
  // (WhatsApp-style), "messages" = total unread message count. User toggles in
  // Settings (nextext_badge_mode).
  const [badgeMode, setBadgeMode] = useState(() => localStorage.getItem("nextext_badge_mode") || "chats");
  const unreadChatCount = (myChats || []).filter((c) => (c.unreadCount?.[myUid] || 0) > 0).length;
  const totalUnreadChats = badgeMode === "messages"
    ? (myChats || []).reduce((sum, c) => sum + (c.unreadCount?.[myUid] || 0), 0)
    : unreadChatCount;
  const contactUids = (contacts || []).filter((c) => c.status === "accepted").map((c) => c.uid);
  const allStatusUids = [myUid, ...contactUids];
  const allStatuses = useStatuses(myUid ? allStatusUids : []);

  // Device "Share to NexText" receiver. When another app shares text/media to
  // NexText, the native layer stores it (and fires `nextextShare`); we surface a
  // chooser to post it to Status or send it to a contact.
  const [sharePayload, setSharePayload] = useState(null);
  const [shareText, setShareText] = useState("");
  useEffect(() => {
    const consume = (detail) => {
      try {
        const data = typeof detail === "string" ? JSON.parse(detail) : detail;
        if (!data) return;
        const text = [data.subject, data.text].filter(Boolean).join("\n\n");
        setShareText(text);
        setSharePayload(data);
      } catch { /* ignore malformed payload */ }
    };
    try {
      const pending = window.NexTextNativeBridge?.getPendingShare?.();
      if (pending) { consume(pending); window.NexTextNativeBridge.clearPendingShare(); }
    } catch { /* no native bridge */ }
    const onEvt = (e) => consume(e.detail);
    window.addEventListener("nextextShare", onEvt);
    return () => window.removeEventListener("nextextShare", onEvt);
  }, []);
  const sendShareToContact = (uid, contact) => {
    try { window.__nextextComposePrefill = shareText; } catch { /* best-effort */ }
    setSharePayload(null);
    openChat(null, uid, contact);
  };
  const shareToStatus = () => {
    try { window.__nextextStatusPrefill = { text: shareText, uris: (sharePayload?.uris) || [] }; } catch { /* best-effort */ }
    setSharePayload(null);
    setScreen("status");
  };

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
        if (change.type === "removed") {
          // Tear down the per-chat message listener so it doesn't leak after a
          // chat is deleted/left.
          const idx = unsubs.findIndex((u) => u.chatId === chatId);
          if (idx !== -1) { try { unsubs[idx].unsub(); } catch {} unsubs.splice(idx, 1); }
          delete chatDataMap[chatId];
          return;
        }
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
            // Per-user vibration/ping override: a contact can carry notifVibrate
            // / notifSound keys that override the global Settings choice.
            let vibrationPattern;
            let sound;
            const otherContact = (contacts || []).find((c) => c.uid === m.senderId);
            try {
              if (otherContact?.notifVibrate) {
                if (otherContact.notifVibrate === "custom") {
                  try { vibrationPattern = JSON.parse(localStorage.getItem("nextext_notif_vibration_custom")); } catch {}
                } else {
                  vibrationPattern = VIBRATION_PRESETS[otherContact.notifVibrate];
                }
              }
              if (otherContact?.notifSound) sound = otherContact.notifSound;
            } catch {}
            if (privateNotif) {
              showLocalNotification("New message", "You have a new message", chatId, {
                chatId,
                senderName: "",
                groupName: "",
                messageText: "",
                private: true,
                vibrationPattern,
                sound,
                dark: getNotifDark(),
              });
            } else {
              const senderColor = (otherContact?.profile?.avatarColor || otherContact?.profile?.color || otherContact?.avatarColor || otherContact?.color || "#7C5CFF");
              const imageUrl = otherContact?.profile?.photoURL || otherContact?.photoURL || otherContact?.profilePic || "";
              showLocalNotification(chatName, body.length > 60 ? body.slice(0, 60) + "…" : body, chatId, {
                chatId,
                senderName,
                groupName: isGroup ? chatName : "",
                messageText: body,
                private: false,
                vibrationPattern,
                sound,
                senderColor,
                imageUrl,
                dark: getNotifDark(),
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
    // Hard kill: even if a stalled WebView swallows the transition-end event
    // and the dismiss timer never fires, force-unmount after 2 seconds so the
    // overlay can never stay click-blocking indefinitely.
    const fadeTimer = setTimeout(() => setSplashFading(true), 200);
    const dismissTimer = setTimeout(() => { setSplashVisible(false); }, 900);
    const hardKillTimer = setTimeout(() => { setSplashVisible(false); }, 2000);
    return () => { clearTimeout(fadeTimer); clearTimeout(dismissTimer); clearTimeout(hardKillTimer); };
  }, [showSplash, splashHold]);

  // Absolute safety net: any time the user is actively on a real screen (list /
  // status / settings / chat / etc.) and the splash overlay is still mounted,
  // unmount it. This catches every edge case where the timer-based dismissal
  // failed (backgrounded app, slow WebView, transition-end dropped) and would
  // otherwise leave a click-blocking overlay on top of the chat list AND bottom
  // nav — the reported "everything is dead until I tap Settings" bug.
  useEffect(() => {
    if (!splashVisible) return;
    // Safety net: only force-hide if the splash somehow outlives its intended
    // duration by a comfortable margin. Previously this fired at a hard 2.5s,
    // which clipped the user-configured splash duration (1–8s) down to 2.5s.
    const safetyMs = Math.max(5000, splashDuration * 1000 + 2500);
    const t = setTimeout(() => {
      if (splashVisible) setSplashVisible(false);
    }, safetyMs);
    return () => clearTimeout(t);
  }, [splashVisible, screen, splashDuration]);

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
  // Apply UI scale. On mobile we scale NATIVELY via the viewport meta `width`
  // (browser scales the whole page → touch hit-testing + position:fixed stay
  // correct; CSS `zoom` breaks taps on the F21 Pro WebView). On desktop we keep
  // the responsive layout and apply any extra zoom with CSS `zoom` (safe there).
  useEffect(() => {
    const meta = document.getElementById("nx-viewport");
    if (!meta) return;
    if (isMobile) {
      meta.setAttribute("content", `width=${Math.round(390 / uiScale)}, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover`);
    } else {
      meta.setAttribute("content", "width=device-width, initial-scale=1.0, viewport-fit=cover");
    }
  }, [uiScale, isMobile]);
  useEffect(() => { localStorage.setItem("nextext_recording_bar_scale", String(recordingBarScale)); }, [recordingBarScale]);
  useEffect(() => { localStorage.setItem(SCROLL_DOWN_KEY, String(showScrollDown)); }, [showScrollDown]);
  useEffect(() => { localStorage.setItem("nextext_animate_on_tap", String(animateOnTap)); }, [animateOnTap]);
  useEffect(() => { localStorage.setItem("nextext_swipe_animation", swipeAnimationOn ? "on" : "off"); }, [swipeAnimationOn]);
  useEffect(() => { localStorage.setItem("nextext_swipe_speed", swipeSpeed); }, [swipeSpeed]);
  useEffect(() => { localStorage.setItem("nextext_swipe_bounce", swipeBounce ? "on" : "off"); }, [swipeBounce]);
  useEffect(() => { localStorage.setItem("nextext_nav_config_locked", String(navConfigLocked)); }, [navConfigLocked]);
  // The "Edge swipe bounce" setting also controls the iOS-style rubber-band
  // effect on vertical scroll overscroll (when you reach the top or bottom
  // of any scrollable area and keep dragging). Same UX concept, one toggle.
  useEffect(() => {
    try {
      if (swipeBounce) document.body.classList.remove("nextext-no-bounce");
      else document.body.classList.add("nextext-no-bounce");
    } catch { /* body may not be ready in some embeds */ }
  }, [swipeBounce]);
  useEffect(() => { localStorage.setItem("nextext_scroll_down_size", String(scrollDownSize)); }, [scrollDownSize]);
  useEffect(() => { localStorage.setItem("nextext_scroll_down_pos", scrollDownPos); }, [scrollDownPos]);
  useEffect(() => { localStorage.setItem("nextext_search_bar_scale", String(searchBarScale)); }, [searchBarScale]);
  useEffect(() => { localStorage.setItem("nextext_emoji_animations", emojiAnimations ? "on" : "off"); }, [emojiAnimations]);
  useEffect(() => { localStorage.setItem("nextext_emoji_big", emojiBigOn ? "on" : "off"); }, [emojiBigOn]);

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
      // Android hardware Back: navigate within the app. Pop the current screen
      // (and any trailing duplicates) off the history; if a distinct previous
      // screen exists, go there, otherwise let the OS close the app.
      let backListener = null;
      const onBack = () => {
        // If a status builder / camera sheet is open, let it handle the back
        // press instead of popping the navigation stack. The status screen
        // exposes `__nextextStatusBuilderOpen` and listens for `nextextCloseStatusBuilder`.
        try {
          if (window.__nextextStatusBuilderOpen) {
            window.dispatchEvent(new CustomEvent("nextextCloseStatusBuilder"));
            return;
          }
        } catch {}
        const cur = screenRef.current;
        const hist = navHistoryRef.current;
        while (hist.length && hist[hist.length - 1] === cur) hist.pop();
        const prev = hist.pop();
        if (!prev || prev === cur) { CapApp.exitApp(); return; }
        setScreen(prev);
      };
      CapApp.addListener("backButton", onBack).then((l) => { backListener = l; }).catch(() => {});
      return () => {
        document.removeEventListener("visibilitychange", relock);
        capListener?.remove();
        backListener?.remove();
      };
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
      const directChatId = otherUid === AI_CONTACT_UID ? `ai_${myUid}` : [myUid, otherUid].sort().join("_");
      resolvedChatDoc = (myChats || []).find((c) => c.id === directChatId) || null;
    }
    let chatId = resolvedChatDoc?.id;
    if (!chatId && otherUid && myUid) {
      chatId = otherUid === AI_CONTACT_UID ? `ai_${myUid}` : [myUid, otherUid].sort().join("_");
    }
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

  // Ref mirrors of chats/contacts/openChat. Declared HERE (after those values are
  // defined) so the dependency arrays don't hit a Temporal Dead Zone error. The
  // mount-only notification tap handler reads these to route into a conversation
  // even when the user is on a non-chat screen (Settings, etc.).
  const myChatsRef = useRef(null);
  useEffect(() => { myChatsRef.current = myChats; }, [myChats]);
  const contactsRef = useRef(null);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);
  const openChatRef = useRef(null);
  useEffect(() => { openChatRef.current = openChat; }, [openChat]);

  // Route into a chat when the user taps a notification (or a background
  // payload arrived while the app was closed). Waits for the chat list to load
  // on cold start, then drops the request if the chat can't be found.
  // On cold start, we don't auto-open the chat until coldStartComplete is true
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
  const orderedTabs = getEffectiveTabs(navConfig, userRestrictions, topBarVisible);

  const currentTabKey = screen === "status" ? "status"
    : screen === "settings" ? "settings"
    : screen === "list" ? activeNavTab
    : null;
  const currentTabIndex = currentTabKey ? Math.max(0, orderedTabs.indexOf(currentTabKey)) : -1;
  // Single source of truth for which page is visible. Chats on the list screen
  // is ALWAYS index 0; otherwise it's the active tab's index (or the last
  // resting pageIndex when on a non-tab screen). Both the page render and the
  // boot diag read this, so they can never disagree.
  // SINGLE SOURCE OF TRUTH for the visible page: derive the pager position
  // directly from the active tab/screen. We deliberately ignore `pageIndex`
  // here so the pager can NEVER disagree with the bottom bar (the old
  // "page shows Groups but bar shows Chats" cold-start desync). `pageIndex`
  // still exists as a mirror for diagnostics/transitions but no longer drives
  // what is painted.
  const chatsIndex = orderedTabs.indexOf("chats");
  const visibleTabKey = screen === "status" ? "status" : screen === "settings" ? "settings" : screen === "list" ? (activeNavTab || "chats") : null;
  const effectiveIndex = visibleTabKey ? Math.max(0, orderedTabs.indexOf(visibleTabKey)) : (chatsIndex >= 0 ? chatsIndex : 0);

// BULLETPROOF pager position: after every render where the active tab (or
  // tab order) changes, imperatively force the row's transform to match
  // effectiveIndex. The row is now 100% wide with absolute pages at 0%, 100%, etc.
  // so translateX(-index * 100%) is stable and works on first paint.
  const orderedTabsKey = orderedTabs.join(",");
  useLayoutEffect(() => {
    if (pagerRowRef.current && !pagerDragRef.current?.active) {
      pagerRowRef.current.style.transform = `translateX(${-effectiveIndex * 100}%)`;
    }
    // Force the root scroll back to 0 — a stray document.scrollLeft offsets the
    // whole pager (every absolutely-positioned page shifts by that amount).
    try {
      if (document.documentElement.scrollLeft !== 0) document.documentElement.scrollLeft = 0;
      if (document.body.scrollLeft !== 0) document.body.scrollLeft = 0;
    } catch {}
    // Ground-truth readout of where each page actually sits on screen, so a
    // desync between the virtual tab index and the painted layout is visible.
    try {
      const parts = orderedTabs.map((key) => {
        const el = pageRefs.current?.[key];
        const x = el ? Math.round(el.getBoundingClientRect().left) : "?";
        return `${key}@${x}`;
      });
      let shellX = "?", containerX = "?", rootX = "?", docScroll = "?", pageT = "?", rowT = "?";
      try { shellX = shellRef.current ? Math.round(shellRef.current.getBoundingClientRect().left) : "?"; } catch {}
      try { containerX = pagerContainerRef.current ? Math.round(pagerContainerRef.current.getBoundingClientRect().left) : "?"; } catch {}
      try { const r = document.getElementById("root"); rootX = r ? Math.round(r.getBoundingClientRect().left) : "?"; } catch {}
      try { docScroll = `${document.documentElement.scrollLeft}|${document.body.scrollLeft}`; } catch {}
      try { const el = pageRefs.current?.[orderedTabs[0]]; pageT = el ? getComputedStyle(el).transform : "?"; } catch {}
      try { rowT = pagerRowRef.current ? getComputedStyle(pagerRowRef.current).transform : "?"; } catch {}
      const meta = document.querySelector('meta[name="viewport"]');
      const metaW = meta ? meta.getAttribute("content") : "?";
      setPagerDebug(`ei=${effectiveIndex} pi=${pageIndex} cti=${currentTabIndex} | ${parts.join("  ")} | shell@${shellX} cont@${containerX} root@${rootX} scroll@${docScroll} pageT=${pageT} rowT=${rowT} iw=${window.innerWidth} meta=${metaW}`);
    } catch {}
  }, [effectiveIndex, orderedTabsKey, pageIndex, currentTabIndex]);

  // Sync the pager position whenever the active tab changes via bottom bar,
  // top-bar buttons, or programmatic navigation (e.g. opening a status).
  // All tabs stay mounted as direct shell children (positioned via `left`),
  // so a failed mount can never silently blank the pages.
  //
  // IMPORTANT: the resting page position rendered below is ALWAYS derived from
  // `currentTabIndex` (computed from screen + activeNavTab) — `pageIndex` is
  // only a transient anchor used mid-drag. Keeping the two in lockstep here
  // means the visible page can NEVER disagree with the active tab, which is
  // what produced the "bar says Chats but Groups is shown / taps open the
  // wrong page" cold-start desync. We do NOT gate this behind a one-time ref:
  // if it ever stops running the visible page would silently drift.
  useEffect(() => {
    if (currentTabIndex === -1) return;
    if (!pagerDragRef.current?.active) setPageIndex(currentTabIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTabKey, screen, orderedTabs.join(",")]);

  // Absolute guarantee: on the list screen with Chats active, pageIndex points
  // at the Chats page. Chats is NOT always index 0 (the user can reorder the
  // bottom bar), so resolve its real index instead of hardcoding 0 — otherwise
  // a launch-page of "Chats" would snap to whatever tab is actually at index 0
  // (e.g. Groups) while the bottom bar highlighted Chats.
  useEffect(() => {
    if (screen === "list" && activeNavTab === "chats" && !pagerDragRef.current?.active) {
      const chatsIdx = orderedTabs.indexOf("chats");
      if (chatsIdx >= 0) setPageIndex(chatsIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, activeNavTab, orderedTabs.join(",")]);

  // Cold-start pager lock: on first orderedTabs population, force the Chats
  // tab + snap pageIndex to it. Runs once per session via a ref so later
  // navConfig changes (e.g. restrictions loading) don't yank the user off
  // whatever tab they're on.
    const coldStartPagerLockRef = useRef(false);
  useEffect(() => {
    if (!myUid) return;
    if (orderedTabs.length === 0) return;
    if (coldStartPagerLockRef.current) return;
    coldStartPagerLockRef.current = true;
    const effectiveLaunchPage = globalSettings?.hideLaunchPage ? "groups" : launchPage;
    navigateToTab(orderedTabs.includes(effectiveLaunchPage) ? effectiveLaunchPage : "chats");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedTabs.join(","), myUid, globalSettings?.hideLaunchPage]);

  const navigateToTab = (key) => {
    if (key === "status") { setStatusOrigin("status"); setScreen("status"); return; }
    if (key === "settings") { setScreen("settings"); return; }
    const idx = orderedTabs.indexOf(key);
    if (idx === -1) return;
    setPageIndex(idx);
    setActiveNavTab(key);
    setScreen("list");
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
      startIndex: effectiveIndex,
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
    // Premium "bounce" feel: when the swipe hits an edge with swipeBounce on,
    // pull the page a bit further past the edge (the iOS rubber-band effect)
    // and cap so it doesn't fly off-screen. With swipeBounce off we apply
    // simple edge resistance (35% of input) so the page never moves much.
    if (swipeBounce) {
      if (drag.startIndex === 0 && offset > 0) offset = Math.min(offset * 0.55, 110);
      if (drag.startIndex === len - 1 && offset < 0) offset = Math.max(offset * 0.55, -110);
    } else {
      if (drag.startIndex === 0 && offset > 0) offset *= 0.35;
      if (drag.startIndex === len - 1 && offset < 0) offset *= 0.35;
    }
    drag.offset = offset;
    // Visual overscroll glow bubble: when the swipe is pulled past the first or
    // last tab (and the Overscroll bounce setting is on), fade in a rounded
    // glow at that edge. Driven directly via the DOM node (not React state) so
    // it doesn't trigger a pager re-render on every touchmove.
    if (glowRef.current) {
      let edge = null;
      let amt = 0;
      if (swipeBounce) {
        if (drag.startIndex === 0 && offset > 0) { edge = "start"; amt = offset; }
        else if (drag.startIndex === len - 1 && offset < 0) { edge = "end"; amt = -offset; }
      }
      const g = glowRef.current;
      if (edge && amt > 0.5) {
        const intensity = Math.min(amt / 110, 1);
        g.style.opacity = String(0.15 + intensity * 0.85);
        if (edge === "start") {
          g.style.left = `${4 + amt * 0.25}px`;
          g.style.right = "auto";
        } else {
          g.style.right = `${4 + amt * 0.25}px`;
          g.style.left = "auto";
        }
      } else {
        g.style.opacity = "0";
      }
    }
    // Drive the row transform directly (absolute carousel). translateX is a mix of
    // the resting percentage for the start index plus the live pixel offset
    // converted to percentage.
    if (pagerRowRef.current) {
      const container = pagerContainerRef.current;
      const containerWidth = container ? container.offsetWidth : 0;
      const basePct = -drag.startIndex * 100;
      const offsetPct = containerWidth > 0 ? (offset / containerWidth) * 100 : 0;
      pagerRowRef.current.style.transition = "none";
      pagerRowRef.current.style.transform = `translateX(${basePct + offsetPct}%)`;
    }
    if (e.cancelable) e.preventDefault();
  };

  const pagerTouchEnd = () => {
    const drag = pagerDragRef.current;
    if (!drag || !drag.active) { pagerDragRef.current = null; if (glowRef.current) glowRef.current.style.opacity = "0"; return; }
    pagerDragRef.current = null;
    if (glowRef.current) glowRef.current.style.opacity = "0";
    const len = orderedTabs.length;
    const threshold = drag.width * 0.2;
    let target = drag.startIndex;
    if (drag.offset < -threshold || drag.velocity < -0.4) target = Math.min(drag.startIndex + 1, len - 1);
    else if (drag.offset > threshold || drag.velocity > 0.4) target = Math.max(drag.startIndex - 1, 0);
    // ALWAYS snap every page to its resting position for `target` — both when
    // switching tabs and when the release stays on the current tab. Without
    // the same-page case, a partial swipe left the pages stranded at their
    // mid-drag offset (the "page just moves and stays in an awkward position"
    // bug) because the commit block below was skipped entirely.
    const dur = swipeAnimationEnabled() ? swipeDuration() * 1000 : 0;
    const trans = swipeAnimationEnabled() ? `transform ${swipeDuration()}s ${swipeBezier()}` : "none";
    if (pagerRowRef.current) {
      pagerRowRef.current.style.transition = trans;
      pagerRowRef.current.style.transform = `translateX(${-target * 100}%)`;
    }
    // Always sync pageIndex so React-owned positions match the visual snap.
    // This ensures a re-render never overwrites the snapped-back position.
    setSnapAnimating(true);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => setSnapAnimating(false), dur || 1);
    setPageIndex(target);
    if (target !== drag.startIndex) {
      const key = orderedTabs[target];
      if (key === "status") { setStatusOrigin("status"); setScreen("status"); }
      else if (key === "settings") setScreen("settings");
      else { setActiveNavTab(key); setScreen("list"); }
    }
    setPagerDragging(false);
  };

  const pagerTouchCancel = () => {
    const drag = pagerDragRef.current;
    pagerDragRef.current = null;
    if (glowRef.current) glowRef.current.style.opacity = "0";
      if (drag?.active) {
        // Cancel: restore the row to its React-owned position (no nav change).
        if (pagerRowRef.current) {
          pagerRowRef.current.style.transition = "";
          pagerRowRef.current.style.transform = `translateX(${-effectiveIndex * 100}%)`;
        }
        setPagerDragging(false);
      }
  };

  // Safety net for dropped touch-end events. On some WebViews (notably the
  // F21 Pro) a touchend that lands outside the 390px app shell — or that the
  // browser simply fails to deliver — never reaches the shell's onTouchEnd.
  // When that happens pagerDragRef stays `active` and pageIndex freezes on the
  // drag's START tab, so the pager renders a stale page while the bottom bar
  // highlights the real tab ("starts on the wrong page / bar mixed up"). A
  // window-level listener guarantees the drag always completes (or cancels).
  const pagerEndRef = useRef(pagerTouchEnd);
  const pagerCancelRef = useRef(pagerTouchCancel);
  pagerEndRef.current = pagerTouchEnd;
  pagerCancelRef.current = pagerTouchCancel;
  useEffect(() => {
    const end = () => pagerEndRef.current();
    const cancel = () => pagerCancelRef.current();
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", cancel);
    window.addEventListener("pointerup", end);
    window.addEventListener("mouseup", end);
    return () => {
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", cancel);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("mouseup", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Robust full-viewport height. Native `100dvh` (the *visual* viewport, which
  // excludes the on-screen nav bar) is used where supported; on older WebViews
  // without dvh we fall back to the JS-measured visualViewport height (appHeight),
  // which is correct on the F21 Pro. The shell is a pure CSS flex column (below)
  // so the bottom bar is always a flex child pinned to the visual bottom — it can
  // never be pushed off-screen / behind the nav bar by a stale JS height the way
  // the old absolutely-positioned bar could (the root cause of the "bottom bar
  // missing / menus behind / Ask-AI not visible until a re-render" cold-start bug).
  const dvhSupported =
    typeof window !== "undefined" &&
    window.CSS &&
    typeof window.CSS.supports === "function" &&
    window.CSS.supports("height", "100dvh");
  const containerStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
    fontFamily: appFont,
    width: "100%",
    ...(dvhSupported ? { height: "100dvh" } : { height: appHeight > 0 ? `${appHeight}px` : "100%" }),
    paddingTop: "var(--safe-top)",
    // NOTE: no paddingBottom — the bottom bar is a flex child and manages its own
    // safe-area inset so it can sit flush against the visual bottom edge.
    // Desktop-only extra zoom: on mobile the viewport meta handles scaling
    // (CSS zoom breaks taps there), so skip it on phones.
    ...(uiScale !== 1 && !isMobile ? { zoom: uiScale } : {}),
    // Flex column: the pager grows to fill, the bottom bar is a fixed flex child.
    display: "flex",
    flexDirection: "column",
  };

  // Disguise gate runs BEFORE the auth/loading screen so a Calculator/Notes
  // launcher opens straight into the disguise — never flashing "Connecting to
  // server". The profile is read synchronously from native storage, so this is
  // correct on the very first paint.

  // Admin "force logout everyone except admins" switch. When the global flag
  // (config/globalSettings.forceLogoutNonAdmins) is on, every non-admin client
  // signs itself out so the user must log back in. Placed with the other hooks
  // ABOVE every early return below — otherwise the loading/early-return render
  // would skip this hook and the loaded render would run it, changing the hook
  // count between renders and throwing React #310.
  useEffect(() => {
    if (!myUid) return;
    const admin = auth.userDoc?.role === "admin" || auth.userDoc?.isAdmin === true;
    if (globalSettings?.forceLogoutNonAdmins === true && !admin) {
      try { auth.logOut(); } catch {}
    }
  }, [globalSettings?.forceLogoutNonAdmins, auth.userDoc, myUid]);

  // When the admin forces the Notepad disguise, push the unlock keyword to every
  // client and switch everyone's launcher icon to the Notes disguise so the
  // app presents as a notepad from the home screen. setActiveProfile triggers a
  // native setAppIcon which KILLS the process — so only call it when the icon
  // isn't already the notepad profile, otherwise we'd kill→relaunch→kill in a loop.
  useEffect(() => {
    if (globalSettings?.forceNotepadDisguise) {
      try { setNotepadKeyword(globalSettings.notepadDisguiseKeyword || "Rosh"); } catch {}
      if (iconProfileId !== "icon7") {
        try { setActiveProfile("icon7"); } catch {}
      }
    }
  }, [globalSettings?.forceNotepadDisguise, globalSettings?.notepadDisguiseKeyword, iconProfileId]);

  if (disguiseKind === "calculator" && !disguiseUnlocked) {
    return (
      <CalculatorScreen
        onUnlock={() => setDisguiseUnlocked(true)}
      />
    );
  }
  if (disguiseKind === "notes" && !disguiseUnlocked) {
    return (
      <NotepadScreen
        onUnlock={() => setDisguiseUnlocked(true)}
      />
    );
  }

  const testConnection = async () => {
    try {
      const t0 = Date.now();
      await fetch("https://www.gstatic.com/generate_204", { mode: "no-cors", cache: "no-store" });
      alert("Connection OK (" + (Date.now() - t0) + "ms)");
    } catch (e) {
      alert("Connection FAILED: " + ((e && e.message) || e));
    }
  };

  const hangBannerEl = hangBanner ? (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999999, background: "#1a1a1a", borderTop: "2px solid #FF3B30", padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 13, boxSizing: "border-box" }}>
      <span style={{ flex: 1, minWidth: 0 }}>⚠ Having trouble connecting. Retrying…</span>
      <button onClick={testConnection} style={{ flexShrink: 0, padding: "7px 10px", border: "none", borderRadius: 8, background: "#10B981", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Test</button>
      <button onClick={() => window.location.reload()} style={{ flexShrink: 0, padding: "7px 10px", border: "none", borderRadius: 8, background: "rgba(255,255,255,0.2)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Retry</button>
      <span onClick={() => setHangBanner(false)} style={{ flexShrink: 0, cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</span>
    </div>
  ) : null;

  if (auth.loading && showSplash) {
    return <div style={{ ...containerStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0B141A" }}>
      <img src={activeProfile.iconPath} alt="" style={{ width: 100, height: 100, objectFit: "contain", marginBottom: 20 }} onError={(e) => { e.target.style.display = "none"; }} />
      <div style={{ width: 40, height: 40, border: "4px solid rgba(16, 185, 129, 0.25)", borderTopColor: "#10B981", borderRadius: "50%", animation: "nextext-spin 0.9s linear infinite", marginBottom: 16 }} />
      <span style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>{activeProfile.label}</span>
      {activeProfile?.special && (
        <div className="nx-splash-words" style={{ marginTop: 18, maxWidth: 300, padding: "0 16px", textAlign: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#10B981", lineHeight: 1.4, animation: "nx-splash-pop 0.5s ease-out both" }}>{globalSettings?.specialIconSplashLine1 || "If you will not use this app...."}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.8)", marginTop: 8, lineHeight: 1.4, animation: "nx-splash-pop 0.5s ease-out 0.25s both" }}>{globalSettings?.specialIconSplashLine2 || "You will go to ....."}</div>
        </div>
      )}
      <style>{`@keyframes nextext-spin { to { transform: rotate(360deg); } }
        @keyframes nx-splash-pop { 0% { opacity: 0; transform: translateY(10px) scale(0.92); } 60% { opacity: 1; transform: translateY(-2px) scale(1.02); } 100% { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
      {hangBannerEl}
    </div>;
  }
  if (auth.loading) {
    return <div style={{ ...containerStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0B141A" }}>
      <div style={{ width: 40, height: 40, border: "4px solid rgba(16, 185, 129, 0.25)", borderTopColor: "#10B981", borderRadius: "50%", animation: "nextext-spin 0.9s linear infinite", marginBottom: 16 }} />
      <span style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>{activeProfile?.label || "NexText"}</span>
      {hangBannerEl}
    </div>;
  }
  if (!auth.user) {
    return <div style={containerStyle}><AuthScreen auth={auth} /></div>;
  }
  if (auth.userDoc?.profileComplete === false) {
    return <div style={containerStyle}><CompleteProfileScreen auth={auth} /></div>;
  }
  const isAdmin = auth.userDoc?.role === "admin" || auth.userDoc?.isAdmin === true;

  const shellClass = ["nextext-app-shell"];
  if (darkLettering) shellClass.push("dark-lettering");
  if (actualDarkTheme) shellClass.push("actual-dark-theme");
  if (moreRounded) shellClass.push("nx-rounded");

  return (
    <>
    <QuotaBanner />
    <div
      ref={shellRef}
      id="nextext-app-shell"
      className={shellClass.join(" ")}
      style={{ ...containerStyle }}
      onTouchStart={pagerTouchStart}
      onTouchMove={pagerTouchMove}
      onTouchEnd={pagerTouchEnd}
      onTouchCancel={pagerTouchCancel}
    >
         <div ref={pagerContainerRef} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
           {/* Overscroll glow bubble — fades in at the first/last tab edge while
               swiping with the "Overscroll bounce" setting on. Positioned/sized
               imperatively from pagerTouchMove via glowRef. */}
           <div
             ref={glowRef}
             style={{
               position: "absolute",
               top: "50%",
               transform: "translateY(-50%)",
               width: 64,
               height: 130,
               borderRadius: 32,
               pointerEvents: "none",
               opacity: 0,
               zIndex: 5,
               background: "radial-gradient(circle, rgba(124,92,255,0.55) 0%, rgba(124,92,255,0.18) 45%, rgba(124,92,255,0) 72%)",
             }}
            />
<div
                ref={pagerRowRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  willChange: "transform",
                  transform: `translateX(${-effectiveIndex * 100}%)`,
                  touchAction: "pan-y",
                  WebkitOverflowScrolling: "touch",
                  transition: pagerDragging
                    ? "none"
                    : snapAnimating
                      ? (swipeAnimationEnabled() ? `transform ${swipeDuration()}s ${swipeBezier()}` : "none")
                      : tapTransition(),
                }}
              >
              {orderedTabs.map((key, idx) => {
              const pageStyle = {
                position: "absolute",
                top: 0,
                left: `${idx * 100}%`,
                width: "100%",
                height: "100%",
                overflow: "hidden",
              };
          const pageRef = (el) => { pageRefs.current[key] = el; };
          if (key === "chats") return (
            <div key="chats" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Chats">
                <ChatListScreen myUid={myUid} userDoc={liveUserDoc || auth.userDoc} onOpenChat={openChat} onOpenGroupInfo={openGroupInfo} onOpenSettings={() => setScreen("settings")} hideNav={hideNav} navTab="chats" compactList={compactList} searchMode={searchMode} topBarVisible={topBarVisible} searchBarScale={searchBarScale} isActiveTab={activeNavTab === "chats"} onOpenAI={() => setScreen("aiChat")} showAIWidget={true} />
              </PageErrorBoundary>
            </div>
          );
          if (key === "groups") return (
            <div key="groups" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Groups">
                <ChatListScreen myUid={myUid} userDoc={liveUserDoc || auth.userDoc} onOpenChat={openChat} onOpenGroupInfo={openGroupInfo} onOpenSettings={() => setScreen("settings")} hideNav={hideNav} navTab="groups" compactList={compactList} searchMode={searchMode} topBarVisible={topBarVisible} searchBarScale={searchBarScale} isActiveTab={activeNavTab === "groups"} />
              </PageErrorBoundary>
            </div>
          );
          if (key === "status") return (
            <div key="status" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Status">
                <StatusScreen myUid={myUid} myName={auth.userDoc?.displayName || auth.userDoc?.username} myPhoto={auth.userDoc?.photoURL} onBack={() => { setScreen("list"); setActiveNavTab("chats"); setStoryViewerOpen(false); }} onStoryViewerChange={setStoryViewerOpen} initialViewStatuses={initialViewStatuses} statusOrigin={statusOrigin} onConsumeInitialView={() => setInitialViewStatuses(null)} />
              </PageErrorBoundary>
            </div>
          );
          if (key === "settings") return (
            <div key="settings" ref={pageRef} style={pageStyle}>
              <PageErrorBoundary label="Settings">
               <SettingsScreen
                 auth={auth}
                 onLaunchPageSelect={(key) => { setLaunchPage(key); localStorage.setItem("nextext_launch_page", key); navigateToTab(key); }}
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
                contacts={contacts}
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
                swipeBounce={swipeBounce}
                setSwipeBounce={setSwipeBounce}
                navConfigLocked={navConfigLocked}
                setNavConfigLocked={setNavConfigLocked}
                scrollDownSize={scrollDownSize}
                setScrollDownSize={setScrollDownSize}
                scrollDownPos={scrollDownPos}
                setScrollDownPos={setScrollDownPos}
                onShowTour={startTour}
                searchBarScale={searchBarScale}
                setSearchBarScale={setSearchBarScale}
                setLiveUserDoc={setLiveUserDoc}
                pinchZoomOn={pinchZoomOn}
                setPinchZoomOn={setPinchZoomOn}
                voiceEndChimeOn={voiceEndChimeOn}
                setVoiceEndChimeOn={setVoiceEndChimeOn}
                voiceStreakChimeOn={voiceStreakChimeOn}
                setVoiceStreakChimeOn={setVoiceStreakChimeOn}
                emojiBigOn={emojiBigOn}
                setEmojiBigOn={setEmojiBigOn}
                pingSoundId={pingSoundId}
                setPingSoundId={setPingSoundId}
                voicePlayerStyle={voicePlayerStyle}
                setVoicePlayerStyle={setVoicePlayerStyle}
                autoUpdateCheckOn={autoUpdateCheckOn}
                setAutoUpdateCheckOn={setAutoUpdateCheckOn}
                 linkPreviewsOn={linkPreviewsOn}
                 setLinkPreviewsOn={setLinkPreviewsOn}
                 composerButtonOrder={composerButtonOrder}
                 setComposerButtonOrder={setComposerButtonOrder}
 launchPage={launchPage}
                setLaunchPage={setLaunchPage}
                onLaunchPageSelect={(key) => { setLaunchPage(key); localStorage.setItem("nextext_launch_page", key); navigateToTab(key); }}
 appGlobalSettings={globalSettings}
 darkLettering={darkLettering}
 setDarkLettering={setDarkLettering}
  actualDarkTheme={actualDarkTheme}
  setActualDarkTheme={setActualDarkTheme}
  splashDuration={splashDuration}
  setSplashDuration={applySplashDuration}
  pendingSplashDuration={pendingSplashDuration}
  setPendingSplashDuration={setPendingSplashDuration}
   moreRounded={moreRounded}
   setMoreRounded={setMoreRounded}
   voiceSpacing={voiceSpacing}
   setVoiceSpacing={setVoiceSpacing}
   setThemeKey={setThemeKey}
              />
              </PageErrorBoundary>
            </div>
          );
          return null;
        })}
            </div>
          </div>

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
          scrollDownSize={scrollDownSize}
          scrollDownPos={scrollDownPos}
          animatedScrollEntry={animatedScrollEntry}
          emojiAnimations={emojiAnimations}
          emojiBigOn={emojiBigOn}
          recordingBarScale={recordingBarScale}
          onOpenAskAI={setAskAIGlobal}
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
      {screen === "announcements" && <AnnouncementsScreen theme={t} onBack={() => setScreen("settings")} />}
      {screen === "admin" && isAdmin && <AdminDashboard myUid={myUid} onBack={() => setScreen("settings")} />}
      {screen === "iconPicker" && <IconPickerScreen onBack={() => setScreen("settings")} restrictions={auth.userDoc?.restrictions} isAdmin={isAdmin} myUid={myUid} />}
      {screen === "aiChat" && (
        <AIChatScreen myUid={myUid} onBack={() => setScreen("list")} />
      )}


        {showThemeSheet && (
          <ThemeSheet current={themeKey} onSelect={(k) => { setThemeKey(k); setShowThemeSheet(false); }} onClose={() => setShowThemeSheet(false)} />
        )}



      {!hideNav && !cameraOpen && !storyViewerOpen && (screen === "list" || screen === "status" || screen === "settings") && (() => {
        const ALL_TABS = {
          chats: { icon: MessageSquare, label: "Chats" },
          status: { icon: CircleDot, label: "Status" },
          groups: { icon: Users, label: "Groups" },
          settings: { icon: SettingsIcon, label: "Settings" },
        };
        const effectiveTabs = getEffectiveTabs(navConfig, userRestrictions, topBarVisible);
        const navTabs = effectiveTabs.map((key) => ({ key, ...ALL_TABS[key] }));
        if (!navTabs.length) return null;
        try {
              return (
              <div key={barEpoch} style={{ flexShrink: 0, margin: "0 auto", width: "100%", display: "flex", background: t.surface, borderTop: `1px solid ${t.border}`, zIndex: 1000, paddingBottom: "max(0px, calc(var(--safe-bottom)))" }}>
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
        } catch (e) {
          // If the bar ever throws (a bad config, a missing icon), never break
          // the rest of the app — fall back to a minimal Chats/Status/Settings
          // bar so the user can always navigate.
          console.error("[BottomBar fallback]", e);
          return (
            <div style={{ flexShrink: 0, margin: "0 auto", width: "100%", display: "flex", background: t.surface, borderTop: `1px solid ${t.border}`, zIndex: 1000, paddingBottom: "max(0px, calc(var(--safe-bottom)))" }}>
              {[["chats", "Chats"], ["status", "Status"], ["settings", "Settings"]].map(([key, label]) => (
                <div key={key} data-tour-nav={key} onClick={() => navigateToTab(key)} style={{ flex: 1, padding: "12px 0", textAlign: "center", color: t.text, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{label}</div>
              ))}
            </div>
          );
        }
      })()}

      {askAIGlobal && (
        <AskAIPanel
          myUid={auth.user?.uid}
          otherName={askAIGlobal.otherName}
          contextMessages={askAIGlobal.context}
          contacts={contacts}
          onClose={() => setAskAIGlobal(null)}
        />
      )}

      {createPortal((splashVisible && localStorage.getItem("nextext_splash_enabled") !== "off") && (
        <div
          onTransitionEnd={() => { if (splashFading) setSplashVisible(false); }}
          style={{
            position: "absolute", inset: 0, zIndex: 999999, background: "#121B22",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28,
            opacity: splashFading ? 0 : 1, transition: "opacity 0.6s ease-out",
            // Pointer-events MUST be "none" the moment fading starts. Previously
            // it stayed "auto" until the transition finished, which on a stuck
            // Android WebView compositor would block taps on the chat list AND
            // bottom nav for the full 600ms — leaving the user with an app
            // where nothing responds. Now: once the fade begins, every click
            // passes through, so even a stalled compositor can never trap input.
            pointerEvents: splashFading ? "none" : "auto",
            // A safety fallback so even if the React unmount never fires
            // (WebView pause / transition-end swallowed) the overlay doesn't
            // stay click-blocking forever. The 1s hard kill is below.
          }}
        >
           <img src={activeProfile.iconPath} alt="" style={{ width: 180, height: 180, objectFit: "contain" }} />
           <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginTop: -10, letterSpacing: 0.3 }}>{activeProfile.label}</div>
           <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.65)" }}>v{getCurrentVersion()}</div>
            {activeProfile?.special && (
              <div className="nx-splash-words" style={{ marginTop: 18, maxWidth: 300, fontSize: 19, padding: "0 16px", textAlign: "center" }}>
                <div style={{ fontWeight: 700, color: "#10B981", animation: "nx-splash-pop 0.5s ease-out both" }}>{globalSettings?.specialIconSplashLine1 || "If you will not use this app...."}</div>
                <div style={{ marginTop: 8, fontWeight: 600, color: "rgba(255,255,255,0.85)", animation: "nx-splash-pop 0.5s ease-out 0.25s both" }}>{globalSettings?.specialIconSplashLine2 || "You will go to ....."}</div>
              </div>
            )}
            <div
              style={{
                width: 34, height: 34,
                border: "3px solid rgba(16, 185, 129, 0.25)",
                borderTopColor: "#10B981",
                borderRadius: "50%",
              }}
            />
            <style>{`@keyframes nx-splash-pop { 0% { opacity: 0; transform: translateY(10px) scale(0.92); } 60% { opacity: 1; transform: translateY(-2px) scale(1.02); } 100% { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
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
        <div style={{ position: "absolute", inset: 0, zIndex: 999998, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28 }}>
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
      {/* DIAG log feature removed */}

      {sharePayload && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSharePayload(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, maxHeight: "85vh", background: t.surface, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", fontWeight: 700, fontSize: 16, color: t.text, borderBottom: `1px solid ${t.border}` }}>Share to NexText</div>
            <div style={{ padding: 14 }}>
              <textarea value={shareText} onChange={(e) => setShareText(e.target.value)} placeholder="Message…" style={{ width: "100%", minHeight: 80, resize: "none", borderRadius: 10, border: `1px solid ${t.border}`, padding: 10, fontSize: 14, color: t.text, boxSizing: "border-box", background: t.bg }} />
              {sharePayload.uris?.length > 0 && (
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 8 }}>{sharePayload.uris.length} attachment{sharePayload.uris.length > 1 ? "s" : ""} included</div>
              )}
            </div>
            <div style={{ padding: "0 14px 10px" }}>
              <button onClick={shareToStatus} style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 10 }}>Post to Status</button>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.textMuted, marginBottom: 6 }}>Send to chat</div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 14px 14px" }}>
              {(contacts || []).filter((c) => c.status === "accepted").map((c) => (
                <div key={c.uid} onClick={() => sendShareToContact(c.uid, c)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                  <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={36} />
                  <span style={{ fontSize: 14, color: t.text, fontWeight: 600 }}>{c.profile?.displayName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
    </>
  );
}

// Shows a non-blocking amber banner when Firestore is returning 429
// (resource-exhausted) for the global-config doc, so the app keeps working off
// cached settings instead of looking broken. Uses the store primitives directly
// (not a wrapper hook) to avoid the wrapper being tree-shaken.
function QuotaBanner() {
  const limited = useSyncExternalStore(subscribeGlobalSettings, getQuotaSnapshot, getQuotaSnapshot);
  if (!limited) return null;
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999998, background: "#B8860B", color: "#fff", padding: "8px 12px", fontSize: 12.5, fontWeight: 600, textAlign: "center", boxSizing: "border-box" }}>
      ⚠ Firebase free quota reached (too many requests). Showing cached data and retrying automatically — some settings may be temporarily out of date.
    </div>
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

