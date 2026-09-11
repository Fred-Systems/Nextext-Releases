import { useState, useEffect, useRef } from "react";
import {
  collection, query, where, onSnapshot, addDoc, getDoc,
  deleteDoc, doc, serverTimestamp, getDocs, setDoc, orderBy, increment,
} from "firebase/firestore";
import { db } from "./config";
import { deleteChatFile } from "../supabase/media";

const STATUS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const STATUS_STATES = {
  UPLOADING: "uploading",
  QUEUED: "queued",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
};

export async function postStatus(ownerId, {
  text = null,
  mediaURL = null,
  mediaType = null,
  backgroundColor = null,
  fontFamily = null,
  durationMs = null,
  textOverlay = null,
  textStickers = null,
  bgAudioURL = null,
  bgAudioVolume = null,
  videoVolume = null,
  waitForVideo = false,
  allowDownload = false,
  commentsHidden = false,
  // Background Music (Status Builder): stores ONLY compact track metadata — never
  // an audio file. The actual audio is streamed from the source's preview URL on
  // the viewer's device. { trackId, title, artist, album, artwork, previewUrl,
  // source, start, volume, originalVolume, muted }.
  backgroundMusic = null,
  // Premium low-data preview fields (video only).
  // previewURL: lightweight 2-3s animated clip for the feed card (loops).
  // posterURL: static JPEG frame for the feed card and as a poster attribute.
  previewURL = null,
  posterURL = null,
  // New pipeline fields (video only). When pipeline is enabled, mediaURL is NOT the original;
  // instead we store private originalPath and derived HLS/fallback/poster paths. While
  // state !== "ready", the client must not expose hlsMasterURL/fallbackURL.
  state = STATUS_STATES.READY,
  originalPath = null,
  hlsMasterPath = null,
  fallbackPath = null,
  posterPath = null,
  previewPath = null,
  cardPreviewPath = null,
  renditions = null,
  errorCode = null,
  errorMessage = null,
  // visibility: "contacts" (default) or "public" (anyone on NexText can view).
  visibility = "contacts",
  // excludedUids: contacts (by uid) who must NOT see THIS status. Per-status
  // audience exclusion (independent from the owner's global statusExcluded list,
  // which is merged in at post time). Enforced by firestore.rules + client filter.
  excludedUids = null,
  // New-builder video trims/filters (metadata only — enforced by the viewer):
  // trimStart/trimEnd in seconds (null = no trim), videoFilter as a CSS filter
  // string applied to the <video> element (null = none).
  trimStart = null,
  trimEnd = null,
  videoFilter = null,
  // When the audience is "selected" contacts only, pass the explicit allow-list
  // here; otherwise all accepted contacts are allowed (along with the owner).
  selectedUids = null,
}) {
  const isVideo = mediaType === "video";
  const usePipeline = isVideo && originalPath;
  const contactUids = visibility === "public" || visibility === "contacts"
    ? await getAllowedContactUids(ownerId)
    : [];
  const allowedUids = Array.from(
    new Set([ownerId, ...(Array.isArray(selectedUids) && selectedUids.length ? selectedUids : contactUids)])
  );
  await addDoc(collection(db, "status"), {
    ownerId,
    allowedUids,
    text,
    mediaURL: usePipeline ? null : mediaURL,
    mediaType,
    backgroundColor,
    fontFamily,
    durationMs,
    textOverlay,
    textStickers: Array.isArray(textStickers) && textStickers.length ? textStickers : null,
    bgAudioURL,
    bgAudioVolume,
    videoVolume,
    waitForVideo,
    allowDownload,
    commentCount: 0,
    subscriberCount: 0,
    commentsHidden: !!commentsHidden,
    backgroundMusic: backgroundMusic || null,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + STATUS_TTL_MS),
    state: usePipeline ? (state || STATUS_STATES.QUEUED) : STATUS_STATES.READY,
    originalPath: originalPath || null,
    hlsMasterPath: hlsMasterPath || null,
    fallbackPath: fallbackPath || null,
    posterPath: posterPath || null,
    previewPath: previewPath || null,
    cardPreviewPath: cardPreviewPath || null,
    renditions: renditions || null,
    errorCode: errorCode || null,
    errorMessage: errorMessage || null,
    previewURL: previewURL || null,
    posterURL: posterURL || null,
    visibility: visibility === "public" ? "public" : "contacts",
    extended: false,
    excludedUids: Array.isArray(excludedUids) && excludedUids.length ? Array.from(new Set(excludedUids)) : null,
    trimStart: trimStart != null ? Number(trimStart) : null,
    trimEnd: trimEnd != null ? Number(trimEnd) : null,
    videoFilter: videoFilter || null,
  });
}

