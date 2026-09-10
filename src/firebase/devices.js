// Lightweight, non-media device-history tracking for the admin "Device History"
// feature. Each app install gets a stable device id (stored locally) and writes a
// small metadata record under users/{uid}/devices/{deviceId}. We only ever update
// this on meaningful app/device changes — never per render, never per second.
import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc, serverTimestamp, collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "./config";
import { APP_VERSION, APP_VERSION_CODE } from "../version";

const DEVICE_ID_KEY = "nextext_device_id";

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "dev_unknown";
  }
}

// Build a best-effort, privacy-safe device descriptor. We deliberately avoid
// collecting anything that isn't legitimately available on the WebView (no
// precise hardware serials, no screenshots/photos).
export function readDeviceInfo() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  let platform = "web";
  try {
    if (typeof window !== "undefined" && window.Capacitor?.getPlatform) {
      platform = window.Capacitor.getPlatform();
    }
  } catch { /* keep web */ }

  let os = "Unknown";
  if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s([\d.]+)/);
    os = "Android" + (m ? " " + m[1] : "");
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = "iOS";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Mac OS X/i.test(ua)) {
    os = "macOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  // WebView / browser engine, useful for the admin to know what rendered the app.
  let webview = "Unknown";
  if (/Chrome\/(\d+)/i.test(ua)) {
    const m = ua.match(/Chrome\/(\d+)/i);
    webview = "Chrome " + (m ? m[1] : "");
  } else if (/Firefox\/(\d+)/i.test(ua)) {
    const m = ua.match(/Firefox\/(\d+)/i);
    webview = "Firefox " + (m ? m[1] : "");
  } else if (/Safari\/(\d+)/i.test(ua) && !/Chrome/i.test(ua)) {
    const m = ua.match(/Version\/(\d+)/i);
    webview = "Safari " + (m ? m[1] : "");
  }

  return {
    deviceId: getDeviceId(),
    platform,
    os,
    webview,
    appVersion: APP_VERSION,
    appVersionCode: APP_VERSION_CODE,
    userAgent: ua.slice(0, 400),
  };
}

// Record/update this device for the given user. Called once per session start
// (and on meaningful changes), NOT on every render. Writes a stable record so
// reopening on the same device updates lastSeen rather than creating duplicates.
export async function recordDevice(myUid) {
  if (!myUid) return;
  const info = readDeviceInfo();
  const ref = doc(db, "users", myUid, "devices", info.deviceId);
  try {
    const snap = await getDoc(ref);
    const base = snap.exists() ? snap.data() : {};
    await setDoc(ref, {
      ...base,
      platform: info.platform,
      os: info.os,
      webview: info.webview,
      appVersion: info.appVersion,
      appVersionCode: info.appVersionCode,
      userAgent: info.userAgent,
      lastSeen: serverTimestamp(),
      firstSeen: base.firstSeen || serverTimestamp(),
    }, { merge: true });
  } catch {
    // Device history is non-critical; never let it break the app.
  }
}

// Reactive list of a user's historical devices, newest lastSeen first. Admin-only
// consumption. Returns [] while loading or on error.
export function useUserDevices(uid) {
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    if (!uid) { setDevices([]); return undefined; }
    const q = query(collection(db, "users", uid, "devices"), orderBy("lastSeen", "desc"));
    const unsub = onSnapshot(q, (s) => {
      const arr = [];
      s.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setDevices(arr);
    }, () => setDevices([]));
    return () => unsub();
  }, [uid]);
  return devices;
}

// Format a Firestore Timestamp (or null) into a short human string.
export function formatDeviceTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
