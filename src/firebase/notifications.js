import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from "./config";
import { doc, updateDoc, arrayRemove } from "firebase/firestore";
import { db } from "./config";
import { playChime, isChimeId } from "../utils/pingSounds";

const NextextNative = registerPlugin("NextextNative");

const VAPID_KEY = "BDPG3EWg1tJKh1nN_yOnWgK3BYJjQ-fpYTk1NQrGqU0EHTRZWMWhOUNyANHv52BnUvPBmZFK8ssfsOKWLtqJasA";

// Holds a chatId that arrived via a notification tap or background payload
// before the app was ready to route it, so it isn't lost on cold start.
let notificationTapHandler = null;
let pendingTapChatId = null;

// Same buffering for the "Mark as read" notification action: the native side
// holds the chatId until the web app is mounted and polls for it.
let markReadHandler = null;
let pendingMarkReadChatId = null;

// App registers a handler once; any chatId captured before that (cold start)
// is delivered immediately.
export function setNotificationTapHandler(handler) {
  notificationTapHandler = handler;
  if (pendingTapChatId) {
    const chatId = pendingTapChatId;
    pendingTapChatId = null;
    handler?.(chatId);
  }
}

// Registers the handler that fires when the user taps the notification's
// "Mark as read" action. Buffered chatIds from a cold start are delivered
// immediately (the user still wants the chat marked read).
export function setNotificationMarkReadHandler(handler) {
  markReadHandler = handler;
  if (pendingMarkReadChatId) {
    const chatId = pendingMarkReadChatId;
    pendingMarkReadChatId = null;
    handler?.(chatId);
  }
}

// Feeds a tapped-notification chatId into the routing mechanism. The handler
// may not be mounted yet (cold start), in which case it's buffered.
function routeNotificationTap(chatId) {
  if (!chatId) return;
  if (notificationTapHandler) notificationTapHandler(chatId);
  else pendingTapChatId = chatId;
}

// Feeds a "Mark as read" chatId into its handler (buffered on cold start).
function routeMarkRead(chatId) {
  if (!chatId) return;
  if (markReadHandler) markReadHandler(chatId);
  else pendingMarkReadChatId = chatId;
}

// Polls the native side for a chatId left behind by a notification tap that
// fired before the web app had any listeners (cold start). Calling this twice
// is harmless — the native side clears its stored value on read.
export async function pollPendingNotificationTap() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const res = await NextextNative.getPendingNotificationTap();
    const chatId = res?.chatId;
    if (chatId) routeNotificationTap(chatId);
    return chatId || null;
  } catch {
    return null;
  }
}

// Same as pollPendingNotificationTap but for the "Mark as read" action.
export async function pollPendingMarkRead() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const res = await NextextNative.getPendingMarkRead();
    const chatId = res?.chatId;
    if (chatId) routeMarkRead(chatId);
    return chatId || null;
  } catch {
    return null;
  }
}

export function triggerNotificationVibration() {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch {}
}

// Vibration presets the user can pick in Settings, plus a per-user override.
// NOTE: a `null` pattern means "no vibration" — the native layer and the JS
// helpers treat `null` (not an empty array) as the signal to stay silent.
// (An empty array `[]` is still "an array", so it would be passed to the
// native waveform call instead of being skipped, which is why "No vibration"
// used to buzz.) Keep `none` as `null`.
export const VIBRATION_PRESETS = {
  default: [200, 100, 200],
  short: [120, 60, 120],
  long: [300, 100, 300, 100, 300],
  heartbeat: [80, 60, 80, 60, 200],
  none: null,
};

// Ping (sound) options. "default" uses the system notification sound, "none"
// is silent, and ping1/ping2/ping3 are distinct tones played by the native
// bridge via ToneGenerator (no bundled audio assets required).
export const SOUND_OPTIONS = ["default", "none", "ping1", "ping2", "ping3"];

function readGlobalNotifPrefs() {
  try {
    const vibOn = localStorage.getItem("nextext_notif_vibrate_on") !== "false";
    const soundOn = localStorage.getItem("nextext_notif_sound_on") !== "false";
    const vibKey = localStorage.getItem("nextext_notif_vibration") || "default";
    const soundKey = localStorage.getItem("nextext_notif_sound") || "default";
    const custom = localStorage.getItem("nextext_notif_vibration_custom");
    let pattern = VIBRATION_PRESETS[vibKey];
    if (vibKey === "custom" && custom) {
      try { pattern = JSON.parse(custom); } catch { pattern = VIBRATION_PRESETS.default; }
    }
    if (!Array.isArray(pattern) && pattern !== null) pattern = VIBRATION_PRESETS.default;
    // Master switches: vibration off → no pattern; sound off → silent.
    if (!vibOn) pattern = null;
    const sound = soundOn ? soundKey : "none";
    const dark = localStorage.getItem("nextext_notif_dark") || "off";
    return { vibrationPattern: pattern, sound, dark };
  } catch {
    return { vibrationPattern: VIBRATION_PRESETS.default, sound: "default", dark: false };
  }
}

