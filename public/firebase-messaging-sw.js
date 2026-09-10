importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCAYHwJ9UyUDyhPVU0Bj32N2fCTuMXXAG0",
  projectId: "nextext-ddf38",
  messagingSenderId: "406410965292",
  appId: "1:406410965292:web:c0e03eb6cf8439ec853c89",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { notification, data } = payload;
  // Incoming call via FCM (if Cloud Function is ever added) carries minimal call metadata
  if (data?.type === "call" || data?.callId) {
    const isVideo = data.callType === "video";
    const title = data.callerName ? `${data.callerName}` : "Incoming call";
    const body = isVideo ? "Incoming video call — tap to answer" : "Incoming voice call — tap to answer";
    const tag = data.callId ? `call-${data.callId}` : "nextext-call";
    self.registration.showNotification(title, {
      body,
      icon: "/icon.png",
      tag,
      requireInteraction: true,
      data: { ...data, isCall: true },
    });
    return;
  }
  const title = notification?.title || "NexText";
  const body = notification?.body || "";
  const tag = data?.chatId || "nextext-default";
  self.registration.showNotification(title, {
    body,
    icon: "/icon.png",
    tag,
    data: payload.data || {},
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (data.isCall || data.callId) {
    const url = data.callId ? `/?call=${encodeURIComponent(data.callId)}` : "/";
    event.waitUntil(clients.openWindow(url));
    return;
  }
  const chatId = data?.chatId;
  const url = chatId
    ? `/?openChat=${encodeURIComponent(chatId)}`
    : "/";
  event.waitUntil(clients.openWindow(url));
});
