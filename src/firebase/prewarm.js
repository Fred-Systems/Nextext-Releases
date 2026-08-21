import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, runTransaction } from "firebase/firestore";
import { db } from "./config";

// Stealth pre-warm: when an admin enables it, every app launch / foreground
// tick writes a tiny silent document to the `messages` collection group. The
// GitHub FCM worker ignores these (`isPreWarmPing`), but the resulting DB
// read/write traffic keeps the Render worker process awake/active while users
// are around — without sending any notification.
const PREWARM_REF = doc(db, "system_config", "settings");
const PREWARM_THRESHOLD_MS = 14 * 60 * 1000;

export async function getPreWarmConfig() {
  try {
    const snap = await getDoc(PREWARM_REF);
    return snap.exists() ? snap.data() : { preWarmEnabled: false };
  } catch {
    return { preWarmEnabled: false };
  }
}

export async function setPreWarmEnabled(value) {
  await setDoc(
    PREWARM_REF,
    { preWarmEnabled: !!value, updatedAt: new Date() },
    { merge: true }
  );
}

// Called on app mount and on every background→foreground transition. Uses a
// transaction so only ONE device performs the write per 14-minute window
// (avoids a thundering herd of ping docs from many online users at once).
export async function runPreWarmPing() {
  try {
    const shouldPing = await runTransaction(db, async (tx) => {
      const snap = await tx.get(PREWARM_REF);
      const data = snap.exists() ? snap.data() : {};
      if (data.preWarmEnabled !== true) return false;
      const last = data.lastPingTime?.toMillis ? data.lastPingTime.toMillis() : 0;
      const now = Date.now();
      if (last && now - last < PREWARM_THRESHOLD_MS) return false;
      tx.set(
        PREWARM_REF,
        { lastPingTime: serverTimestamp(), updatedAt: new Date(), preWarmEnabled: true },
        { merge: true }
      );
      return true;
    });
    if (shouldPing) {
      await addDoc(collection(db, "messages"), {
        isPreWarmPing: true,
        sentAt: serverTimestamp(),
      });
    }
  } catch {
    /* non-fatal — pre-warm is best-effort */
  }
}