// Resolve the set of uids allowed to see a status posted by ownerId. Used to
// denormalize `allowedUids` onto each status so the client can query by
// `allowedUids array-contains viewer` — the ONLY Firestore-provably-readable
// shape for contact-scoped visibility (a per-document contact check would make
// the query unprovable and Firestore would deny it).
//
// Canonical contact eligibility (item 3): both the new contact subcollection
// (`users/{ownerId}/contacts/{uid}` with status=="accepted") AND any legacy
// representation are honored. Legacy contacts may have been stored on the
// user doc's `contacts` array (uids) instead of the subcollection; we merge
// both so old contacts still count without re-adding.
export async function getAllowedContactUids(ownerId) {
  const uids = new Set();
  try {
    const snap = await getDocs(
      query(collection(db, "users", ownerId, "contacts"), where("status", "==", "accepted"))
    );
    snap.docs.forEach((d) => uids.add(d.id));
  } catch {}
  try {
    const userSnap = await getDoc(doc(db, "users", ownerId));
    const legacy = userSnap.data()?.contacts;
    if (Array.isArray(legacy)) {
      legacy.forEach((c) => {
        const uid = typeof c === "string" ? c : c?.uid;
        if (uid) uids.add(uid);
      });
    }
  } catch {}
  return Array.from(uids).filter(Boolean);
}

// Queued video status: private original, worker will transcode
export async function createQueuedVideoStatus(ownerId, originalPath, opts = {}) {
  return postStatus(ownerId, {
    mediaType: "video",
    originalPath,
    state: STATUS_STATES.QUEUED,
    allowDownload: opts.allowDownload ?? true,
    commentsHidden: opts.commentsHidden ?? false,
    durationMs: opts.durationMs ?? null,
    text: opts.text ?? null,
    textOverlay: opts.textOverlay ?? null,
    excludedUids: opts.excludedUids ?? null,
  });
}

export async function markStatusProcessing(statusId) {
  await setDoc(doc(db, "status", statusId), { state: STATUS_STATES.PROCESSING }, { merge: true });
}
export async function markStatusReady(statusId, assets) {
  await setDoc(doc(db, "status", statusId), { state: STATUS_STATES.READY, ...assets, errorCode: null, errorMessage: null }, { merge: true });
}
export async function markStatusFailed(statusId, errorCode, errorMessage) {
  await setDoc(doc(db, "status", statusId), { state: STATUS_STATES.FAILED, errorCode, errorMessage }, { merge: true });
}

export async function deleteStatus(statusId) {
  try {
    const snap = await getDoc(doc(db, "status", statusId));
    if (snap.exists()) await deleteStatusAssets(snap.data());
  } catch {}
  await deleteDoc(doc(db, "status", statusId));
}

export async function deleteStatusWithAssets(statusId) {
  return deleteStatus(statusId);
}

// Extract the Supabase storage path from a public media URL so we can
// delete the actual file (not just the Firestore document).
function extractStoragePath(url) {
  if (!url || typeof url !== "string") return null;
  const marker = "/object/public/chat-media/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.substring(idx + marker.length);
}

