import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, auth } from "./config";

// Stealth pre-warm: when an admin enables it, every app launch / foreground
// tick writes a tiny silent document to the `messages` collection group. The
// GitHub FCM worker ignores these (`isPreWarmPing`), but the resulting DB
// read/write traffic keeps the Render worker process awake/active while users
// are around — without sending any notification.
const PREWARM_REF = doc(db, "system_config", "settings");
const PREWARM_THRESHOLD_MS = 14 * 60 * 1000;

// ── Quota / error circuit breaker ──
// If ANY prewarm read/write fails (especially a 429 / resource-exhausted from
// a burned Firestore quota), we STOP touching Firestore entirely for a long
// cooldown. This prevents an out-of-control retry storm that hammers the
// `system_config/settings` doc and exhausts quota further.
let blockedUntil = 0;
const BLOCK_MS = 10 * 60 * 1000; // 10 minutes
let lastPingAt = 0;

function isQuotaError(err) {
  const s = String(err?.code || err?.name || err?.message || "");
  return s.includes("resource-exhausted") || s.includes("429") || s.toLowerCase().includes("quota");
}

function tripBreaker(err) {
  blockedUntil = Date.now() + BLOCK_MS;
  console.warn("[prewarm] halted for 10 min due to error:", err?.code || err?.message || err);
}

function blocked() {
  return Date.now() < blockedUntil;
}

export async function getPreWarmConfig() {
  // Never read unauthenticated (trips the isSignedIn() rule and starts a deny
  // loop) and never read while the breaker is tripped.
  if (!auth.currentUser || blocked()) return { preWarmEnabled: false };
  try {
    const snap = await getDoc(PREWARM_REF);
    return snap.exists() ? snap.data() : { preWarmEnabled: false };
  } catch (err) {
    // Abort completely — do NOT retry. If it's a quota error, trip the breaker
    // so we don't keep hitting the backend.
    if (isQuotaError(err)) tripBreaker(err);
    return { preWarmEnabled: false };
  }
}

export async function setPreWarmEnabled(value) {
  if (!auth.currentUser || blocked()) return;
  try {
    await setDoc(
      PREWARM_REF,
      { preWarmEnabled: !!value, updatedAt: new Date() },
      { merge: true }
    );
  } catch (err) {
    if (isQuotaError(err)) tripBreaker(err);
  }
}

// Called on app mount and on every background→foreground transition.
// Replaced the previous runTransaction (which the SDK auto-retries on 429)
// with a plain get+conditional set that bails on ANY error and respects the
// cooldown, so a quota outage cannot cause a fetch storm.
export async function runPreWarmPing() {
  if (!auth.currentUser || blocked()) return;
  // Only one device pings per 14-minute window (avoids a herd of writes).
  if (Date.now() - lastPingAt < PREWARM_THRESHOLD_MS) return;
  try {
    const snap = await getDoc(PREWARM_REF);
    const data = snap.exists() ? snap.data() : {};
    if (data.preWarmEnabled !== true) return;
    const last = data.lastPingTime?.toMillis ? data.lastPingTime.toMillis() : 0;
    const now = Date.now();
    if (last && now - last < PREWARM_THRESHOLD_MS) return;
    lastPingAt = now;
    await setDoc(
      PREWARM_REF,
      { lastPingTime: serverTimestamp(), updatedAt: new Date(), preWarmEnabled: true },
      { merge: true }
    );
    await addDoc(collection(db, "messages"), {
      isPreWarmPing: true,
      sentAt: serverTimestamp(),
    });
  } catch (err) {
    // Abort — never retry instantly. Trip the breaker on quota errors so we
    // stay completely silent until the cooldown passes.
    if (isQuotaError(err)) tripBreaker(err);
  }
}
