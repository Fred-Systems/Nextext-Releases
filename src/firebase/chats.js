import { useState, useEffect } from "react";
import {
  collection, query, where, orderBy, onSnapshot, doc, setDoc, addDoc,
  serverTimestamp, updateDoc, arrayUnion, arrayRemove, getDoc, getDocs, writeBatch, deleteField, deleteDoc, increment,
} from "firebase/firestore";
import { db } from "./config";
import { deleteChatFile } from "../supabase/media";

// Deterministic chat id for 1:1 chats -- group chat ids are random (see
// createGroupChat below), direct chat ids are the two sorted uids joined.
function directChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export async function getOrCreateDirectChat(myUid, theirUid) {
  const chatId = directChatId(myUid, theirUid);
  const ref = doc(db, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const participants = myUid === theirUid ? [myUid] : [myUid, theirUid];
    const unreadCount = {};
    participants.forEach((uid) => { unreadCount[uid] = 0; });
    await setDoc(ref, {
      type: "direct",
      participants,
      createdAt: serverTimestamp(),
      createdBy: myUid,
      groupName: null,
      groupPhotoURL: null,
      groupAdmins: null,
      groupDescription: null,
      lastMessage: null,
      unreadCount,
      archivedBy: [],
      lockedBy: {},
      deletedForSelf: {},
      mutedBy: {},
      favoritedBy: [],
      typingUsers: {},
    });
  }
  return chatId;
}

// Groups: random chat id, 2+ participants, only accepted contacts of the
// creator can be added (enforced client-side by only offering accepted
// contacts in the picker UI -- see NewGroupScreen).
export async function createGroupChat(creatorUid, memberUids, groupName, options = {}) {
  const allParticipants = [creatorUid, ...memberUids];
  const ref = doc(collection(db, "chats"));
  const unreadCount = {};
  allParticipants.forEach((uid) => { unreadCount[uid] = 0; });
  await setDoc(ref, {
    type: "group",
    participants: allParticipants,
    createdAt: serverTimestamp(),
    createdBy: creatorUid,
    groupName,
    groupPhotoURL: options.groupPhotoURL || null,
    groupAdmins: [creatorUid],
    groupDescription: "",
    lastMessage: null,
    unreadCount,
    archivedBy: [],
    lockedBy: {},
    deletedForSelf: {},
    mutedBy: {},
    favoritedBy: [],
    typingUsers: {},
  });
  return ref.id;
}

// Live list of all chats this user participates in, newest activity first.
// Local cache of the last-known chat list so the chat list can paint instantly
// on relaunch instead of waiting on Firestore (mirrors the contacts cache).
// Refreshed on every snapshot; keyed by uid.
const chatsCacheKey = (myUid) => `nextext_chats_${myUid}`;

function loadChatsCache(myUid) {
  try {
    const raw = localStorage.getItem(chatsCacheKey(myUid));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

function saveChatsCache(myUid, rows) {
  try {
    localStorage.setItem(chatsCacheKey(myUid), JSON.stringify(rows));
  } catch { /* cache is best-effort */ }
}

export function useChats(myUid) {
  const [chats, setChats] = useState(() => loadChatsCache(myUid));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!myUid) return;
    const q = query(collection(db, "chats"), where("participants", "array-contains", myUid));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.lastMessage?.sentAt?.toMillis?.() || 0) - (a.lastMessage?.sentAt?.toMillis?.() || 0));
      setChats(rows);
      saveChatsCache(myUid, rows);
      setLoading(false);
    }, (err) => {
      console.warn("[useChats] snapshot error:", err?.message || err);
      setLoading(false);
    });
    return unsub;
  }, [myUid]);

  return { chats, loading };
}

// Live message stream for one chat, oldest first (for natural chat scroll order).
// Filters out messages scheduled for the future that haven't fired yet, and
// messages this user has individually deleted-for-self.
export function useMessages(chatId, myUid) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chatId) return;
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("sentAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const now = Date.now();
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((m) => {
          if (m.deletedForSelf?.includes(myUid)) return false;
          if (m.isScheduled && m.scheduledFor?.toMillis && m.scheduledFor.toMillis() > now) {
            // Only the sender can see their own not-yet-due scheduled message
            // (as a pending/preview state) -- everyone else simply doesn't
            // see it until it's due.
            return m.senderId === myUid;
          }
          return true;
        });
      setMessages(rows);
      setLoading(false);
    });
    return unsub;
  }, [chatId, myUid]);

  return { messages, loading };
}

