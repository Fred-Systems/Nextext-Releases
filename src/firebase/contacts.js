import { useState, useEffect } from "react";
import {
  collection, query, where, getDocs, doc, setDoc, onSnapshot,
  serverTimestamp, limit as fbLimit,
} from "firebase/firestore";
import { db } from "./config";
import { getOrCreateDirectChat } from "./chats";

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
// In addition to the always-searchable `usernameLower`, it also matches the
// per-user opt-in index fields (searchDisplayName / searchEmail / searchPhone)
// which only exist on a user's doc when they allowed discovery by that field.
// `exactUsername` narrows username discovery to a full (not prefix) match.
export async function searchUsersByUsername(prefix, opts = {}) {
  if (!prefix.trim()) return [];
  const lower = prefix.toLowerCase();
  const exactUsername = !!opts.exactUsername;
  const results = new Map();
  const add = (snap) => {
    snap.docs.forEach((d) => { if (!results.has(d.id)) results.set(d.id, { uid: d.id, ...d.data() }); });
  };

  // Username is always searchable. When exactUsername is requested, only an
  // exact match counts; otherwise a prefix (smart) range.
  const usernameQ = exactUsername
    ? query(collection(db, "users"), where("usernameLower", "==", lower), fbLimit(10))
    : query(collection(db, "users"), where("usernameLower", ">=", lower), where("usernameLower", "<=", lower + "\uf8ff"), fbLimit(10));
  try { add(await getDocs(usernameQ)); } catch {}

   // Smart (prefix) search across opt-in fields — only when not in
   // exact-username-only mode (that mode intentionally limits discovery to the
   // full handle).
   if (!exactUsername) {
     const fieldQueries = [
       query(collection(db, "users"), where("searchDisplayName", ">=", lower), where("searchDisplayName", "<=", lower + "\uf8ff"), fbLimit(10)),
       query(collection(db, "users"), where("searchEmail", ">=", lower), where("searchEmail", "<=", lower + "\uf8ff"), fbLimit(10)),
     ];
     // Phone search: normalize so a leading "1" (or "+") doesn't prevent a
     // match. A stored searchPhone may be "+15551234567" or "15551234567"; a
     // user might type "5551234567" or "15551234567". Try every sensible form.
     const digits = lower.replace(/[^\d]/g, "");
     const phoneVariants = [];
     if (digits.length >= 7) {
       const seen = new Set();
       const push = (v) => { if (v && !seen.has(v)) { seen.add(v); phoneVariants.push(v); } };
       push(digits);
       push("+" + digits);
       if (digits.startsWith("1") && digits.length === 11) { push(digits.slice(1)); push("+" + digits.slice(1)); }
       if (digits.length === 10) { push("1" + digits); push("+1" + digits); }
     }
     phoneVariants.forEach((v) => {
       fieldQueries.push(query(collection(db, "users"), where("searchPhone", ">=", v), where("searchPhone", "<=", v + "\uf8ff"), fbLimit(10)));
     });
     await Promise.all(fieldQueries.map((q) => getDocs(q).then(add).catch(() => {})));
   }

  let list = Array.from(results.values());
  // If a returned user has opted into "exact username only", drop them unless
  // the typed query equals their full username.
  if (exactUsername === false) {
    list = list.filter((u) => !(u.searchExactUsername && u.usernameLower !== lower));
  }
  return list.slice(0, 20);
}

// Sends a contact request: creates a "pending" doc on the target's side,
// and an "accepted"-once-they-accept doc mirrored back on your side.
export async function sendContactRequest(myUid, theirUid) {
  // Primary write: a "pending" doc into the RECIPIENT's contacts subcollection so
  // they see the incoming request. Allowed by the Firestore rule
  // `match /users/{uid}/contacts/{contactUid} { allow create: if isSelf(contactUid) && status == 'pending' }`.
  try {
    await setDoc(doc(db, "users", theirUid, "contacts", myUid), {
      addedAt: serverTimestamp(),
      nickname: null,
      status: "pending",
      blocked: false,
      mutedUntil: null,
      favorite: false,
      customAppearance: { photoURL: null, color: null },
    }, { merge: true });
  } catch (e) {
    console.error("[sendContactRequest] recipient write failed:", e?.code, e?.message);
    // Surface the real Firestore error so the UI can show "Missing or insufficient permissions" clearly.
    throw new Error(e?.message || "Could not send request to recipient");
  }
  // Best-effort mirror: a "pending" doc on our own side so we can show the request
  // as pending. Allowed by `allow write: if isSelf(uid)`. If this fails for any
  // reason it must NOT abort the request — the recipient already has the pending doc.
  try {
    await setDoc(doc(db, "users", myUid, "contacts", theirUid), {
      addedAt: serverTimestamp(),
      nickname: null,
      status: "pending",
      blocked: false,
      mutedUntil: null,
      favorite: false,
      customAppearance: { photoURL: null, color: null },
    }, { merge: true });
  } catch (e) {
    console.warn("[sendContactRequest] own mirror write failed (non-fatal):", e?.code, e?.message);
  }
}

export async function acceptContactRequest(myUid, theirUid) {
  await setDoc(doc(db, "users", myUid, "contacts", theirUid), { status: "accepted" }, { merge: true });
  await setDoc(doc(db, "users", theirUid, "contacts", myUid), { status: "accepted" }, { merge: true });
  // Recreate the 1-on-1 chat if it was previously deleted — otherwise the
  // freshly accepted contact has no chat to appear in and messages from them
  // can't surface. getOrCreateDirectChat is a no-op when the chat already exists.
  try { getOrCreateDirectChat(myUid, theirUid); } catch { /* non-fatal */ }
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
    const rows = JSON.parse(raw);
    // Cache must obey the same accepted-only rule as the live query — older
    // caches may contain pending/stray docs from before the filter existed.
    return Array.isArray(rows) ? rows.filter((r) => r && r.status === "accepted") : [];
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
      // PRIVACY: only ACCEPTED contacts belong in the contact list. The
      // subcollection also holds "pending" docs — both incoming requests and
      // the sender-side mirror of a request the recipient hasn't accepted.
      // Including those made "start a chat with someone" silently appear as a
      // contact on the other side (any request path creates a pending doc on
      // both ends, so merely opening a conversation leaked into contacts).
      // Pending requests are handled by their own request UI, never here.
      const acceptedDocs = snap.docs.filter((d) => d.data()?.status === "accepted");
      const rows = await Promise.all(
        acceptedDocs.map(async (d) => {
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
