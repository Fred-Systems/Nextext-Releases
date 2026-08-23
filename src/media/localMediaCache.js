// Device-local media cache for the "WhatsApp-style" auto-delete feature.
//
// When the admin enables `mediaAutoDelete`, chat media is pulled from Supabase
// on-demand and stored on the device (inside the app's WebView IndexedDB, which
// is persistent across app restarts on both web and native). After a recipient
// downloads a 1:1 message the server copy is removed from Supabase, so the only
// surviving copy is the one we keep here. We serve it via an object URL.
//
// NOTE: object URLs are per-session, so we recreate them from the stored Blob on
// each app launch (see getLocalMediaUrl). The Blob itself lives in IndexedDB.

const DB_NAME = "nextext-media-cache";
const STORE = "blobs";
const DB_VERSION = 1;

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Memo of msgId -> object URL so we don't recreate object URLs every render.
const urlMemo = {};

export async function cacheMedia(msgId, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, msgId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function hasCachedMedia(msgId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(msgId);
    req.onsuccess = () => resolve(req.result != null);
    req.onerror = () => reject(req.error);
  });
}

export async function getLocalMediaUrl(msgId) {
  if (urlMemo[msgId]) return urlMemo[msgId];
  const db = await openDb();
  const blob = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(msgId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlMemo[msgId] = url;
  return url;
}
