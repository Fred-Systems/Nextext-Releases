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
  // New-builder video trims/filters (metadata only — enforced by the viewer):
  // trimStart/trimEnd in seconds (null = no trim), videoFilter as a CSS filter
  // string applied to the <video> element (null = none).
  trimStart = null,
  trimEnd = null,
  videoFilter = null,
}) {
  const isVideo = mediaType === "video";
  const usePipeline = isVideo && originalPath;
  await addDoc(collection(db, "status"), {
    ownerId,
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
    trimStart: trimStart != null ? Number(trimStart) : null,
    trimEnd: trimEnd != null ? Number(trimEnd) : null,
    videoFilter: videoFilter || null,
  });
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

// Live stream of active (not-expired) statuses from a list of user UIDs.
// Tries the compound (ownerId + expiresAt) query first. If the composite
// index hasn't finished building yet, silently falls back to a simple
// ownerId-only query and filters expired docs client-side.
export function useStatuses(uids) {
  const [statuses, setStatuses] = useState([]);
  const deletingRef = useRef(new Set());
  const safeUidsKey = (uids || []).filter(Boolean).join(",");

  useEffect(() => {
    const safeUids = safeUidsKey ? safeUidsKey.split(",").filter(Boolean) : [];
    if (safeUids.length === 0) { setStatuses([]); return; }

    let useFallback = false;
    const chunks = [];
    for (let i = 0; i < safeUids.length; i += 30) chunks.push(safeUids.slice(i, i + 30));

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
          const results = [];
          snap.docs.forEach((d) => {
            const data = d.data();
            // client-side expiry guard (always, but only matters for fallback)
            const expMs = data.expiresAt?.toMillis?.() || 0;
            if (expMs && expMs < now) {
              // Fire-and-forget: delete the doc + its Supabase media file
              if (!deletingRef.current.has(d.id)) {
                deletingRef.current.add(d.id);
                cleanupExpiredDoc(d).catch(() => {});
              }
              return;
            }
            results.push({ id: d.id, ...data, ownerId: data.ownerId });
          });
          setStatuses((prev) => {
            // Merge across chunks: replace entries owned by this chunk's UIDs
            const chunkSet = new Set(chunk);
            const kept = prev.filter((s) => !chunkSet.has(s.ownerId));
            return [...kept, ...results]
              .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
          });
        }, (err) => {
          if (compound && !useFallback) {
            // Compound query failed (probably missing index) — switch all
            // chunks to the simple ownerId-only query for the rest of this
            // effect cycle.
            console.warn("[useStatuses] compound query failed, using fallback:", err.message);
            useFallback = true;
          } else {
            console.warn("[useStatuses] snapshot error:", err.message);
          }
        });
      });
    }

    let unsubs = subscribeWithQuery(true);

    // Watch for fallback trigger: if useFallback flips, tear down and
    // resubscribe with simple queries.
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

  return statuses;
}

// Flip a status's visibility between "contacts" and "public".
export async function updateStatusVisibility(statusId, visibility) {
  await setDoc(doc(db, "status", statusId), { visibility: visibility === "public" ? "public" : "contacts" }, { merge: true });
}

// Public statuses: any status the poster marked visibility:"public". Used by the
// separate "Public Statuses" tab. Single-field equality query (no composite index
// needed); client-side expiry filtering mirrors useStatuses.
export function usePublicStatuses() {
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
        results.push({ id: d.id, ...data, ownerId: data.ownerId });
      });
      setStatuses(results.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)));
    }, (err) => console.warn("[usePublicStatuses] snapshot error:", err?.message));
    return () => unsub();
  }, []);
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
