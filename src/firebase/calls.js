import {
  doc, collection, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, getDocs, writeBatch
} from "firebase/firestore";
import { db } from "./config";

// ── Call state machine ──
// idle, calling, ringing, accepted, connecting, connected, reconnecting, ended, declined, missed, failed, busy, cancelled
export const CALL_STATES = {
  IDLE: "idle",
  CALLING: "calling",
  RINGING: "ringing",
  ACCEPTED: "accepted",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  ENDED: "ended",
  DECLINED: "declined",
  MISSED: "missed",
  FAILED: "failed",
  BUSY: "busy",
  CANCELLED: "cancelled",
};

const CALLS_COL = "calls";
const RING_TIMEOUT_MS = 30000;

// Create an outgoing call document. Returns callId.
// Busy is handled by the callee's CallContext: if callee already has activeCallId, the new
// ringing call is immediately marked busy. We do NOT query callee's calls here because that
// would require the caller to read calls where they are not a participant (rules deny).
export async function createCall({ callerUid, calleeUid, type = "voice", callerName = "", calleeName = "", callerPhoto = null, calleePhoto = null }) {
  if (!callerUid || !calleeUid) throw new Error("createCall: missing uid");
  if (callerUid === calleeUid) throw new Error("Cannot call yourself");
  const participants = [callerUid, calleeUid].sort();
  const ref = await addDoc(collection(db, CALLS_COL), {
    participants,
    callerUid,
    calleeUid,
    callerName,
    calleeName,
    callerPhoto,
    calleePhoto,
    type, // voice | video
    state: CALL_STATES.CALLING,
    offer: null,
    answer: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ringingAt: null,
    acceptedAt: null,
    connectedAt: null,
    endedAt: null,
    duration: null,
    endedBy: null,
  });
  // Immediately transition to ringing so callee's listener picks it up
  await updateDoc(ref, { state: CALL_STATES.RINGING, ringingAt: serverTimestamp(), updatedAt: serverTimestamp() });
  console.log("[calls] createCall ->", ref.id, { callerUid, calleeUid, type, participants });
  return ref.id;
}

export async function updateCallOffer(callId, offer) {
  await updateDoc(doc(db, CALLS_COL, callId), { offer, updatedAt: serverTimestamp() });
}
export async function updateCallAnswer(callId, answer) {
  await updateDoc(doc(db, CALLS_COL, callId), { answer, state: CALL_STATES.ACCEPTED, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
}
export async function addIceCandidate(callId, candidateInit, fromUid) {
  if (!candidateInit) return;
  await addDoc(collection(db, CALLS_COL, callId, "candidates"), {
    fromUid,
    candidate: candidateInit.candidate,
    sdpMid: candidateInit.sdpMid,
    sdpMLineIndex: candidateInit.sdpMLineIndex,
    usernameFragment: candidateInit.usernameFragment || null,
    createdAt: serverTimestamp(),
  });
}
export async function setCallState(callId, state, extra = {}) {
  await updateDoc(doc(db, CALLS_COL, callId), { state, updatedAt: serverTimestamp(), ...extra });
}
export async function acceptCall(callId) {
  await setCallState(callId, CALL_STATES.ACCEPTED, { acceptedAt: serverTimestamp() });
}
export async function declineCall(callId, byUid) {
  await setCallState(callId, CALL_STATES.DECLINED, { endedAt: serverTimestamp(), endedBy: byUid || null });
}
export async function cancelCall(callId, byUid) {
  await setCallState(callId, CALL_STATES.CANCELLED, { endedAt: serverTimestamp(), endedBy: byUid || null });
}
export async function endCall(callId, byUid, durationSec = null) {
  const patch = { state: CALL_STATES.ENDED, endedAt: serverTimestamp(), endedBy: byUid || null, updatedAt: serverTimestamp() };
  if (durationSec != null) patch.duration = durationSec;
  await updateDoc(doc(db, CALLS_COL, callId), patch);
  // Best-effort cleanup of candidates after a short grace (let late ICE trickle)
  setTimeout(() => cleanupCandidates(callId), 10000);
}
export async function markMissed(callId) {
  await setCallState(callId, CALL_STATES.MISSED, { endedAt: serverTimestamp() });
  setTimeout(() => cleanupCandidates(callId), 10000);
}
export async function markFailed(callId, reason) {
  await setCallState(callId, CALL_STATES.FAILED, { endedAt: serverTimestamp(), failReason: reason || null });
}
export async function markBusy(callId) {
  await setCallState(callId, CALL_STATES.BUSY, { endedAt: serverTimestamp() });
}
async function cleanupCandidates(callId) {
  try {
    const q = collection(db, CALLS_COL, callId, "candidates");
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch {}
}

// Listeners
export function listenToCall(callId, cb, onError) {
  return onSnapshot(doc(db, CALLS_COL, callId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError);
}
export function listenToIncomingCalls(myUid, cb) {
  if (!myUid) return () => {};
  // Simple query without composite state filter to avoid requiring a Firestore composite index.
  // We filter to ringing/calling client-side. This also avoids permission issues for the
  // initial query, since rules already allow callee to read.
  const q = query(collection(db, CALLS_COL), where("calleeUid", "==", myUid), orderBy("createdAt", "desc"), limit(10));
  return onSnapshot(q, (snap) => {
    const arr = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.state === CALL_STATES.RINGING || data.state === CALL_STATES.CALLING) arr.push({ id: d.id, ...data });
    });
    console.log("[calls] listenToIncomingCalls snapshot:", snap.size, "docs,", arr.length, "ringing/calling");
    cb(arr.slice(0, 5));
  }, (err) => { console.error("[calls] listenToIncomingCalls error:", err?.code, err?.message); cb([]); });
}
export function listenToCallCandidates(callId, cb) {
  const q = query(collection(db, CALLS_COL, callId, "candidates"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    const arr = [];
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    cb(arr);
  });
}
export function listenToCallHistory(myUid, cb) {
  if (!myUid) return () => {};
  const q = query(collection(db, CALLS_COL), where("participants", "array-contains", myUid), orderBy("createdAt", "desc"), limit(50));
  return onSnapshot(q, (snap) => {
    const arr = [];
    snap.forEach((d) => {
      const data = d.data();
      // Only show terminal history (ended/declined/missed/failed/busy/cancelled) plus maybe connected?
      if ([CALL_STATES.ENDED, CALL_STATES.DECLINED, CALL_STATES.MISSED, CALL_STATES.FAILED, CALL_STATES.BUSY, CALL_STATES.CANCELLED].includes(data.state)) {
        arr.push({ id: d.id, ...data });
      }
    });
    cb(arr);
  }, () => cb([]));
}

export async function getCallHistoryOnce(myUid, max = 30) {
  const q = query(collection(db, CALLS_COL), where("participants", "array-contains", myUid), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => {
    const data = d.data();
    if ([CALL_STATES.ENDED, CALL_STATES.DECLINED, CALL_STATES.MISSED, CALL_STATES.FAILED, CALL_STATES.BUSY, CALL_STATES.CANCELLED].includes(data.state)) arr.push({ id: d.id, ...data });
  });
  return arr;
}

export { RING_TIMEOUT_MS };
