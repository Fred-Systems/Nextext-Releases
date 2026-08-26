import { useState, useEffect, useRef } from "react";
import {
  collection, query, where, onSnapshot, addDoc,
  deleteDoc, doc, serverTimestamp, getDocs, setDoc,
} from "firebase/firestore";
import { db } from "./config";
import { deleteChatFile } from "../supabase/media";

const STATUS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function postStatus(ownerId, {
  text = null,
  mediaURL = null,
  mediaType = null,
  backgroundColor = null,
  fontFamily = null,
  durationMs = null,
  textOverlay = null,
  bgAudioURL = null,
  bgAudioVolume = null,
  videoVolume = null,
  waitForVideo = false,
  allowDownload = false,
}) {
  await addDoc(collection(db, "status"), {
    ownerId,
    text,
    mediaURL,
    mediaType,
    backgroundColor,
    fontFamily,
    durationMs,
    textOverlay,
    bgAudioURL,
    bgAudioVolume,
    videoVolume,
    waitForVideo,
    allowDownload,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + STATUS_TTL_MS),
  });
}

export async function deleteStatus(statusId) {
  await deleteDoc(doc(db, "status", statusId));
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

// Delete a single expired status: wipe the Supabase media file (if any)
// then remove the Firestore document.
async function cleanupExpiredDoc(docSnap) {
  const data = docSnap.data();
  if (data?.mediaURL) {
    try {
      const path = extractStoragePath(data.mediaURL);
      if (path) await deleteChatFile(path);
    } catch { /* storage already gone or RLS block — ignore */ }
  }
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

// Returns a Set of UIDs that have at least one active status.
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