// Snapshots the sender's current display name + username onto outgoing messages
// so that if the sender later renames, old messages keep showing the name they
// had at send time (chat history reflects "what it used to be").
export async function snapshotSenderName(senderUid) {
  try {
    const snap = await getDoc(doc(db, "users", senderUid));
    const d = snap.data();
    return { senderName: d?.displayName || null, senderUsername: d?.username || null };
  } catch {
    return { senderName: null, senderUsername: null };
  }
}

// Sends a text message and updates the chat's lastMessage preview + unread counts.
export async function sendTextMessage(chatId, senderUid, text, otherParticipants, options = {}) {
  const { replyTo = null, scheduledFor = null, statusRef = null } = options;
  const sender = await snapshotSenderName(senderUid);

  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: senderUid,
    senderName: sender.senderName,
    senderUsername: sender.senderUsername,
    type: "text",
    text,
    mediaURL: null,
    mediaThumbURL: null,
    mediaDurationSeconds: null,
    mediaSizeBytes: null,
    mediaExpiresAt: null,
    mediaExpired: false,
    mediaSavedBy: [],
    fileName: null,
    fileExtension: null,
    fileSizeBytes: null,
    gifURL: null,
    gifSourceProvider: null,
    scheduledFor: scheduledFor,
    isScheduled: !!scheduledFor,
    sentAt: serverTimestamp(),
    deliveredTo: [],
    readBy: [],
    deletedForEveryone: false,
    deletedForSelf: [],
    editedAt: null,
    editHistory: [],
    editWindowExpiresAt: null,
    disappearing: null,
    screenshotDetected: false,
    replyTo,
    reactions: {},
    poll: null,
    statusRef,
  });

  if (!scheduledFor) {
    const chatRef = doc(db, "chats", chatId);
    await updateDoc(chatRef, {
      lastMessage: { text, senderId: senderUid, sentAt: serverTimestamp(), type: "text" },
    });
    await incrementUnreadCounts(chatId, otherParticipants);
  }
}

// Shares a contact card into a chat. `contact` carries the shared person's
// snapshot (uid, name, username, photo) so the recipient can message or save
// them without the sender's contacts list.
export async function sendContactMessage(chatId, senderUid, contact, otherParticipants, options = {}) {
  const { replyTo = null } = options;
  const sender = await snapshotSenderName(senderUid);
  const preview = contact?.contactName || contact?.displayName || contact?.name || "Contact";
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: senderUid,
    senderName: sender.senderName,
    senderUsername: sender.senderUsername,
    type: "contact",
    text: null,
    mediaURL: null,
    mediaThumbURL: null,
    mediaDurationSeconds: null,
    mediaSizeBytes: null,
    mediaExpiresAt: null,
    mediaExpired: false,
    mediaSavedBy: [],
    fileName: null,
    fileExtension: null,
    fileSizeBytes: null,
    gifURL: null,
    gifSourceProvider: null,
    scheduledFor: null,
    isScheduled: false,
    sentAt: serverTimestamp(),
    deliveredTo: [],
    readBy: [],
    deletedForEveryone: false,
    deletedForSelf: [],
    editedAt: null,
    editHistory: [],
    editWindowExpiresAt: null,
    disappearing: null,
    screenshotDetected: false,
    replyTo,
    reactions: {},
    poll: null,
    statusRef: null,
    contactUid: contact?.uid || null,
    contactName: preview,
    contactUsername: contact?.username || contact?.contactUsername || null,
    contactPhotoURL: contact?.photoURL || contact?.contactPhotoURL || null,
  });

  const chatRef = doc(db, "chats", chatId);
  await updateDoc(chatRef, {
    lastMessage: { text: `📇 ${preview}`, senderId: senderUid, sentAt: serverTimestamp(), type: "contact" },
  });
  await incrementUnreadCounts(chatId, otherParticipants);
}