export function showLocalNotification(title, body, tag = "nextext-msg", info = {}) {
  const prefs = readGlobalNotifPrefs();
  // info.vibrationPattern / info.sound may be passed explicitly (e.g. a
  // per-user override resolved by the caller); fall back to global prefs.
  const vibrationPattern = info.vibrationPattern !== undefined ? info.vibrationPattern : prefs.vibrationPattern;
  const sound = info.sound !== undefined ? info.sound : prefs.sound;
  // Normalize the dark-mode flag into the two-valued string the native layer
  // understands: "actual" (full dark card) or "lettering" (dark text on a light
  // card). A legacy boolean `true` maps to "actual"; anything else is "off".
  const rawDark = info.dark !== undefined ? info.dark : prefs.dark;
  const dark = rawDark === true ? "actual" : (rawDark === "actual" || rawDark === "lettering" ? rawDark : "off");
  const senderColor = info.senderColor || "#7C5CFF";
  const imageUrl = info.imageUrl || "";
  // Notification pings are now native tones (default / none / ping1-3) that play
  // identically in foreground and background, so no JS-side chime fallback.
  const nativeSound = sound || "default";
  if (Capacitor.isNativePlatform()) {
    try {
      NextextNative.showLocalNotification({
        title: title || "NexText",
        body: body || "You have a new message.",
        tag,
        chatId: info.chatId || "",
        senderName: info.senderName || "",
        groupName: info.groupName || "",
        messageText: info.messageText || "",
        // Locked chat / app lock: hide the message body on the lock screen.
        private: info.private === true,
        vibrationPattern: Array.isArray(vibrationPattern) ? vibrationPattern : null,
        sound: nativeSound,
        senderColor,
        imageUrl,
        // Manual dark-theme override for devices without system dark mode.
        // "actual" = full dark card, "lettering" = dark text on a light card.
        dark,
      }).catch(() => {});
    } catch (e) {
      console.warn("[notifications] native notification error:", e);
    }
    return;
  }
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title || "NexText", {
        body: body || "You have a new message.",
        icon: "/icon.png",
        badge: "/icon.png",
        tag,
        vibrate: Array.isArray(vibrationPattern) ? vibrationPattern : undefined,
      });
    }
  } catch (e) {
    console.warn("[notifications] Notification error:", e);
  }
}

// Preview the chosen vibration + sound instantly when the user taps an option
// in Settings / a contact profile. Chime ids (the Web Audio voice-note chimes)
// are played by the JS layer; everything else (default/none/ping1-3) is handled
// natively. Vibration always goes through the native layer.
export function previewNotificationFeedback(pattern, sound) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (isChimeId(sound)) {
      playChime(sound);
      // Native plays vibration only for chimes (it can't synthesize Web Audio).
      NextextNative.previewNotificationFeedback({
        vibrationPattern: Array.isArray(pattern) ? pattern : null,
        sound: "none",
      }).catch(() => {});
      return;
    }
    NextextNative.previewNotificationFeedback({
      vibrationPattern: Array.isArray(pattern) ? pattern : null,
      sound: sound || "default",
    }).catch(() => {});
  } catch {}
}

