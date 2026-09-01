import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./config";

// ── Fish Audio TTS (Y Mizrachi voice) ──────────────────────────────────────
// Free tier: s2.1-pro-free. Returns raw MP3 bytes which we turn into a Blob URL.

export const FISH_AUDIO_API = "https://api.fish.audio/v1/tts";
export const FISH_MODEL = "s2.1-pro-free";
export const Y_MIZRACHI_VOICE_ID = "9cc36d13d091468fa9c4cab838a6ecdf";
export const FISH_API_KEY = "sk-fish-hPD2no9ly6H8nXJcK4iryrfXO_aRNXCKHviwvfAOUW8";

const nativeTTS = (typeof window !== "undefined" && window.Capacitor?.Plugins?.NextextNative) ? window.Capacitor.Plugins.NextextNative : null;
const isNativePlatform = () => !!(typeof window !== "undefined" && window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform());

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
// Prefers the native Android HTTP layer (CORS-free); falls back to a direct
// fetch (web / debug). Throws a readable error on failure.
export async function synthesizeSpeech(text) {
  const clean = cleanPrompt(text);
  try {
    if (isNativePlatform() && nativeTTS && typeof nativeTTS.tts === "function") {
      const res = await nativeTTS.tts({ text: clean, referenceId: Y_MIZRACHI_VOICE_ID, model: FISH_MODEL, apiKey: FISH_API_KEY });
      const b64 = res?.base64;
      if (!b64) throw new Error("Voice service returned no audio.");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: res?.mimeType || "audio/mpeg" }));
    }
  } catch (e) {
    console.error("[tts] native synthesis failed, falling back to fetch:", e?.message);
  }
  // Direct fetch fallback.
  let resp;
  try {
    resp = await fetch(FISH_AUDIO_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FISH_API_KEY}`,
        "Content-Type": "application/json",
        model: FISH_MODEL,
      },
      body: JSON.stringify({ text: clean, reference_id: Y_MIZRACHI_VOICE_ID, model: FISH_MODEL, format: "mp3" }),
    });
  } catch (e) {
    console.error("[tts] fetch failed (likely CORS/network):", e?.message);
    throw new Error("Couldn't reach the voice service. Check your connection.");
  }
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()) || ""; } catch {}
    console.error("[tts] HTTP", resp.status, detail);
    throw new Error(`Voice service error (${resp.status}). ${detail}`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

// Synthesize and fetch the raw MP3 as a Blob (for uploading a custom voice note).
export async function synthesizeSpeechBytes(text) {
  const clean = cleanPrompt(text);
  try {
    if (isNativePlatform() && nativeTTS && typeof nativeTTS.tts === "function") {
      const res = await nativeTTS.tts({ text: clean, referenceId: Y_MIZRACHI_VOICE_ID, model: FISH_MODEL, apiKey: FISH_API_KEY });
      const b64 = res?.base64;
      if (!b64) throw new Error("Voice service returned no audio.");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: res?.mimeType || "audio/mpeg" });
    }
  } catch (e) {
    console.error("[tts] native synthesis failed, falling back to fetch:", e?.message);
  }
  const resp = await fetch(FISH_AUDIO_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FISH_API_KEY}`,
      "Content-Type": "application/json",
      model: FISH_MODEL,
    },
    body: JSON.stringify({ text: clean, reference_id: Y_MIZRACHI_VOICE_ID, model: FISH_MODEL, format: "mp3" }),
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")) || "";
    console.error("[tts] HTTP", resp.status, detail);
    throw new Error(`Voice service error (${resp.status}). ${detail}`);
  }
  return new Blob([await resp.arrayBuffer()], { type: "audio/mpeg" });
}

function cleanPrompt(text) {
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("Nothing to speak.");
  return prompt.length > 500 ? prompt.slice(0, 500) : prompt;
}
