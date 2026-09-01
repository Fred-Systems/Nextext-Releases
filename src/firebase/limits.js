import { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "./config";

// Daily per-user usage tracking for media (bytes) and status posts (count).
// Stored in usage/{uid} with a `day` key (YYYY-MM-DD local). A new day resets
// the counters. These are client-maintained (a deterrent, not hard server
// enforcement), mirroring the existing message-limit pattern.

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getTodayUsage(uid) {
  if (!uid) return { mediaBytes: 0, statusCount: 0, day: todayKey() };
  const snap = await getDoc(doc(db, "usage", uid));
  if (!snap.exists()) return { mediaBytes: 0, statusCount: 0, day: todayKey() };
  const d = snap.data();
  if (d.day !== todayKey()) return { mediaBytes: 0, statusCount: 0, day: todayKey() };
  return { mediaBytes: d.mediaBytes || 0, statusCount: d.statusCount || 0, day: d.day };
}

// Returns { allowed, remainingMB, limitMB } for an incoming media upload of `bytes`.
export async function checkMediaAllowed(uid, bytes, limitMB) {
  if (!limitMB || limitMB <= 0) return { allowed: true, remainingMB: Infinity, limitMB: 0 };
  const used = await getTodayUsage(uid);
  const usedMB = used.mediaBytes / (1024 * 1024);
  const remainingMB = limitMB - usedMB;
  return { allowed: bytes / (1024 * 1024) <= remainingMB + 0.001, remainingMB, limitMB };
}

// Returns { allowed, remaining, limit } for posting a status.
export async function checkStatusAllowed(uid, limit) {
  if (!limit || limit <= 0) return { allowed: true, remaining: Infinity, limit: 0 };
  const used = await getTodayUsage(uid);
  return { allowed: used.statusCount < limit, remaining: limit - used.statusCount, limit };
}

export async function recordMediaUsage(uid, bytes) {
  if (!uid || !bytes) return;
  const key = todayKey();
  const ref = doc(db, "usage", uid);
  const snap = await getDoc(ref);
  if (!snap.exists() || (snap.data().day !== key)) {
    await setDoc(ref, { day: key, mediaBytes: bytes, statusCount: 0, updatedAt: serverTimestamp() });
  } else {
    await updateDoc(ref, { mediaBytes: increment(bytes), updatedAt: serverTimestamp() });
  }
}

export async function recordStatusUsage(uid) {
  if (!uid) return;
  const key = todayKey();
  const ref = doc(db, "usage", uid);
  const snap = await getDoc(ref);
  if (!snap.exists() || (snap.data().day !== key)) {
    await setDoc(ref, { day: key, mediaBytes: 0, statusCount: 1, updatedAt: serverTimestamp() });
  } else {
    await updateDoc(ref, { statusCount: increment(1), updatedAt: serverTimestamp() });
  }
}
