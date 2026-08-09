import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from "./config";
import { doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { db } from "./config";

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

export function showLocalNotification(title, body, tag = "nextext-msg", info = {}) {
  triggerNotificationVibration();
  if (Capacitor.isNativePlatform()) {
    // HTML5 Notification is a silent no-op inside the Capacitor WebView on
    // modern Android, so route through the native bridge which posts a real
    // status-bar notification on the nextext-messages channel. The title/body
    // the caller passes are used as fallbacks; the native side prefers the
    // structured senderName/groupName/messageText fields it also receives.
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
        vibrate: [200, 100, 200],
      });
    }
  } catch (e) {
    console.warn("[notifications] Notification error:", e);
  }
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
          id: "nextext-messages",
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
          updateDoc(doc(db, "users", myUid), { fcmTokens: arrayUnion(value) }).catch(() => {});
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
        fcmTokens: arrayUnion(token),
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
