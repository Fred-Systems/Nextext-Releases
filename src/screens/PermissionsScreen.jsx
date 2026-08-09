import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, Mic, Camera, Bell, Users, Image as ImageIcon, ExternalLink, RefreshCw, MapPin } from "lucide-react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { useTheme } from "../theme/ThemeContext";
import { initNotifications } from "../firebase/notifications";

const NextextNative = registerPlugin("NextextNative");

const STATUS_META = {
  granted: { label: "Allowed", color: "#00A884" },
  denied: { label: "Denied", color: "#FF3B30" },
  prompt: { label: "Not asked", color: "#E8A33D" },
  unavailable: { label: "Unavailable", color: "#8E8E93" },
  unknown: { label: "Unknown", color: "#8E8E93" },
};

export default function PermissionsScreen({ myUid, onBack }) {
  const { t } = useTheme();
  const [statuses, setStatuses] = useState({ mic: "unknown", cam: "unknown", notif: "unknown", contacts: "unknown", media: "unknown", loc: "unknown" });
  const [refreshing, setRefreshing] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  const flash = (msg) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(""), 3500);
  };

  const queryNativePermission = async (method) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await NextextNative[method]();
        return res.granted ? "granted" : "prompt";
      } catch { return "unknown"; }
    }
    return null;
  };

  const queryWebPermission = async (name) => {
    try {
      const st = await navigator.permissions.query({ name });
      return st.state;
    } catch { return "unknown"; }
  };

  const queryMic = async () => {
    const native = await queryNativePermission("getMicrophonePermission");
    if (native) return native;
    return queryWebPermission("microphone");
  };

  const queryCam = async () => {
    const native = await queryNativePermission("getCameraPermission");
    if (native) return native;
    return queryWebPermission("camera");
  };

  const queryNotification = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await PushNotifications.checkPermissions();
        return res.receive || "prompt";
      } catch { return "prompt"; }
    }
    if ("Notification" in window) {
      return Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "prompt";
    }
    return "unavailable";
  };

  const queryContacts = async () => {
    const native = await queryNativePermission("getContactsPermission");
    if (native) return native;
    return navigator.contacts && navigator.contacts.select ? "granted" : "unavailable";
  };

  const queryMedia = async () => {
    const native = await queryNativePermission("getMediaPermission");
    if (native) return native;
    // Browser file pickers need no permission, so the feature always works.
    return "granted";
  };

  const queryLocation = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        // Pure status getter — does NOT trigger the runtime prompt. Calling
        // requestLocationPermission() here was popping the OS dialog whenever
        // the screen (or any refresh) loaded, making "Allow" appear broken.
        const res = await NextextNative.getLocationPermission();
        return res.granted ? "granted" : (res.denied === true ? "denied" : "prompt");
      } catch { return "unknown"; }
    }
    try {
      const st = await navigator.permissions.query({ name: "geolocation" });
      return st.state;
    } catch { return "unknown"; }
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [mic, cam, notif, contacts, media, loc] = await Promise.all([
      queryMic(),
      queryCam(),
      queryNotification(),
      queryContacts(),
      queryMedia(),
      queryLocation(),
    ]);
    setStatuses({ mic, cam, notif, contacts, media, loc });
    setRefreshing(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const requestMic = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await NextextNative.requestMicrophone();
        if (res && res.granted) { flash("Microphone allowed."); await refresh(); return; }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      flash("Microphone allowed.");
    } catch { flash("Microphone permission denied or unavailable."); }
    refresh();
  };

  const requestCamera = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await NextextNative.requestCamera();
        if (res && res.granted) { flash("Camera allowed."); await refresh(); return; }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((tr) => tr.stop());
      flash("Camera allowed.");
    } catch { flash("Camera permission denied or unavailable."); }
    refresh();
  };

  const requestNotifications = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await PushNotifications.requestPermissions();
        if (res.receive === "granted") {
          await initNotifications(myUid);
          flash("Notifications allowed.");
        } else {
          flash("Notifications permission denied.");
        }
      } else if ("Notification" in window) {
        const result = await Notification.requestPermission();
        if (result === "granted") {
          await initNotifications(myUid);
          flash("Notifications allowed.");
        } else {
          flash("Notifications permission denied.");
        }
      } else {
        flash("Notifications not available on this device.");
      }
    } catch { flash("Notifications permission denied."); }
    refresh();
  };

  const requestContacts = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await NextextNative.requestContacts();
        if (res && res.granted) { flash("Contacts allowed."); await refresh(); return; }
      }
      flash("Contacts permission denied or unavailable.");
    } catch { flash("Contacts permission denied or unavailable."); }
    refresh();
  };

  const requestMedia = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await NextextNative.requestMedia();
        if (res && res.granted) { flash("Files & media allowed."); await refresh(); return; }
      }
      flash("Files & media permission denied or unavailable.");
    } catch { flash("Files & media permission denied or unavailable."); }
    refresh();
  };

  const requestLocation = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await NextextNative.requestLocationPermission();
        if (res && res.granted) { flash("Location allowed."); await refresh(); return; }
      }
      // Web fallback: just try to get position, which triggers prompt
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });
      flash("Location allowed.");
    } catch { flash("Location permission denied or unavailable."); }
    refresh();
  };

  const openAppSettings = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await NextextNative.openAppSettings();
      } catch { /* no-op */ }
    } else {
      alert("Open your browser's site settings to manage permissions for NexText.");
    }
  };

  const renderRow = ({ icon, label, desc, status, onAllow, onManage }) => {
    const meta = STATUS_META[status] || STATUS_META.unknown;
    const showAllow = (status === "prompt" || status === "unknown") && onAllow;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: `1px solid ${t.border}` }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, color: t.text, fontSize: 15 }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.color + "1A", padding: "2px 8px", borderRadius: 10, flexShrink: 0 }}>{meta.label}</span>
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 1 }}>{desc}</div>
        </div>
        {showAllow ? (
          <div onClick={onAllow} style={{ padding: "7px 14px", borderRadius: 10, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}>Allow</div>
        ) : (
          <div onClick={onManage} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, color: t.text, fontWeight: 600, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
            <ExternalLink size={12} /> Manage
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px", background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 18, flex: 1 }}>Permissions</span>
        <RefreshCw size={17} color={t.text} style={{ cursor: "pointer", opacity: refreshing ? 0.5 : 1 }} onClick={refresh} />
      </div>

      <div className="nx-scroll" style={{ flex: 1, minHeight: 0, padding: "6px 16px 40px", overflowY: "auto" }}>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 4, marginTop: 8, lineHeight: 1.5 }}>
          NexText only asks for a permission when you actually use the feature (voice notes, camera, notifications). Manage each one below.
        </div>

        {actionMsg && (
          <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 10, background: t.primaryLight, color: t.primary, fontSize: 12.5, fontWeight: 600, border: `1px solid ${t.border}` }}>{actionMsg}</div>
        )}

        <div style={{ background: t.surface, borderRadius: 14, padding: "4px 14px", border: `1px solid ${t.border}`, marginTop: 12 }}>
          {renderRow({
            icon: <Mic size={18} color={t.primary} />,
            label: "Microphone",
            desc: "Voice messages and voice calls",
            status: statuses.mic,
            onAllow: requestMic,
            onManage: openAppSettings,
          })}
          {renderRow({
            icon: <Camera size={18} color={t.primary} />,
            label: "Camera",
            desc: "Photos, videos, and profile pictures",
            status: statuses.cam,
            onAllow: requestCamera,
            onManage: openAppSettings,
          })}
          {renderRow({
            icon: <Bell size={18} color={t.primary} />,
            label: "Notifications",
            desc: "Message alerts when the app is in the background",
            status: statuses.notif,
            onAllow: requestNotifications,
            onManage: openAppSettings,
          })}
          {renderRow({
            icon: <Users size={18} color={t.primary} />,
            label: "Contacts",
            desc: "Find friends — requires device contacts picker support",
            status: statuses.contacts,
            onAllow: requestContacts,
            onManage: openAppSettings,
          })}
          {renderRow({
            icon: <ImageIcon size={18} color={t.primary} />,
            label: "Files & Media",
            desc: "Sending and saving photos, videos, and files",
            status: statuses.media,
            onAllow: requestMedia,
            onManage: openAppSettings,
          })}
          {renderRow({
            icon: <MapPin size={18} color={t.primary} />,
            label: "Location",
            desc: "Share your location and live location updates",
            status: statuses.loc,
            onAllow: requestLocation,
            onManage: openAppSettings,
          })}
        </div>

        <div style={{ fontSize: 12, color: t.textMuted, marginTop: 12, lineHeight: 1.6 }}>
          "Manage" opens this app's page in your device Settings. On Android, a denied permission can only be re-enabled there.
        </div>
      </div>
    </div>
  );
}
