import { useState, useEffect } from "react";
import { doc, onSnapshot, updateDoc, serverTimestamp, increment } from "firebase/firestore";
import { db } from "./config";

const ONLINE_THRESHOLD_MS = 60 * 1000; // treat "online" as lastSeen within the last 60s

// Call this once per active session (e.g. in App.jsx) to keep the current
// user's own presence heartbeat fresh while the app is open.
export function usePresenceHeartbeat(myUid) {
  useEffect(() => {
    if (!myUid) return;
    const beat = () => updateDoc(doc(db, "users", myUid), { lastSeen: serverTimestamp(), isOnline: true });
    beat();
    const interval = setInterval(beat, 25000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") beat();
      else updateDoc(doc(db, "users", myUid), { isOnline: false });
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Best-effort — browsers don't reliably guarantee this fires, which is
    // an honest, known limitation of heartbeat-based presence without a
    // dedicated realtime-disconnect service (e.g. Realtime Database's
    // onDisconnect(), which Firestore doesn't have an equivalent of).
    const handleUnload = () => updateDoc(doc(db, "users", myUid), { isOnline: false });
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [myUid]);
}

// Tracks cumulative active time spent in the app (foreground + visible) and
// accumulates it into users/{uid}.activeTimeMs via Firestore increment() every
// ~5s of active use, flushing the remainder on visibility change / unload.
// Drives the "time spent in app" stat in the statistics cards.
//
// Important detail: "visibilitychange" fires AFTER the document is already
// hidden, so the tracker keeps a `wasVisible` flag — the last visible chunk
// of time (up to one flush interval) is always credited before going hidden,
// and small sessions under the flush interval still commit on close.
export function useAppUsageTracker(myUid) {
  useEffect(() => {
    if (!myUid) return;
    const FLUSH_MS = 5_000;
    let pending = 0;
    let lastTick = Date.now();
    let wasVisible = !document.hidden;

    const flush = (force) => {
      const now = Date.now();
      const isVisible = !document.hidden;
      // Time elapsed since lastTick only counts while we were visible for it.
      if (wasVisible) pending += now - lastTick;
      lastTick = now;
      wasVisible = isVisible;
      if (pending >= FLUSH_MS || (force && pending >= 500)) {
        const toCommit = Math.floor(pending);
        updateDoc(doc(db, "users", myUid), { activeTimeMs: increment(toCommit) }).catch(() => {});
        pending -= toCommit;
      }
    };

    const interval = setInterval(flush, FLUSH_MS);
    const onVisibility = () => flush(true);
    const onUnload = () => flush(true);
    document.addEventListener("visibilitychange", onVisibility);
    // pagehide is more reliable than beforeunload on mobile WebViews.
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      flush(true);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [myUid]);
}

// Reads another user's real presence, with last-seen reciprocity: if EITHER
// side has set lastSeenVisibility to "nobody", neither can see the other's
// last-seen/online status -- matching the WhatsApp-style rule from the data
// model (hiding yours also hides theirs from you).
export function usePresence(uid, myUid) {
  const [presence, setPresence] = useState({ isOnline: false, lastSeen: null, visible: true });

  useEffect(() => {
    if (!uid) return;
    let myPrivacy = null;
    let theirData = null;

    const applyIfReady = () => {
      if (!theirData) return;
      const theirVisibility = theirData.privacy?.lastSeenVisibility || "contacts";
      const myVisibility = myPrivacy?.lastSeenVisibility || "contacts";
      const reciprocallyVisible = theirVisibility !== "nobody" && myVisibility !== "nobody";

      if (!reciprocallyVisible) {
        setPresence({ isOnline: false, lastSeen: null, visible: false });
        return;
      }
      const lastSeenMs = theirData.lastSeen?.toMillis?.() || 0;
      const freshEnough = Date.now() - lastSeenMs < ONLINE_THRESHOLD_MS;
      setPresence({ isOnline: !!theirData.isOnline && freshEnough, lastSeen: theirData.lastSeen, visible: true });
    };

    const unsubThem = onSnapshot(doc(db, "users", uid), (snap) => { theirData = snap.data(); applyIfReady(); });
    const unsubMe = myUid
      ? onSnapshot(doc(db, "users", myUid), (snap) => { myPrivacy = snap.data()?.privacy; applyIfReady(); })
      : () => {};

    return () => { unsubThem(); unsubMe(); };
  }, [uid, myUid]);

  return presence;
}

export function formatLastSeen(lastSeen) {
  if (!lastSeen?.toDate) return "offline";
  const date = lastSeen.toDate();
  const now = new Date();
  const diffMin = Math.floor((now - date) / 60000);
  if (diffMin < 1) return "last seen just now";
  if (diffMin < 60) return `last seen ${diffMin}m ago`;
  if (diffMin < 24 * 60) return `last seen ${Math.floor(diffMin / 60)}h ago`;
  return `last seen ${date.toLocaleDateString()}`;
}