// Bumps the forwarded-count on the ORIGINAL message every time a copy of it is
// sent into another chat. Server rules only allow this single key to change.
export async function incrementForwardedCount(sourceChatId, sourceMid) {
  if (!sourceChatId || !sourceMid) return;
  try {
    await updateDoc(doc(db, "chats", sourceChatId, "messages", sourceMid), {
      forwardedCount: increment(1),
    });
  } catch { /* rules/transient — count is best-effort */ }
}

// Forwards a copy of `sourceMsg` into targetChatId, stamped with a
// `forwardedFrom` pointer so the receiver sees a "Forwarded" badge. Keeps every
// type-specific field so images/videos/voice/location/contact render exactly
// like the original. Returns true on success.
export async function sendForwardedMessage(targetChatId, senderUid, sourceMsg, otherParticipants) {
  const sender = await snapshotSenderName(senderUid);
  const { type } = sourceMsg;

  const payload = {
    senderId: senderUid,
    senderName: sender.senderName,
    senderUsername: sender.senderUsername,
    type,
    text: sourceMsg.text || null,
    mediaURL: sourceMsg.mediaURL || null,
    mediaThumbURL: sourceMsg.mediaThumbURL || null,
    mediaDurationSeconds: sourceMsg.mediaDurationSeconds || null,
    mediaSizeBytes: sourceMsg.mediaSizeBytes || null,
    mediaPath: sourceMsg.mediaPath || null,
    mediaExpiresAt: sourceMsg.mediaExpiresAt || null,
    mediaExpired: false,
    mediaSavedBy: [],
    fileName: sourceMsg.fileName || null,
    fileExtension: sourceMsg.fileExtension || null,
    fileSizeBytes: sourceMsg.fileSizeBytes || null,
    gifURL: sourceMsg.gifURL || null,
    gifSourceProvider: sourceMsg.gifSourceProvider || null,
    scheduledFor: null,
    isScheduled: false,
    sentAt: serverTimestamp(),
    deliveredTo: [],
    readBy: [],
    deletedForEveryone: false,
    deletedForSelf: [],
    editedAt: null,
    editHistory: [],
    editWindowExpiresAt: null,
    disappearing: null,
    screenshotDetected: false,
    replyTo: null,
    reactions: {},
    poll: null,
    statusRef: null,
    // Forward stamp — the receiver uses this to render the "Forwarded" badge.
    forwardedFrom: { mid: sourceMsg.id, chatId: sourceMsg.sourceChatId || null, at: Date.now() },
  };

  if (type === "location") {
    payload.lat = sourceMsg.lat || null;
    payload.lng = sourceMsg.lng || null;
    payload.label = sourceMsg.label || null;
    payload.accuracy = sourceMsg.accuracy || null;
    payload.liveUntil = null; // never forward live-location continuation
  }
  if (type === "contact") {
    payload.contactUid = sourceMsg.contactUid || null;
    payload.contactName = sourceMsg.contactName || null;
    payload.contactUsername = sourceMsg.contactUsername || null;
    payload.contactPhotoURL = sourceMsg.contactPhotoURL || null;
  }
  if (sourceMsg.transcript) payload.transcript = sourceMsg.transcript;

  await addDoc(collection(db, "chats", targetChatId, "messages"), payload);

  let preview;
  if (type === "text") preview = sourceMsg.text || "Message";
  else if (type === "image") preview = "📷 Photo";
  else if (type === "video") preview = "🎥 Video";
  else if (type === "voice") preview = "🎤 Voice note";
  else if (type === "file") preview = "📄 File";
  else if (type === "location") preview = "📍 Location";
  else if (type === "contact") preview = `📇 ${payload.contactName || "Contact"}`;
  else preview = "Message";

  await updateDoc(doc(db, "chats", targetChatId), {
    lastMessage: { text: preview, senderId: senderUid, sentAt: serverTimestamp(), type },
  });
  await incrementUnreadCounts(targetChatId, otherParticipants);
  return true;
}