async function deleteStatusAssets(data) {
  const paths = [];
  if (data.originalPath) paths.push(data.originalPath);
  if (data.hlsMasterPath) {
    // Delete HLS directory prefix (master + all variant segments)
    const prefix = data.hlsMasterPath.replace(/\/master\.m3u8$/, "");
    // List and delete via Supabase: we don't have list API here, so delete known files
    // Fallback: try to delete master + fallback segments pattern; worker stores segments under hls/{h}p/
    for (const r of data.renditions || []) if (r.path) paths.push(r.path);
    // Also try to delete segment files via prefix delete (handled server-side by deleteChatFile with prefix)
    try {
      // Supabase doesn't support prefix delete via deleteChatFile single path; attempt bulk via storage API if available
      // For now delete known top-level derived assets; segment cleanup is best-effort via worker expiry job
      paths.push(data.hlsMasterPath);
    } catch {}
  }
  if (data.fallbackPath) paths.push(data.fallbackPath);
  if (data.posterPath) paths.push(data.posterPath);
  if (data.previewPath) paths.push(data.previewPath);
  if (data.cardPreviewPath) paths.push(data.cardPreviewPath);
  // Legacy single mediaURL cleanup
  if (data.mediaURL) {
    const p = extractStoragePath(data.mediaURL);
    if (p) paths.push(p);
  }
  if (data.bgAudioURL) {
    const p = extractStoragePath(data.bgAudioURL);
    if (p) paths.push(p);
  }
  for (const p of paths) {
    if (!p) continue;
    try { await deleteChatFile(p); } catch {}
    // Also try HLS segment prefix cleanup: list objects under prefix and delete
    if (p.includes("/hls/")) {
      try {
        const prefix = p.split("/hls/")[0] + "/hls/";
        // Best-effort: list via Supabase storage (requires service role; client may not have). Ignore errors.
        const { data: list } = await import("../supabase/config.js").then((m) => m.supabase.storage.from("chat-media").list(prefix, { limit: 1000 }).catch(() => ({ data: null })));
        if (list) for (const f of list) await deleteChatFile(`${prefix}${f.name}`).catch(() => {});
      } catch {}
    }
  }
}

// Delete a single expired status: wipe all associated assets (original + HLS + fallback + poster/preview) then doc
async function cleanupExpiredDoc(docSnap) {
  const data = docSnap.data();
  try { await deleteStatusAssets(data); } catch {}
  await deleteDoc(docSnap.ref);
}

// Batch-delete all of a user's expired statuses (called on mount).
// Also removes the associated media files from Supabase storage.
export async function purgeExpiredStatuses(ownerId) {
  const q = query(
    collection(db, "status"),
    where("ownerId", "==", ownerId),
    where("expiresAt", "<=", new Date()),
  );
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => cleanupExpiredDoc(d)));
}

// Live stream of statuses the viewer is allowed to see.
//
// Visibility model (enforced by firestore.rules):
//   • owner's own statuses
//   • public statuses (visibility == "public")
//   • statuses whose `allowedUids` array contains the viewer (owner + accepted
//     contacts + explicitly-selected contacts)
//
// We query `allowedUids array-contains viewer` — a single-field, provably
// readable query. (A per-document contact check would make the query
// unprovable and Firestore would deny it.) Excluded viewers are filtered
// client-side (same trust model as other client-enforced limits).
//
// `uids` selects scope:
//   • feed (uids includes myUid): every status I may see (own + contacts').
//   • single other uid (profile): only that owner's statuses I may see.
export function useStatuses(uids, myUid) {
  const [statuses, setStatuses] = useState([]);
  const deletingRef = useRef(new Set());
  const safeUids = (uids || []).filter(Boolean);
  const isFeed = safeUids.includes(myUid);
  const key = `${myUid || ""}|${safeUids.join(",")}`;

  useEffect(() => {
    if (!myUid) { setStatuses([]); return; }
    if (safeUids.length === 0 && !isFeed) { setStatuses([]); return; }

    const q = query(collection(db, "status"), where("allowedUids", "array-contains", myUid));
    const unsub = onSnapshot(q, (snap) => {
      const now = Date.now();
      const results = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        const expMs = data.expiresAt?.toMillis?.() || 0;
        if (expMs && expMs < now) {
          if (!deletingRef.current.has(d.id)) {
            deletingRef.current.add(d.id);
            cleanupExpiredDoc(d).catch(() => {});
          }
          return;
        }
        // Profile scope: only the requested owner's statuses.
        if (!isFeed && !safeUids.includes(data.ownerId)) return;
        // Per-status exclusion (server-enforced for public; here for contacts).
        if ((data.excludedUids || []).includes(myUid)) return;
        results.push({ id: d.id, ...data, ownerId: data.ownerId });
      });
      results.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setStatuses(results);
    }, (err) => {
      console.warn("[useStatuses] snapshot error:", err.message);
    });

    return () => unsub();
  }, [key, myUid, isFeed]);

  return statuses;
}

// Flip a status's visibility between "contacts" and "public".
export async function updateStatusVisibility(statusId, visibility) {
  await setDoc(doc(db, "status", statusId), { visibility: visibility === "public" ? "public" : "contacts" }, { merge: true });
}

