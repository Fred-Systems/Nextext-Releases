// Calling ICE configuration — STUN by default, TURN optional via globalSettings.
// No media is stored in Firebase/Supabase/Cloudinary. TURN credentials are never
// hard-coded; they come from Firestore config/calling if an admin provides them.

const DEFAULT_STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// Resolve ICE servers from globalSettings.calling.iceServers (optional).
// Shape accepted: [{ urls: "...", username?: "...", credential?: "..." }, ...]
// If none configured, STUN only. If admin added TURN entries, they are appended.
export function resolveIceServers(globalSettings) {
  const stun = globalSettings?.calling?.stunServers;
  const turn = globalSettings?.calling?.turnServers;
  const ice = [];
  if (Array.isArray(stun) && stun.length) {
    for (const s of stun) if (s?.urls) ice.push(s);
  } else {
    ice.push(...DEFAULT_STUN);
  }
  if (Array.isArray(turn)) {
    for (const t of turn) if (t?.urls) ice.push(t);
  }
  // Also support legacy flat array: calling.iceServers
  const flat = globalSettings?.calling?.iceServers;
  if (Array.isArray(flat) && !stun && !turn) {
    for (const s of flat) if (s?.urls) ice.push(s);
  }
  return ice;
}

export function hasTurnConfigured(globalSettings) {
  const turn = globalSettings?.calling?.turnServers || globalSettings?.calling?.iceServers || [];
  return Array.isArray(turn) && turn.some((s) => String(s?.urls || "").toLowerCase().includes("turn"));
}

export function getIceExplanation(globalSettings) {
  if (hasTurnConfigured(globalSettings)) return "TURN configured — relay available for restrictive NATs.";
  return "TURN not configured; direct WebRTC/STUN connectivity implemented.";
}