async function incrementUnreadCounts(chatId, otherParticipants) {
  const ref = doc(db, "chats", chatId);
  const snap = await getDoc(ref);
  const current = snap.data()?.unreadCount || {};
  const updated = { ...current };
  otherParticipants.forEach((uid) => {
    updated[uid] = (updated[uid] || 0) + 1;
  });
  await updateDoc(ref, { unreadCount: updated });
}

export async function markChatRead(chatId, myUid) {
  await updateDoc(doc(db, "chats", chatId), { [`unreadCount.${myUid}`]: 0 });
}

// Marks all not-mine messages as delivered to me -- called as soon as this
// chat's message listener is active (approximates "my device received it").
export async function markMessagesDelivered(chatId, myUid, messages) {
  const toUpdate = messages.filter((m) => m.senderId !== myUid && !(m.deliveredTo || []).includes(myUid));
  if (toUpdate.length === 0) return;
  const batch = writeBatch(db);
  toUpdate.forEach((m) => {
    batch.update(doc(db, "chats", chatId, "messages", m.id), { deliveredTo: arrayUnion(myUid) });
  });
  await batch.commit();
}

// Marks all not-mine messages as read by me -- called when this chat is
// actually visible/focused (see ConversationScreen's visibility handling),
// so "read" genuinely reflects the recipient having looked at the chat,
// not just having it open in the background.
export async function markMessagesRead(chatId, myUid, messages) {
  const toUpdate = messages.filter((m) => m.senderId !== myUid && !(m.readBy || []).includes(myUid));
  if (toUpdate.length === 0) return;
  const batch = writeBatch(db);
  toUpdate.forEach((m) => {
    batch.update(doc(db, "chats", chatId, "messages", m.id), { readBy: arrayUnion(myUid) });
  });
  await batch.commit();
}

export async function setTypingHeartbeat(chatId, myUid) {
  await updateDoc(doc(db, "chats", chatId), {
    [`typingUsers.${myUid}`]: serverTimestamp(),
  });
}

export async function setVoiceRecordingHeartbeat(chatId, myUid) {
  await updateDoc(doc(db, "chats", chatId), {
    [`voiceRecordingUsers.${myUid}`]: serverTimestamp(),
  });
}

export async function clearVoiceRecordingStatus(chatId, myUid) {
  if (!chatId) return;
  await updateDoc(doc(db, "chats", chatId), {
    [`voiceRecordingUsers.${myUid}`]: deleteField(),
  });
}

export async function reactToMessage(chatId, messageId, myUid, emoji) {
  const messageRef = doc(db, "chats", chatId, "messages", messageId);
  const snap = await getDoc(messageRef);
  if (!snap.exists()) return;
  const data = snap.data();
  const existingReactions = data.reactions || {};
  const myReaction = existingReactions[myUid];

  if (myReaction === emoji) {
    // User already reacted with this emoji, remove their reaction
    await updateDoc(messageRef, {
      [`reactions.${myUid}`]: deleteField(),
    });
  } else {
    // Set new reaction (or replace existing different reaction)
    await updateDoc(messageRef, {
      [`reactions.${myUid}`]: emoji,
    });
  }
}