// One-time status extension. Adds 10 hours to the (current) expiry and marks the
// status as extended so it can never be extended again. Only the owner may call
// this (enforced by the status update rule). extendWindowMs controls how long
// before expiry the EXTEND control becomes visible.
export const STATUS_EXTEND_WINDOW_MS = 6 * 60 * 60 * 1000;
export const STATUS_EXTEND_MS = 10 * 60 * 60 * 1000;

export function canExtendStatus(status, now = Date.now()) {
  if (!status) return false;
  if (status.extended) return false;
  const expMs = status.expiresAt?.toMillis ? status.expiresAt.toMillis() : 0;
  if (!expMs) return false;
  return now >= expMs - STATUS_EXTEND_WINDOW_MS;
}

export async function extendStatus(statusId, additionalMs = STATUS_EXTEND_MS) {
  const ref = doc(db, "status", statusId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Status not found.");
  const data = snap.data();
  const expMs = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : Date.now();
  const newExpiry = new Date(expMs + additionalMs);
  await setDoc(ref, { expiresAt: newExpiry, extended: true }, { merge: true });
  return newExpiry;
}

// Public statuses: any status the poster marked visibility:"public". Used by the
// separate "Public Statuses" tab. Single-field equality query (no composite index
// needed); client-side expiry filtering mirrors useStatuses.
export function usePublicStatuses(myUid) {
  const [statuses, setStatuses] = useState([]);
  const deletingRef = useRef(new Set());
  useEffect(() => {
    const q = query(collection(db, "status"), where("visibility", "==", "public"));
    const unsub = onSnapshot(q, (snap) => {
      const now = Date.now();
      const results = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        const expMs = data.expiresAt?.toMillis?.() || 0;
        if (expMs && expMs < now) {
          if (!deletingRef.current.has(d.id)) {
            deletingRef.current.add(d.id);
            cleanupExpiredDoc(d).catch(() => {});
          }
          return;
        }
        // Client-side exclusion (server rule is provable for visibility==public;
        // per-status exclusions are enforced here to match the Updates feed).
        if (myUid && (data.excludedUids || []).includes(myUid)) return;
        results.push({ id: d.id, ...data, ownerId: data.ownerId });
      });
      setStatuses(results.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)));
    }, (err) => console.warn("[usePublicStatuses] snapshot error:", err?.message));
    return () => unsub();
  }, [myUid]);
  return statuses;
}
export function useActiveStatusUids(uids) {
  const [active, setActive] = useState(new Set());
  const safeUidsKey = (uids || []).filter(Boolean).join(",");

  useEffect(() => {
    const safeUids = safeUidsKey ? safeUidsKey.split(",").filter(Boolean) : [];
    if (safeUids.length === 0) { setActive(new Set()); return; }
    const chunks = [];
    for (let i = 0; i < safeUids.length; i += 30) chunks.push(safeUids.slice(i, i + 30));

    let useFallback = false;
    function subscribeWithQuery(compound) {
      return chunks.map((chunk) => {
        const q = compound
          ? query(collection(db, "status"),
              where("ownerId", "in", chunk),
              where("expiresAt", ">", new Date()))
          : query(collection(db, "status"),
              where("ownerId", "in", chunk));
        return onSnapshot(q, (snap) => {
          const now = Date.now();
          setActive((prev) => {
            const next = new Set(prev);
            chunk.forEach((uid) => {
              const hasActive = snap.docs.some((d) => {
                const data = d.data();
                if (data.ownerId !== uid) return false;
                const expMs = data.expiresAt?.toMillis?.() || 0;
                return !expMs || expMs >= now;
              });
              if (hasActive) next.add(uid); else next.delete(uid);
            });
            return next;
          });
        }, (err) => {
          if (compound && !useFallback) {
            useFallback = true;
          } else {
            console.warn("[useActiveStatusUids] snapshot error:", err.message);
          }
        });
      });
    }

    let unsubs = subscribeWithQuery(true);
    const fallbackCheck = setInterval(() => {
      if (useFallback) {
        unsubs.forEach((fn) => fn());
        unsubs = subscribeWithQuery(false);
      }
    }, 500);

    return () => {
      clearInterval(fallbackCheck);
      unsubs.forEach((fn) => fn());
    };
  }, [safeUidsKey]);

  return active;
}

