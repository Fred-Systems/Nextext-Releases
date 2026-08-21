import { doc, getDoc, updateDoc, deleteField, query, where, getDocs, collection } from "firebase/firestore";
import { db } from "./config";

// Updates a user's display name + username (optionally phone). Pushes the
// PREVIOUS names onto the user's nameHistory so admins can see every name a
// user has ever had, and so chats can reflect "what it used to be". Marks the
// profile complete so the user can proceed past the profile-completion screen.
export async function changeNames(uid, { username, displayName, phone }) {
  if (!uid) throw new Error("Not signed in.");
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? snap.data() : {};
  const historyEntry = {
    displayName: cur.displayName || null,
    username: cur.username || null,
    // Firestore does not allow serverTimestamp() inside array elements, so the
    // entry uses a client timestamp (serialized as a Firestore Timestamp).
    changedAt: new Date(),
  };
  const nameHistory = Array.isArray(cur.nameHistory)
    ? [...cur.nameHistory, historyEntry]
    : (cur.displayName || cur.username ? [historyEntry] : []);

  const update = {
    username,
    usernameLower: String(username || "").toLowerCase(),
    displayName,
    nameHistory,
    profileComplete: true,
  };
  if (phone && String(phone).trim()) {
    const digits = String(phone).replace(/[^\d+]/g, "");
    update.phoneNumber = String(phone).trim();
    update.phoneNumberNormalized = digits || null;
  }
  // Keep the display-name search index in sync with the user's chosen
  // visibility. If they allow discovery by display name we (re)publish the
  // lowercased name; otherwise we strip the searchable copy so searches can't
  // surface them by name.
  const vis = cur.searchVisibility || {};
  if (vis.displayName && displayName) update.searchDisplayName = String(displayName).toLowerCase();
  else update.searchDisplayName = deleteField();
  await updateDoc(ref, update);
}

// Controls which fields other users can find this account by when they search.
// `username` is ALWAYS searchable (it's the account's primary handle). The
// returned object is stored as `searchVisibility` on the user doc. We mirror
// the enabled fields into dedicated index fields (searchDisplayName / searchEmail
// / searchPhone) — they only exist when the user opted in, so a search that
// queries them simply never matches users who disabled that field.
export async function updateSearchVisibility(uid, { displayName, email, number, exactUsername }) {
  if (!uid) throw new Error("Not signed in.");
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? snap.data() : {};
  const update = {
    searchVisibility: {
      displayName: !!displayName,
      email: !!email,
      number: !!number,
      exactUsername: !!exactUsername,
    },
  };
  // (Re)publish or strip each searchable field based on the new choices.
  if (displayName && cur.displayName) update.searchDisplayName = String(cur.displayName).toLowerCase();
  else update.searchDisplayName = deleteField();
  if (email && cur.email) update.searchEmail = String(cur.email).toLowerCase();
  else update.searchEmail = deleteField();
  if (number && (cur.phoneNumberNormalized || cur.phoneNumber)) {
    update.searchPhone = (cur.phoneNumberNormalized || String(cur.phoneNumber)).replace(/[^\d+]/g, "");
  } else update.searchPhone = deleteField();
  await updateDoc(ref, update);
  return update.searchVisibility;
}

// True when the user is globally or individually blocked from changing their
// name. globalSettings.blockNameSwitching (admin, app-wide) hides/prevents it
// for everyone; restrictions.blockNameChange (admin, per-user) blocks one user.
export function isNameChangeBlocked(userDoc, globalSettings) {
  if (globalSettings?.blockNameSwitching === true) return true;
  if (userDoc?.restrictions?.blockNameChange === true) return true;
  return false;
}

// Returns true when no OTHER user already uses the given username.
export async function isUsernameAvailable(username, excludeUid) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return false;
  const q = query(collection(db, "users"), where("usernameLower", "==", normalized));
  const snap = await getDocs(q);
  return !snap.docs.some((d) => d.id !== excludeUid);
}