// Sends an image, video, file, or voice note message -- the actual bytes
// already live in Supabase Storage by the time this is called (see
// src/supabase/media.js); this just records the message doc pointing at it.
export async function sendMediaMessage(chatId, senderUid, type, uploadResult, otherParticipants, options = {}) {
  const { replyTo = null, durationSeconds = null, statusRef = null, text = null } = options;
  const sender = await snapshotSenderName(senderUid);
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: senderUid,
    senderName: sender.senderName,
    senderUsername: sender.senderUsername,
    type, // "image" | "video" | "file" | "voice"
    text: text || null,
    mediaURL: uploadResult.url,
    mediaThumbURL: null,
    mediaDurationSeconds: durationSeconds,
    mediaSizeBytes: uploadResult.sizeBytes,
    mediaPath: uploadResult.path, // Supabase storage path, needed to delete later
    mediaExpiresAt: null,
    mediaExpired: false,
    mediaSavedBy: [],
    fileName: uploadResult.fileName || null,
    fileExtension: uploadResult.fileName?.split(".").pop() || null,
    fileSizeBytes: uploadResult.sizeBytes,
    gifURL: null,
    gifSourceProvider: null,
    scheduledFor: null,
    isScheduled: false,
    sentAt: serverTimestamp(),
    deliveredTo: [],
    readBy: [],
    deletedForEveryone: false,
    deletedForSelf: [],
    editedAt: null,
    editHistory: [],
    editWindowExpiresAt: null,
    disappearing: null,
    screenshotDetected: false,
    replyTo,
    reactions: {},
    poll: null,
    statusRef,
  });
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: { text: text ? (text.length > 40 ? text.slice(0, 40) + "…" : text) : mediaLabel(type), senderId: senderUid, sentAt: serverTimestamp(), type },
  });
  await incrementUnreadCounts(chatId, otherParticipants);
}

export async function sendLocationMessage(chatId, senderUid, location, otherParticipants, options = {}) {
  const { liveUntil = null, replyTo = null, statusRef = null } = options;
  const sender = await snapshotSenderName(senderUid);
  const isLive = !!liveUntil && liveUntil > Date.now();
  const textLabel = isLive ? "📍 Live location" : "📍 Location";
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: senderUid,
    senderName: sender.senderName,
    senderUsername: sender.senderUsername,
    type: "location",
    text: textLabel,
    lat: location.lat,
    lng: location.lng,
    label: location.label || null,
    accuracy: location.accuracy || null,
    liveUntil: liveUntil,
    mediaURL: null,
    mediaThumbURL: null,
    mediaDurationSeconds: null,
    mediaSizeBytes: null,
    mediaExpiresAt: null,
    mediaExpired: false,
    mediaSavedBy: [],
    fileName: null,
    fileExtension: null,
    fileSizeBytes: null,
    gifURL: null,
    gifSourceProvider: null,
    scheduledFor: null,
    isScheduled: false,
    sentAt: serverTimestamp(),
    deliveredTo: [],
    readBy: [],
    deletedForEveryone: false,
    deletedForSelf: [],
    editedAt: null,
    editHistory: [],
    editWindowExpiresAt: null,
    disappearing: null,
    screenshotDetected: false,
    replyTo,
    reactions: {},
    poll: null,
    statusRef,
  });
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: { text: textLabel, senderId: senderUid, sentAt: serverTimestamp(), type: "location" },
  });
  await incrementUnreadCounts(chatId, otherParticipants);
}

// Live-location heartbeat: refreshes the coordinates on an existing location
// message without creating new messages. The recipient keeps seeing the same
// bubble with a moving pin until liveUntil passes.
export async function updateLiveLocation(chatId, messageId, location) {
  await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
    lat: location.lat,
    lng: location.lng,
    accuracy: location.accuracy || null,
  });
}

function mediaLabel(type) {
  if (type === "image") return "📷 Photo";
  if (type === "video") return "🎥 Video";
  if (type === "voice") return "🎤 Voice note";
  if (type === "file") return "📄 File";
  return "Message";
}

export async function sendPollMessage(chatId, senderUid, question, options) {
  const sender = await snapshotSenderName(senderUid);
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: senderUid,
    senderName: sender.senderName,
    senderUsername: sender.senderUsername,
    type: "poll",
    text: null,
    sentAt: serverTimestamp(),
    deliveredTo: [],
    readBy: [],
    deletedForEveryone: false,
    deletedForSelf: [],
    reactions: {},
    replyTo: null,
    poll: {
      question,
      options: options.map((text, i) => ({ id: String(i), text })),
      votes: {},
      allowMultipleAnswers: false,
      createdBy: senderUid,
    },
    isScheduled: false,
    scheduledFor: null,
    statusRef: null,
  });
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: { text: `📊 ${question}`, senderId: senderUid, sentAt: serverTimestamp(), type: "poll" },
  });
}