// ── Subscriptions ─────────────────────────────────────────────
// A user can subscribe to another user's status updates. Subscription state lives
// in status/{statusId}/subscribers/{uid} (one doc per subscriber) plus a
// denormalized subscriberCount on the status doc. The owner and admins can read
// the subscriber list; ordinary users cannot (enforced in firestore.rules).
export async function subscribeStatus(statusId, uid) {
  if (!statusId || !uid) return;
  const ref = doc(db, "status", statusId, "subscribers", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return; // already subscribed — no duplicate
  await setDoc(ref, { uid, subscribedAt: serverTimestamp() }, { merge: true });
  await setDoc(doc(db, "status", statusId), { subscriberCount: increment(1) }, { merge: true });
}

export async function unsubscribeStatus(statusId, uid) {
  if (!statusId || !uid) return;
  const ref = doc(db, "status", statusId, "subscribers", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return; // already unsubscribed
  await deleteDoc(ref);
  await setDoc(doc(db, "status", statusId), { subscriberCount: increment(-1) }, { merge: true });
}

export async function isSubscribedStatus(statusId, uid) {
  if (!statusId || !uid) return false;
  const snap = await getDoc(doc(db, "status", statusId, "subscribers", uid));
  return snap.exists();
}

// Live subscription state for a single viewer. `defaultOn` (from the viewer's
// global status-notification setting) makes the UI show "Subscribed" until the
// viewer explicitly unsubscribes. When defaultOn is true we lazily create the
// subscription doc so the choice persists and the count is accurate.
export function useStatusSubscription(statusId, uid, defaultOn = false) {
  const [subscribed, setSubscribed] = useState(!!defaultOn);
  useEffect(() => {
    if (!statusId || !uid) { setSubscribed(!!defaultOn); return; }
    let created = false;
    const ref = doc(db, "status", statusId, "subscribers", uid);
    const unsub = onSnapshot(ref, (s) => {
      if (s.exists()) {
        setSubscribed(true);
      } else if (defaultOn && !created) {
        // First view with notifications enabled → auto-subscribe persistently.
        created = true;
        setDoc(ref, { uid, subscribedAt: serverTimestamp() }, { merge: true }).catch(() => {});
        // Keep the denormalized count accurate (mirrors subscribeStatus) so the
        // owner's subscriber count reflects auto-subscribers and unsubscribe
        // cannot drive the count negative.
        setDoc(doc(db, "status", statusId), { subscriberCount: increment(1) }, { merge: true }).catch(() => {});
        setSubscribed(true);
      } else {
        setSubscribed(false);
      }
    }, () => setSubscribed(false));
    return unsub;
  }, [statusId, uid, defaultOn]);
  return subscribed;
}

export async function getSubscriberUids(statusId) {
  if (!statusId) return [];
  const snap = await getDocs(collection(db, "status", statusId, "subscribers"));
  return snap.docs.map((d) => d.id);
}

export async function getSubscriberCount(statusId) {
  const snap = await getDoc(doc(db, "status", statusId));
  return snap.exists() ? (snap.data().subscriberCount || 0) : 0;
}

// ── Creator-level subscriptions ──────────────────────────────
// Subscription is to the CREATOR, not to an individual status.
// Stored in statusSubscriptions/{creatorUid}/subscribers/{uid}.
// This ensures: subscribing on ANY of A's statuses subscribes you to A,
// and you stay subscribed across all future statuses A posts.
const CREATOR_SUB_COL = "statusSubscriptions";

export async function subscribeToCreator(creatorUid, uid) {
  if (!creatorUid || !uid) return;
  if (creatorUid === uid) return; // can't subscribe to yourself
  const ref = doc(db, CREATOR_SUB_COL, creatorUid, "subscribers", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return; // already subscribed
  await setDoc(ref, { uid, subscribedAt: serverTimestamp() }, { merge: true });
}

export async function unsubscribeFromCreator(creatorUid, uid) {
  if (!creatorUid || !uid) return;
  const ref = doc(db, CREATOR_SUB_COL, creatorUid, "subscribers", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return; // already unsubscribed
  await deleteDoc(ref);
}

export async function isSubscribedToCreator(creatorUid, uid) {
  if (!creatorUid || !uid) return false;
  const snap = await getDoc(doc(db, CREATOR_SUB_COL, creatorUid, "subscribers", uid));
  return snap.exists();
}

// Live subscription state for a creator (replaces per-status useStatusSubscription).
export function useCreatorSubscription(creatorUid, uid) {
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    if (!creatorUid || !uid) { setSubscribed(false); return; }
    const ref = doc(db, CREATOR_SUB_COL, creatorUid, "subscribers", uid);
    const unsub = onSnapshot(ref, (s) => {
      setSubscribed(s.exists());
    }, () => setSubscribed(false));
    return unsub;
  }, [creatorUid, uid]);
  return subscribed;
}

export async function getCreatorSubscriberUids(creatorUid) {
  if (!creatorUid) return [];
  const snap = await getDocs(collection(db, CREATOR_SUB_COL, creatorUid, "subscribers"));
  return snap.docs.map((d) => d.id);
}

export async function getCreatorSubscriberCount(creatorUid) {
  if (!creatorUid) return 0;
  const snap = await getDocs(collection(db, CREATOR_SUB_COL, creatorUid, "subscribers"));
  return snap.size;
}

// ── View Tracking ─────────────────────────────────────────────

// Record that a viewer has seen a status (idempotent — overwrites timestamp).
export async function viewStatus(statusId, viewerUid) {
  if (!statusId || !viewerUid) return;
  await setDoc(
    doc(db, "status", statusId, "views", viewerUid),
    { viewerUid, viewedAt: serverTimestamp() },
    { merge: true },
  );
}

// Live listener: returns array of { viewerUid, viewedAt } for a status.
export function useStatusViewers(statusId) {
  const [viewers, setViewers] = useState([]);

  useEffect(() => {
    if (!statusId) { setViewers([]); return; }
    const q = query(collection(db, "status", statusId, "views"));
    const unsub = onSnapshot(q, (snap) => {
      setViewers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.warn("[useStatusViewers] snapshot error:", err.message);
    });
    return unsub;
  }, [statusId]);

  return viewers;
}

// ── Status comments ──
// Comments live in status/{statusId}/comments. Each comment: { uid, text, createdAt, up:[], down:[] }.
export async function addStatusComment(statusId, uid, text) {
  const trimmed = (text || "").trim();
  if (!statusId || !uid || !trimmed) return null;
  const ref = await addDoc(collection(db, "status", statusId, "comments"), {
    uid,
    text: trimmed,
    createdAt: serverTimestamp(),
    up: [],
    down: [],
  });
  await setDoc(doc(db, "status", statusId), { commentCount: increment(1) }, { merge: true });
  return ref.id;
}

export async function deleteStatusComment(statusId, commentId, uid) {
  if (!statusId || !commentId) return;
  await deleteDoc(doc(db, "status", statusId, "comments", commentId));
  await setDoc(doc(db, "status", statusId), { commentCount: increment(-1) }, { merge: true });
}

// dir: "up" | "down". Toggles the voter's id in the matching array and removes
// it from the opposite one (one vote per user, never on your own comment).
export async function voteStatusComment(statusId, commentId, uid, dir) {
  if (!statusId || !commentId || !uid) return;
  const ref = doc(db, "status", statusId, "comments", commentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.uid === uid) return; // can't vote on your own
  const up = new Set(data.up || []);
  const down = new Set(data.down || []);
  if (dir === "up") {
    if (up.has(uid)) up.delete(uid); else { up.add(uid); down.delete(uid); }
  } else {
    if (down.has(uid)) down.delete(uid); else { down.add(uid); up.delete(uid); }
  }
  await setDoc(ref, { up: Array.from(up), down: Array.from(down) }, { merge: true });
}

export function subscribeStatusComments(statusId, cb) {
  if (!statusId) { cb([]); return () => {}; }
  const q = query(collection(db, "status", statusId, "comments"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.warn("[subscribeStatusComments] error:", err.message));
}

export async function setStatusCommentsHidden(statusId, hidden) {
  if (!statusId) return;
  await setDoc(doc(db, "status", statusId), { commentsHidden: !!hidden }, { merge: true });
}

export async function retryStatus(statusId) {
  if (!statusId) return;
  await setDoc(doc(db, "status", statusId), { state: STATUS_STATES.QUEUED, errorCode: null, errorMessage: null }, { merge: true });
}
