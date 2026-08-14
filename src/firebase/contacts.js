import { useState, useEffect } from "react";
import {
  collection, query, where, getDocs, doc, setDoc, onSnapshot,
  serverTimestamp, limit as fbLimit,
} from "firebase/firestore";
import { db } from "./config";

// Get the display name for a contact: nickname if set, otherwise real name from profile
export function getContactDisplayName(contact) {
  if (!contact) return null;
  // If contact has a nickname set, use it
  if (contact.nickname && contact.nickname.trim()) return contact.nickname.trim();
  // Otherwise fall back to profile displayName or username
  return contact.profile?.displayName || contact.profile?.username || null;
}

// Get the real name (from profile) for a contact, ignoring nickname
export function getContactRealName(contact) {
  if (!contact) return null;
  return contact.profile?.displayName || contact.profile?.username || null;
}

// Search users by username prefix — powers "add contact" and admin search.
export async function searchUsersByUsername(prefix) {
  if (!prefix.trim()) return [];
  const lower = prefix.toLowerCase();
  const q = query(
    collection(db, "users"),
    where("usernameLower", ">=", lower),
    where("usernameLower", "<=", lower + "\uf8ff"),
    fbLimit(10)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// Sends a contact request: creates a "pending" doc on the target's side,
// and an "accepted"-once-they-accept doc mirrored back on your side.
export async function sendContactRequest(myUid, theirUid) {
  await setDoc(doc(db, "users", theirUid, "contacts", myUid), {
    addedAt: serverTimestamp(),
    nickname: null,
    status: "pending",
    blocked: false,
    mutedUntil: null,
    favorite: false,
    customAppearance: { photoURL: null, color: null },
  });
  await setDoc(doc(db, "users", myUid, "contacts", theirUid), {
    addedAt: serverTimestamp(),
    nickname: null,
    status: "pending",
    blocked: false,
    mutedUntil: null,
    favorite: false,
    customAppearance: { photoURL: null, color: null },
  });
}

export async function acceptContactRequest(myUid, theirUid) {
  await setDoc(doc(db, "users", myUid, "contacts", theirUid), { status: "accepted" }, { merge: true });
  await setDoc(doc(db, "users", theirUid, "contacts", myUid), { status: "accepted" }, { merge: true });
}

// Update the nickname for a contact (local display name override)
export async function setContactNickname(myUid, theirUid, nickname) {
  const ref = doc(db, "users", myUid, "contacts", theirUid);
  await setDoc(ref, { nickname: nickname || null }, { merge: true });
}

// Local cache of the last-known contact list so the chat list can paint
// instantly on relaunch instead of waiting on Firestore. Refreshed on every
// snapshot; keyed by uid.
const contactsCacheKey = (myUid) => `nextext_contacts_${myUid}`;

function loadContactsCache(myUid) {
  try {
    const raw = localStorage.getItem(contactsCacheKey(myUid));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

function saveContactsCache(myUid, rows) {
  try {
    localStorage.setItem(contactsCacheKey(myUid), JSON.stringify(rows));
  } catch { /* cache is best-effort */ }
}

// Live list of this user's accepted contacts, with their profile data joined in.
export function useContacts(myUid) {
  const [contacts, setContacts] = useState(() => loadContactsCache(myUid));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!myUid) return;
    const ref = collection(db, "users", myUid, "contacts");
    const unsub = onSnapshot(ref, async (snap) => {
      const rows = await Promise.all(
        snap.docs.map(async (d) => {
          const contactData = d.data();
          const profileSnap = await getDocs(
            query(collection(db, "users"), where("__name__", "==", d.id))
          );
          const profile = profileSnap.docs[0]?.data() || {};
          return { uid: d.id, ...contactData, profile };
        })
      );
      setContacts(rows);
      saveContactsCache(myUid, rows);
      setLoading(false);
    });
    return unsub;
  }, [myUid]);

  return { contacts, loading };
}