export async function voteOnPoll(chatId, messageId, myUid, optionId) {
  const ref = doc(db, "chats", chatId, "messages", messageId);
  const snap = await getDoc(ref);
  const poll = snap.data()?.poll;
  if (!poll) return;
  const votes = { ...poll.votes, [myUid]: optionId };
  await updateDoc(ref, { poll: { ...poll, votes } });
}

export async function editMessage(chatId, messageId, newText, previousText) {
  await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
    text: newText,
    editedAt: serverTimestamp(),
    editHistory: arrayUnion(previousText),
  });
}

export async function deleteMessageForSelf(chatId, messageId, myUid) {
  await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
    deletedForSelf: arrayUnion(myUid),
  });
}

export async function deleteMessageForEveryone(chatId, messageId) {
  // Only flag the message as deleted — never blank `text` in the same write.
  // firestore.rules treats any `text` change as an edit (15-min window), so a
  // write that also cleared text would be REJECTED for messages older than
  // 15 min. Firestore then rolls back the optimistic local change, which
  // made deleted-for-everyone messages "snap back" (the zombie-message bug).
  // Clients render deletedForEveryone as a placeholder regardless of text.
  await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
    deletedForEveryone: true,
  });
}

// ── Chat-level relationship actions: archive, mute, favorite ──────────────
export async function toggleArchive(chatId, myUid, currentlyArchived) {
  const update = {
    archivedBy: currentlyArchived ? arrayRemove(myUid) : arrayUnion(myUid),
  };
  if (currentlyArchived) update.status = "active";
  await updateDoc(doc(db, "chats", chatId), update);
}
export async function toggleFavorite(chatId, myUid, currentlyFavorite) {
  await updateDoc(doc(db, "chats", chatId), {
    favoritedBy: currentlyFavorite ? arrayRemove(myUid) : arrayUnion(myUid),
  });
}
export async function setMute(chatId, myUid, until) {
  await updateDoc(doc(db, "chats", chatId), { [`mutedBy.${myUid}`]: until });
}
export async function clearMute(chatId, myUid) {
  await updateDoc(doc(db, "chats", chatId), { [`mutedBy.${myUid}`]: deleteField() });
}
export async function toggleLocked(chatId, myUid, currentlyLocked) {
  await updateDoc(doc(db, "chats", chatId), {
    [`lockedBy.${myUid}`]: currentlyLocked ? deleteField() : true,
  });
}
export async function togglePinned(chatId, myUid, currentlyPinned) {
  await updateDoc(doc(db, "chats", chatId), {
    pinnedBy: currentlyPinned ? arrayRemove(myUid) : arrayUnion(myUid),
  });
}
export async function deleteChatForUser(chatId, myUid) {
  await updateDoc(doc(db, "chats", chatId), {
    archivedBy: arrayRemove(myUid),
    favoritedBy: arrayRemove(myUid),
    [`lockedBy.${myUid}`]: deleteField(),
    [`mutedBy.${myUid}`]: deleteField(),
    [`deletedForSelf.${myUid}`]: true,
  });
}

export async function deleteChatCompletely(chatId) {
  try {
    const msgSnap = await getDocs(collection(db, "chats", chatId, "messages"));
    const batch = writeBatch(db);
    msgSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "chats", chatId));
    await batch.commit();
  } catch {
    await deleteDoc(doc(db, "chats", chatId));
  }
}

// ── Expired media auto-deletion ───────────────────────────────────────────

// True when a media message has passed its auto-delete window (either the
// purge already flagged it, or enough days have elapsed since it was sent).
export function isMediaExpired(m, mediaExpiryDays) {
  if (!m) return false;
  if (m.mediaExpired === true) return true;
  if (mediaExpiryDays == null || !m.sentAt?.toDate) return false;
  return Date.now() - m.sentAt.toDate().getTime() >= mediaExpiryDays * 24 * 60 * 60 * 1000;
}

