import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./config";

// ── Fish Audio TTS (Y Mizrachi voice) ──────────────────────────────────────
// Free tier: s2.1-pro-free. Returns raw MP3 bytes which we turn into a Blob URL.

export const FISH_AUDIO_API = "https://api.fish.audio/v1/tts";
export const FISH_MODEL = "s2.1-pro-free";
export const Y_MIZRACHI_VOICE_ID = "9cc36d13d091468fa9c4cab838a6ecdf";
export const FISH_API_KEY = "sk-fish-hPD2no9ly6H8nXJcK4iryrfXO_aRNXCKHviwvfAOUW8";

// Global "socket" for voice: AppSettings.global_voice_enabled (stored in the AI
// system config doc which acts as the app-wide settings object).
export const VOICE_SYSTEM_REF = ["config", "system"];

// Returns the global voice master switch (default true).
export async function getGlobalVoiceEnabled() {
  try {
    const snap = await getDoc(doc(db, ...VOICE_SYSTEM_REF));
    const data = snap.exists() ? snap.data() : {};
    return data.global_voice_enabled !== false;
  } catch {
    return true;
  }
}

// Sets the global voice master switch (default true when absent).
export async function setGlobalVoiceEnabled(enabled, adminUid) {
  await setDoc(doc(db, ...VOICE_SYSTEM_REF), {
    global_voice_enabled: !!enabled,
    updatedBy: adminUid || null,
    updatedAt: new Date(),
  }, { merge: true });
  return !!enabled;
}

// Per-user TTS (hear AI replies) + premium AI-access gating. Stored on the user
// document so it syncs across the user's own devices.
export function getVoiceUserDefaults() {
  return {
    user_tts_enabled: false,
    has_ai_access: false,
  };
}

// Toggle the user's "hear AI replies" flag. Returns the new value.
export async function setUserTtsEnabled(userUid, enabled) {
  if (!userUid) return false;
  await setDoc(doc(db, "users", userUid), { user_tts_enabled: !!enabled }, { merge: true });
  return !!enabled;
}

// Reads the user's voice-related flags from their users doc.
export async function getUserVoiceFlags(userUid) {
  try {
    const snap = await getDoc(doc(db, "users", userUid));
    const d = snap.exists() ? snap.data() : {};
    return {
      user_tts_enabled: d.user_tts_enabled === true,
      has_ai_access: d.has_ai_access === true,
    };
  } catch {
    return { user_tts_enabled: false, has_ai_access: false };
  }
}

// Evaluate whether we should synthesize & play a voice reply for this user.
export async function shouldPlayVoiceReply(userUid) {
  if (!userUid) return false;
  const [voiceEnabled, flags] = await Promise.all([getGlobalVoiceEnabled(), getUserVoiceFlags(userUid)]);
  return voiceEnabled === true && flags.user_tts_enabled === true;
}

// POST to Fish Audio TTS and return a playable Blob URL of the MP3.
// Throws a readable error if the global switch or request fails.
export async function synthesizeSpeech(text) {
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("Nothing to speak.");

  const clean = prompt.length > 500 ? prompt.slice(0, 500) : prompt;
  let resp;
  try {
    resp = await fetch(FISH_AUDIO_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FISH_API_KEY}`,
        "Content-Type": "application/json",
        model: FISH_MODEL,
      },
      body: JSON.stringify({
        text: clean,
        reference_id: Y_MIZRACHI_VOICE_ID,
        format: "mp3",
      }),
    });
  } catch {
    throw new Error("Couldn't reach the voice service. Check your connection.");
  }
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()) || ""; } catch {}
    if (resp.status === 401) throw new Error("Voice service rejected the API key.");
    if (resp.status === 402) throw new Error("Voice service has no credits left.");
    if (resp.status === 429) throw new Error("Voice service is rate-limited. Try again shortly.");
    throw new Error(`Voice service error (${resp.status}). ${detail}`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

// Synthesize and fetch raw MP3 bytes (array buffer) — used when uploading a
// user's custom voice note into a chat as a stored media file.
export async function synthesizeSpeechBytes(text) {
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("Nothing to speak.");
  const clean = prompt.length > 500 ? prompt.slice(0, 500) : prompt;
  const resp = await fetch(FISH_AUDIO_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FISH_API_KEY}`,
      "Content-Type": "application/json",
      model: FISH_MODEL,
    },
    body: JSON.stringify({
      text: clean,
      reference_id: Y_MIZRACHI_VOICE_ID,
      format: "mp3",
    }),
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")) || "";
    throw new Error(`Voice service error (${resp.status}). ${detail}`);
  }
  const buffer = await resp.arrayBuffer();
  return new Blob([buffer], { type: "audio/mpeg" });
}
