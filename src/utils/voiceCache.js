// IndexedDB-backed cache for synthesized AI voice replies. Voice replies are
// kept here (keyed by message id) so they survive app reload / navigating away
// and only disappear when the chat is cleared (clearAllVoiceCache). This keeps a
// generated voice reply "in the chat until the user deletes the chat" without
// needing to upload every reply to storage or change Firestore write rules.
const DB_NAME = "nextext_voice_cache";
const STORE = "voices";
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no-indexeddb"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveVoiceBlob(msgId, blob) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, msgId);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}

export async function loadVoiceBlob(msgId) {
  try {
    const db = await openDB();
    const blob = await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(msgId);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return blob || null;
  } catch {
    return null;
  }
}

export async function clearAllVoiceCache() {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}
