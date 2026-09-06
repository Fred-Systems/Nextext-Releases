// Admin Panel lock (PIN) — stored ONLY as a SHA-256 hash in Firestore
// config/globalSettings.adminPanelPinHash. Never plaintext, never localStorage.
// The admin identity itself is server-side (users/{uid}.role === "admin") and
// persists across restarts; this PIN is an extra gate before entering the panel.
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./config";

const CONFIG_PATH = ["config", "globalSettings"];

export async function hashPin(pin) {
  const data = new TextEncoder().encode(String(pin));
  if (!crypto?.subtle) {
    // Extremely old WebView without WebCrypto: use a simple non-crypto fallback
    // (still not plaintext, but weaker). Modern devices all support subtle.
    let h = 5381;
    for (const b of data) h = ((h << 5) + h + b) >>> 0;
    return `djb2:${h.toString(16)}`;
  }
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setAdminPanelPinHash(pin, adminUid) {
  const clean = String(pin || "").trim();
  if (!clean) {
    // Empty PIN clears the lock entirely.
    await setDoc(doc(db, ...CONFIG_PATH), { adminPanelPinHash: null }, { merge: true });
    return true;
  }
  const hash = await hashPin(clean);
  await setDoc(doc(db, ...CONFIG_PATH), { adminPanelPinHash: hash, updatedBy: adminUid || null, updatedAt: new Date() }, { merge: true });
  return true;
}

export async function getAdminPanelPinHash() {
  const snap = await getDoc(doc(db, ...CONFIG_PATH));
  return snap.exists() ? snap.data()?.adminPanelPinHash || null : null;
}

export async function verifyAdminPanelPin(pin) {
  const stored = await getAdminPanelPinHash();
  if (!stored) return true; // no PIN configured → no lock
  const hash = await hashPin(pin);
  return hash === stored;
}
