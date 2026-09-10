import { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp, collection, query, orderBy, limit, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "./config";

// Per-status aggregated click counter: jewishStatusClicks/{statusId}
// Per-user aggregated stats: jewishUserStats/{uid}

const CLICK_DEBOUNCE_MS = 3000;
const PAGE_TIME_FLUSH_MS = 15000;
const lastClickAt = new Map(); // statusId -> timestamp

function debounceKey(statusId) {
  const now = Date.now();
  const prev = lastClickAt.get(statusId) || 0;
  if (now - prev < CLICK_DEBOUNCE_MS) return false;
  lastClickAt.set(statusId, now);
  return true;
}

// Record a click/view when user intentionally opens a status. Debounced per status.
export async function recordJewishStatusClick({ statusId, creatorKey, creatorName, title }) {
  if (!statusId) return;
  if (!debounceKey(statusId)) return;
  try {
    const ref = doc(db, "jewishStatusClicks", statusId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        clickCount: increment(1),
        lastClickedAt: serverTimestamp(),
        creatorKey: creatorKey || snap.data().creatorKey || null,
        creatorName: creatorName || snap.data().creatorName || null,
        title: title || snap.data().title || null,
      });
    } else {
      await setDoc(ref, {
        clickCount: 1,
        creatorKey: creatorKey || null,
        creatorName: creatorName || null,
        title: title || null,
        statusId,
        createdAt: serverTimestamp(),
        lastClickedAt: serverTimestamp(),
      }, { merge: true });
    }
  } catch (e) {
    console.warn("[jewishAnalytics] click failed", e?.message);
  }
}

export async function recordJewishUserClick(uid) {
  if (!uid) return;
  try {
    const ref = doc(db, "jewishUserStats", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, { totalClicks: increment(1), lastActiveAt: serverTimestamp() });
    } else {
      await setDoc(ref, { totalClicks: 1, totalPageTimeMs: 0, lastActiveAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
    }
  } catch {}
}

// Page time tracking: accumulate locally and flush periodically / on lifecycle.
let pageTimeAccumMs = 0;
let pageTimeStart = 0;
let flushTimer = null;
let activeUid = null;

function getActiveUid() { return activeUid; }

export function startJewishPageTimer(uid) {
  activeUid = uid || activeUid;
  if (pageTimeStart) return;
  pageTimeStart = Date.now();
  if (!flushTimer) {
    flushTimer = setInterval(() => flushPageTime(false), PAGE_TIME_FLUSH_MS);
  }
  const onVis = () => {
    if (document.visibilityState === "hidden") pauseJewishPageTimer();
    else resumeJewishPageTimer();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("beforeunload", () => flushPageTime(true));
  // store handler for cleanup
  startJewishPageTimer._visHandler = onVis;
}

export function pauseJewishPageTimer() {
  if (!pageTimeStart) return;
  pageTimeAccumMs += Date.now() - pageTimeStart;
  pageTimeStart = 0;
}

export function resumeJewishPageTimer() {
  if (pageTimeStart) return;
  if (document.visibilityState === "hidden") return;
  pageTimeStart = Date.now();
}

export function stopJewishPageTimer() {
  if (pageTimeStart) {
    pageTimeAccumMs += Date.now() - pageTimeStart;
    pageTimeStart = 0;
  }
  flushPageTime(false);
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (startJewishPageTimer._visHandler) {
    document.removeEventListener("visibilitychange", startJewishPageTimer._visHandler);
    startJewishPageTimer._visHandler = null;
  }
}

async function flushPageTime(isUnload) {
  if (!activeUid) return;
  let toFlush = pageTimeAccumMs;
  if (pageTimeStart) {
    toFlush += Date.now() - pageTimeStart;
    pageTimeAccumMs = 0;
    pageTimeStart = Date.now();
  } else {
    pageTimeAccumMs = 0;
  }
  if (toFlush < 500) return;
  try {
    const ref = doc(db, "jewishUserStats", activeUid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, { totalPageTimeMs: increment(toFlush), lastActiveAt: serverTimestamp() });
    } else {
      await setDoc(ref, { totalPageTimeMs: toFlush, totalClicks: 0, lastActiveAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
    }
  } catch {}
}

export function setActiveJewishUid(uid) { activeUid = uid; }

// Queries for Popular ranking and Admin
export async function getPopularStatuses(max = 30) {
  try {
    const q = query(collection(db, "jewishStatusClicks"), orderBy("clickCount", "desc"), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

export function listenPopularStatuses(cb, max = 30) {
  try {
    const q = query(collection(db, "jewishStatusClicks"), orderBy("clickCount", "desc"), limit(max));
    return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
  } catch { cb([]); return () => {}; }
}

export function listenJewishStatusClicks(cb) {
  const q = query(collection(db, "jewishStatusClicks"), orderBy("clickCount", "desc"), limit(100));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
}

export async function getJewishUserStats(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "jewishUserStats", uid));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

export function listenJewishUserStats(uid, cb) {
  if (!uid) { cb(null); return () => {}; }
  return onSnapshot(doc(db, "jewishUserStats", uid), (snap) => cb(snap.exists() ? snap.data() : null), () => cb(null));
}

export function listenAllJewishUserStats(cb) {
  const q = query(collection(db, "jewishUserStats"), orderBy("totalClicks", "desc"), limit(100));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), () => cb([]));
}