// Scan every chat this user is in for media that has passed its auto-delete
// window, then really delete the Supabase storage file and flag the message
// doc as expired so every client shows the "Expired" placeholder instead of
// a dead media URL.
//
// Supabase RLS only lets the uploader remove a file, so:
//  - messages this user uploaded: delete the file, null out mediaPath/mediaURL;
//  - messages someone else uploaded: mark expired now (hides the media); the
//    uploader's own purge deletes the actual file later.
export async function purgeExpiredChatMedia(myUid, mediaExpiryDays) {
  if (!myUid || mediaExpiryDays == null) return 0;
  const chatsSnap = await getDocs(query(collection(db, "chats"), where("participants", "array-contains", myUid)));
  let processed = 0;
  for (const chatDoc of chatsSnap.docs) {
    const chatId = chatDoc.id;
    const msgSnap = await getDocs(query(collection(db, "chats", chatId, "messages"), where("mediaPath", "!=", null)));
    for (const msgDoc of msgSnap.docs) {
      const m = msgDoc.data();
      if (!isMediaExpired(m, mediaExpiryDays)) continue;
      const sentMs = m.sentAt?.toDate?.()?.getTime?.() || Date.now();
      const expiresAt = new Date(sentMs + mediaExpiryDays * 24 * 60 * 60 * 1000);
      const patch = {
        mediaExpired: true,
        mediaExpiresAt: expiresAt,
        mediaThumbURL: null,
      };
      if (m.senderId === myUid && m.mediaPath) {
        try {
          await deleteChatFile(m.mediaPath);
          patch.mediaPath = null;
          patch.mediaURL = null;
        } catch { /* storage already gone or RLS block — still hide the media */ }
      } else {
        patch.mediaURL = null;
      }
      await updateDoc(msgDoc.ref, patch);
      processed += 1;
    }
  }
  return processed;
}

// ── Group administration helpers ──

// True when the given user is a group admin: the original creator
// (createdBy) or any uid listed in the groupAdmins array.
export function isGroupAdmin(groupDoc, uid) {
  if (!groupDoc || !uid) return false;
  if (groupDoc.createdBy === uid) return true;
  return (groupDoc.groupAdmins || []).includes(uid);
}

// Update mutable group profile fields (groupName, groupPhotoURL, etc.).
export async function updateGroupProfile(chatId, fields) {
  await updateDoc(doc(db, "chats", chatId), fields);
}

// Promote (makeAdmin=true) or revoke (makeAdmin=false) a member's group-admin
// status. Only group admins/creators call this; Firestore rules enforce it.
export async function setGroupAdmin(chatId, uid, makeAdmin) {
  if (!chatId || !uid) return;
  const ref = doc(db, "chats", chatId);
  if (makeAdmin) {
    await updateDoc(ref, { groupAdmins: arrayUnion(uid) });
  } else {
    await updateDoc(ref, { groupAdmins: arrayRemove(uid) });
  }
}

// Append new members to a group's participants array. Skips anyone already
// present and initialises their unread counter.
export async function addMembersToGroup(chatId, newUids) {
  if (!newUids || newUids.length === 0) return;
  const ref = doc(db, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const existing = snap.data()?.participants || [];
  const unread = snap.data()?.unreadCount || {};
  const additions = [];
  newUids.forEach((uid) => {
    if (uid && !existing.includes(uid)) {
      additions.push(uid);
      unread[uid] = 0;
    }
  });
  if (additions.length === 0) return;
  await updateDoc(ref, {
    participants: arrayUnion(...additions),
    unreadCount: unread,
  });
}

// Fetch the profile docs for a list of user uids in parallel. Returns
// [{ uid, profile }] with whatever data the users collection holds.
export async function getUsersByUids(uids) {
  if (!uids || uids.length === 0) return [];
  const refs = uids.map((uid) => doc(db, "users", uid));
  const snaps = await Promise.all(refs.map((r) => getDoc(r)));
  return snaps
    .map((s, i) => ({ uid: uids[i], profile: s.exists() ? s.data() : null }))
    .filter((u) => u.profile);
}

// Save a per-user override nickname for a specific group. Stored on the
// user document so it only affects that user's own view.
export async function setGroupNickname(myUid, chatId, nickname) {
  await updateDoc(doc(db, "users", myUid), {
    [`groupNicknames.${chatId}`]: nickname || deleteField(),
  });
}