export async function initNotifications(myUid) {
  if (!myUid) return null;
  try {
    if (Capacitor.isNativePlatform()) {
      // Create the notification channel FIRST, regardless of permission state.
      // On Android < 13 there is no runtime prompt (notifications are granted
      // automatically), but the channel still has to exist or FCM signals are
      // silently dropped. Creating it even when permission is missing is a
      // no-op and harmless.
      try {
        await PushNotifications.createChannel({
          id: "nextext_messages_v2",
          name: "Messages",
          description: "New chat messages",
          importance: 4,           // IMPORTANCE_HIGH (heads-up)
          visibility: 1,           // PUBLIC
          lights: true,
          vibration: true,
          vibrationPattern: [200, 100, 200],
        });
      } catch { /* older plugin versions may not support createChannel */ }

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "denied") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== "granted") return null;

      // Tap on a locally-posted notification (the client-side message watcher
      // in App.jsx uses NextextNative.showLocalNotification) → route into the
      // chat. Fired on the main thread when the app is alive; cold-start taps
      // are covered by pollPendingNotificationTap.
      NextextNative.addListener("localNotificationTap", ({ chatId }) => routeNotificationTap(chatId)).catch(() => {});

      // The "Mark as read" action on a local notification → zero the unread
      // badge without opening the chat. Cold-start actions are picked up by
      // pollPendingMarkRead in App.jsx.
      NextextNative.addListener("localNotificationMarkRead", ({ chatId }) => routeMarkRead(chatId)).catch(() => {});

      PushNotifications.addListener("registration", ({ value }) => {
        if (value) {
          updateDoc(doc(db, "users", myUid), { fcmTokens: [value] }).catch(() => {});
        }
      }).catch(() => {});
      PushNotifications.addListener("registrationError", ({ err }) => {
        console.error("[notifications] FCM registration error:", err);
      }).catch(() => {});
      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        triggerNotificationVibration();
        const title = (notification && (notification.title || notification.data?.title)) || "NexText";
        const body = (notification && (notification.body || notification.data?.body)) || "You have a new message";
        const chatId = notification?.data?.chatId;
        const tag = chatId || (notification && (notification.id || notification.data?.notificationId)) || "nextext-native";
        if (chatId) {
          if (notificationTapHandler) notificationTapHandler(chatId);
          else pendingTapChatId = chatId;
        }
        showLocalNotification(title, body, tag, { chatId });
      }).catch(() => {});

      // Tap on a background/terminated notification → route into that chat.
      PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
        const chatId = notification?.data?.chatId;
        if (chatId) {
          if (notificationTapHandler) notificationTapHandler(chatId);
          else pendingTapChatId = chatId;
        }
      }).catch(() => {});

      await PushNotifications.register();
      return null;
    }

    if (!("Notification" in window)) return null;
    const messaging = getMessaging(app);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY }).catch(() => null);
    if (token) {
      await updateDoc(doc(db, "users", myUid), {
        fcmTokens: [token],
      });
    }
    onMessage(messaging, (payload) => {
      const { notification, data } = payload;
      const title = notification?.title || data?.title || "New Message";
      const body = notification?.body || data?.body || "You received a new message";
      showLocalNotification(title, body, data?.chatId || "nextext");
    });
    return token;
  } catch {
    return null;
  }
}

export async function unregisterNotifications(myUid, token) {
  if (!myUid || !token) return;
  try {
    await updateDoc(doc(db, "users", myUid), {
      fcmTokens: arrayRemove(token),
    });
  } catch {}
}

// Reports current permission state and whether the platform even shows a
// prompt. On Android < 13 there is no POST_NOTIFICATIONS permission at all —
// notifications are always allowed and no toggle appears in app settings, so
// we surface that here instead of pretending it's "denied".
export async function getNotificationsStatus() {
  try {
    if (Capacitor.isNativePlatform()) {
      const perm = await PushNotifications.checkPermissions();
      // On Android < 13 (API < 33) there is no POST_NOTIFICATIONS runtime
      // permission — notifications are granted automatically and no prompt
      // exists. We detect this via the native SDK version.
      let hasPrompt = true;
      try {
        const { sdkInt } = await NextextNative.getAndroidSdkVersion();
        hasPrompt = sdkInt >= 33;
      } catch { /* fallback: assume prompt exists */ }
      return { supported: true, hasPrompt, receive: perm.receive, androidSdk: hasPrompt ? ">=33" : "<33" };
    }
    if ("Notification" in window) {
      return { supported: true, hasPrompt: true, receive: Notification.permission === "granted" ? "granted" : "prompt" };
    }
    return { supported: false, hasPrompt: false, receive: "unsupported" };
  } catch {
    return { supported: false, hasPrompt: false, receive: "unknown" };
  }
}

// User-triggered "enable notifications" from Settings. Requests the runtime
// permission (Android 13+), creates the channel, and registers for FCM. On
// Android < 13 this just creates the channel + registers.
export async function enableNotifications(myUid) {
  if (!myUid) return { ok: false, reason: "not-signed-in" };
  try {
    if (Capacitor.isNativePlatform()) {
      try { await NextextNative.requestNotificationPermission(); } catch {}
      // Recreate channel + register via the normal path.
      return { ok: true };
    }
    if ("Notification" in window) {
      const p = await Notification.requestPermission();
      if (p !== "granted") return { ok: false, reason: "denied" };
      return { ok: true };
    }
    return { ok: false, reason: "unsupported" };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
