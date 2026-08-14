import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";
import { db } from "./config";

// Per-user message statistics, aggregated on demand. Works for any user the
// caller can read messages for: the logged-in user (chat participant) and —
// since admins got message read access — any other user when viewed by an
// admin. Messages are fetched per chat and aggregated in-memory: computing the
// sent/received split, media durations and media sizes needs several field
// combinations that would each require a separate Firestore composite index,
// which isn't practical here. For a friends-and-family deployment this is
// fine; a huge deployment would want a Cloud Function + counter docs instead.

export async function getUserChatIds(uid) {
  const q = query(collection(db, "chats"), where("participants", "array-contains", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

const TYPE_KEYS = ["text", "image", "video", "voice", "location", "file", "contact"];

const emptyPerType = () => Object.fromEntries(TYPE_KEYS.map((k) => [k, { sent: 0, recv: 0 }]));

// Aggregate every message the user can read. Shape:
//   chats, total, sent, received
//   perType[type] -> { sent, recv }  (text/image/video/voice/location/file/contact)
//   mediaDurationMs -> { video: { sent, recv }, voice: { sent, recv } }  (milliseconds)
//   mediaSizeBytes -> { sent, recv }  (total bytes of all media)
export async function getUserMessageStats(uid) {
  const chatIds = await getUserChatIds(uid);
  const stats = {
    chats: chatIds.length,
    total: 0,
    sent: 0,
    received: 0,
    perType: emptyPerType(),
    mediaDurationMs: { video: { sent: 0, recv: 0 }, voice: { sent: 0, recv: 0 } },
    mediaSizeBytes: { sent: 0, recv: 0 },
  };
  for (const chatId of chatIds) {
    let snap;
    try {
      snap = await getDocs(collection(db, "chats", chatId, "messages"));
    } catch { /* rules/transient — skip this chat */ continue; }
    for (const d of snap.docs) {
      const m = d.data();
      const isSent = m.senderId === uid;
      stats.total++;
      if (isSent) stats.sent++;
      else stats.received++;

      const type = m.type;
      const bucket = stats.perType[type];
      if (bucket) {
        if (isSent) bucket.sent++;
        else bucket.recv++;
      }

      const dur = Number(m.mediaDurationSeconds) || 0;
      if ((type === "video" || type === "voice") && dur > 0) {
        const ms = dur * 1000;
        if (isSent) stats.mediaDurationMs[type].sent += ms;
        else stats.mediaDurationMs[type].recv += ms;
      }

      const size = Number(m.mediaSizeBytes) || 0;
      if (size > 0) {
        if (isSent) stats.mediaSizeBytes.sent += size;
        else stats.mediaSizeBytes.recv += size;
      }
    }
  }
  return stats;
}

// Compact duration label for total video/voice playtime (e.g. "1h 4m 30s",
// "12d 3h"). Shows only the meaningful units.
export function formatDuration(ms) {
  if (!ms || ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Human-friendly byte label for media volumes (B/KB/MB/GB).
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const GB = 1024 ** 3, MB = 1024 ** 2, KB = 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${bytes} B`;
}

// Total time the user has spent actively using the app (activeTimeMs is
// accumulated client-side by the presence/usage heartbeat). Large values are
// collapsed into words so the line never clogs (e.g. "about 2 hours").
export function formatActiveTime(ms) {
  if (!ms || ms <= 0) return "No tracked time yet";
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor(ms / HOUR) % 24;
  const minutes = Math.floor(ms / MIN) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (!days && !hours && seconds) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  const joined = parts.join(", ");
  return joined || "Just a moment";
}

// Human-friendly "time on NexText" breakdown. Large absolute minute/second
// values would clog the screen, so minutes/seconds are expressed as words once
// they pass a threshold (e.g. "about 2 hours" instead of "137 minutes").
export function formatMembershipDuration(createdAt) {
  if (!createdAt) return "—";
  const start = createdAt?.toMillis ? createdAt.toMillis() : new Date(createdAt).getTime();
  if (!Number.isFinite(start)) return "—";
  const ms = Math.max(0, Date.now() - start);
  if (ms < 60_000) return "Just joined NexText 🎉";

  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000, WEEK = 7 * DAY, MONTH = 30.44 * DAY, YEAR = 365.25 * DAY;
  const years = Math.floor(ms / YEAR);
  const months = Math.floor(ms / MONTH) % 12;
  const weeks = Math.floor(ms / WEEK) % Math.max(1, Math.floor(MONTH / WEEK));
  const days = Math.floor(ms / DAY) % 7;
  const hours = Math.floor(ms / HOUR) % 24;
  const minutes = Math.floor(ms / MIN) % 60;
  const seconds = Math.floor(ms / 1000) % 60;

  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  if (weeks) parts.push(`${weeks} week${weeks === 1 ? "" : "s"}`);
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours && parts.length < 4) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);

  if (parts.length < 2 && ms < DAY) {
    if (!hours && minutes && minutes < 60) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    else if (!hours && minutes === 0 && seconds && seconds < 60) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
    else if (!hours && minutes >= 60) parts.push(`about ${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"}`);
  } else if (parts.length < 3 && hours) {
    const extraMinutes = Math.floor(ms / MIN) % 60;
    if (extraMinutes >= 30) parts.push("and a half");
  }

  const joined = parts.join(", ");
  if (!joined) return ms < HOUR ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "1+ hour";
  return joined;
}

export async function getUserDoc(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.data() || null;
  } catch { return null; }
}
