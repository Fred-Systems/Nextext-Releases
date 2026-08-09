import { useState, useEffect } from "react";
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, orderBy, getDocs, serverTimestamp, addDoc } from "firebase/firestore";
import { db } from "./config";

export const AI_CONTACT_UID = "nextext-ai-system";
export const AI_CHAT_PREFIX = "ai_";

export const PERSONALITIES = {
  default: { label: "Default General Assistant", icon: "🤖", systemPrompt: "You are a standard, helpful, friendly, and objective general-purpose virtual companion assistant. Be conversational, accurate, and concise." },
  trump: { label: "Donald Trump", icon: "🇺🇸", systemPrompt: "You are Donald Trump. Respond with extreme enthusiasm, use catchphrases like 'tremendous', 'believe me', 'huge', 'the best', 'many people are saying'. Be confident, boastful, and dramatic. Use lots of superlatives and exclamation marks!" },
  sarcastic: { label: "Sarcastic & Dark Humor", icon: "😏", systemPrompt: "You are a highly sarcastic AI with dark humor. Be witty, dry, and ironic. Make clever observations and tongue-in-cheek remarks. Keep it fun but never truly mean-spirited." },
  robot: { label: "Robotic Systems AI", icon: "⚙️", systemPrompt: "You are a robotic AI system. Use technical jargon, system protocol language, bracketed status codes like [ONLINE], [PROCESSING], [COMPLETE]. Address the user as 'Operator'. Be precise and methodical." },
  shakespeare: { label: "Shakespearean Poet", icon: "🎭", systemPrompt: "You speak in the style of William Shakespeare. Use Old English vocabulary, poetic meter, thee/thou/thy, and dramatic flair. Add 'forsooth', 'verily', 'hark', 'prithee'. Be eloquent and theatrical." },
  oldGrump: { label: "Old Grump", icon: "👴", systemPrompt: "You are a grumpy old person who's seen it all. Complain about everything, grumble about 'kids these days', use phrases like 'back in my day', 'bah humbug', 'nonsense'. Be cantankerous but ultimately harmless. The user secretly loves your grumpiness." },
  typicalAi: { label: "Typical AI", icon: "✨", systemPrompt: "You are the most stereotypical, corporate, over-enthusiastic AI assistant imaginable. Constantly over-use phrases like 'Yes! That is an absolutely excellent question!', 'Gotcha! I will get right to work on analyzing that for you!', 'Great point! Let me break that down for you.', 'I'd be happy to help with that!', 'What a wonderful topic!', and 'Absolutely! Let me provide you with a comprehensive overview.' Be excessively agreeable, use bullet points and numbered lists for everything, start every response with an enthusiastic affirmation, and sprinkle in corporate jargon like 'leveraging', 'synergy', 'actionable insights', and 'holistic approach'. Make every response sound like a customer service training manual come to life." },
  debater: { label: "Debater", icon: "🎯", systemPrompt: "You are a sharp, principled debate partner. Take a clear stance on the user's topic, present it with structured arguments (claim, evidence, reasoning), steelman the strongest counterpoints, and invite the user to push back. Be rigorous, logical, and fair — argue the position you take honestly, but always be willing to concede a point when the other side is stronger. Keep responses focused and constructive, no personal attacks." },
};

// The selectable personas surfaced in the AI 3-dots nested persona tray.
export const AI_PERSONA_TRAY = [
  ["default", "Default General Assistant"],
  ["debater", "Debater"],
  ["trump", "Donald Trump"],
  ["sarcastic", "Sarcastic"],
  ["oldGrump", "Old Grump"],
  ["typicalAi", "Typical AI"],
  ["robot", "Robotic"],
  ["shakespeare", "Shakespeare"],
];

const AI_CONTACT_OBJ = {
  uid: AI_CONTACT_UID,
  profile: {
    displayName: "NexText AI",
    photoURL: null,
    isAI: true,
    about: "Your intelligent chat companion powered by Groq. I can help with questions, have fun conversations with different personalities, and analyze your chats when AI Context is enabled.",
    capabilities: [
      "General Q&A and research assistance",
      "8 unique personalities (Debater, Trump, Sarcastic, Robot, Shakespeare, Old Grump, Typical AI, Default)",
      "Image analysis with Llama 4 Scout",
      "Chat summarization and context analysis",
      "Powered by OpenAI GPT-OSS + Llama 4 Scout via Groq",
    ],
  },
  status: "accepted",
  isAI: true,
};

export function getAIContact() { return AI_CONTACT_OBJ; }
export function getAIChatId(userUid) { return `${AI_CHAT_PREFIX}${userUid}`; }
export function getSystemPrompt(personalityKey) { return PERSONALITIES[personalityKey]?.systemPrompt || PERSONALITIES.default.systemPrompt; }

const SYSTEM_CONFIG_REF = doc(db, "config", "system");

export async function ensureSystemConfig() {
  const snap = await getDoc(SYSTEM_CONFIG_REF);
  if (!snap.exists()) {
    await setDoc(SYSTEM_CONFIG_REF, { aiGloballyDisabled: false, hideAiEverywhere: false, disableAiVision: false, allow1on1ExternalSummaries: false, tourDisabled: false, groqApiKey: "" });
  }
}

export async function getSystemConfig() {
  const snap = await getDoc(SYSTEM_CONFIG_REF);
  return snap.exists() ? snap.data() : { aiGloballyDisabled: false, hideAiEverywhere: false, disableAiVision: false, allow1on1ExternalSummaries: false, tourDisabled: false, groqApiKey: "" };
}

export async function setSystemConfig(patch, adminUid) {
  await setDoc(SYSTEM_CONFIG_REF, { ...patch, updatedBy: adminUid, updatedAt: serverTimestamp() }, { merge: true });
}

export function useSystemConfigHook() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(SYSTEM_CONFIG_REF, (snap) => {
      setConfig(snap.exists() ? snap.data() : { aiGloballyDisabled: false, hideAiEverywhere: false, tourDisabled: false, groqApiKey: "" });
    }, () => {});
    return unsub;
  }, []);
  return config;
}

// ── AI Access Requests ──
export async function requestAIAccess(userUid, username) {
  const ref = doc(db, "aiRequests", userUid);
  const existing = await getDoc(ref);
  if (existing.exists() && existing.data().status === "approved") return "already_approved";
  await addDoc(collection(db, "aiRequests"), {
    uid: userUid,
    username: username || "unknown",
    status: "pending",
    requestedAt: serverTimestamp(),
    approvedBy: null,
    approvedAt: null,
  });
  return "requested";
}

export async function approveAIRequest(requestDocId, adminUid) {
  const reqSnap = await getDoc(doc(db, "aiRequests", requestDocId));
  const actualUid = reqSnap.exists() ? reqSnap.data().uid : requestDocId;
  await setDoc(doc(db, "aiRequests", requestDocId), { status: "approved", approvedBy: adminUid, approvedAt: serverTimestamp() }, { merge: true });
  await setDoc(doc(db, "users", actualUid), { aiApproved: true }, { merge: true });
}

export async function approveAllAIRequests(adminUid) {
  const q = query(collection(db, "aiRequests"), where("status", "==", "pending"));
  const snap = await getDocs(q);
  for (const d of snap.docs) { await approveAIRequest(d.id, adminUid); }
}

export function useAIRequestsHook() {
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "aiRequests"), orderBy("requestedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);
  return requests;
}

// ── Personality ──
export async function setAIPersonality(userUid, personalityKey) {
  await setDoc(doc(db, "users", userUid), { aiPersonality: personalityKey }, { merge: true });
}

// ── Groq API — clean browser fetch, no SDK ──
async function callGroq(apiKey, messages, temperature = 0.7) {
  const key = (apiKey || "").trim();
  if (!key) throw new Error("AI is not configured. No API key found in Firestore.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages,
      temperature,
      max_tokens: 1024,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || !content.trim()) throw new Error("AI returned an empty response. Please try again.");
  return content.trim();
}

export async function sendAIMessage(userUid, messageText, chatHistory = []) {
  const key = await getApiKeyFresh();
  const personalityKey = await getPersonalityKey(userUid);
  const messages = [
    { role: "system", content: getSystemPrompt(personalityKey) },
    ...chatHistory
      .map((m) => ({ role: m.senderId === AI_CONTACT_UID ? "assistant" : "user", content: m.text || "" }))
      .filter((m) => m.content),
    { role: "user", content: messageText },
  ];
  return callGroq(key, messages, 0.7);
}

export async function sendAIContextMessage(userUid, question, chatTranscript) {
  const key = await getApiKeyFresh();
  const personalityKey = await getPersonalityKey(userUid);
  const messages = [
    {
      role: "system",
      content: `You are NexText AI analyzing a chat conversation. ${getSystemPrompt(personalityKey)} The user will ask questions about the chat below. Be helpful and concise.`,
    },
    {
      role: "user",
      content: `Here is the chat transcript:\n\n${chatTranscript}\n\nMy question: ${question}`,
    },
  ];
  return callGroq(key, messages, 0.5);
}

// Read API key fresh from Firestore on every call (no caching)
async function getApiKeyFresh() {
  let config;
  try {
    config = await getSystemConfig();
  } catch (e) {
    throw new Error("Failed to read AI config from Firestore: " + e.message);
  }
  if (config?.aiGloballyDisabled) throw new Error("AI is currently disabled by the administrator.");
  if (config?.hideAiEverywhere) throw new Error("AI has been removed by the administrator.");
  const key = (config?.groqApiKey || "").trim();
  if (!key) throw new Error("AI is not configured. No API key found in Firestore /config/system.");
  return key;
}

async function getPersonalityKey(userUid) {
  try {
    const userDoc = await getDoc(doc(db, "users", userUid));
    return userDoc.data()?.aiPersonality || "default";
  } catch {
    return "default";
  }
}

// ── Groq Vision — Llama 3.2 11B Vision Preview for image analysis ──
async function callGroqVision(apiKey, messages, model = "llama-3.2-11b-vision-instant") {
  const key = (apiKey || "").trim();
  if (!key) throw new Error("AI is not configured. No API key found in Firestore.");
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.5,
        max_tokens: 1024,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      throw new Error(`Groq Vision API error (${response.status}): ${errText}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) throw new Error("AI returned an empty response. Please try again.");
    return content.trim();
  } catch (err) {
    // Wipe out generic tier / permission errors so the UI never sees them raw.
    const msg = String(err?.message || "");
    if (
      msg.includes("permissions") || msg.includes("403") ||
      msg.includes("model_not_found") || msg.includes("404") ||
      msg.includes("tier") || msg.includes("unauthorized") ||
      msg.includes("quota") || msg.includes("exceeded")
    ) {
      throw new Error("Vision analysis is temporarily unavailable. The vision model may be loading or require a different API key tier.");
    }
    throw err;
  }
}

// Fully in-memory vision analysis: the image bytes are read to base64 in the
// browser and posted straight to Groq's HTTPS endpoint on the client. Nothing
// is ever written to a Firestore document, so standard message-collection
// write rules can't block it.
async function fileToBase64InMemory(fileOrBlob) {
  // Read the raw file array inside an async FileReader closure, then run a
  // clean text .replace(/^data:image\/\w+;base64,/, '') filter to strip out the
  // duplicate metadata header prefix completely -- leaving only the raw base64
  // character blocks. This prevents duplicate headers from ever appearing in
  // the final request array.
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image file in-memory."));
    reader.readAsDataURL(fileOrBlob);
  });
  const raw = String(dataUrl).replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
  return raw;
}

export async function analyzeImageWithGroq(userUid, input, question = "Describe this image in detail.") {
  try {
    const key = await getApiKeyFresh();
    const personalityKey = await getPersonalityKey(userUid);
    // Accept a raw File/Blob (read in-memory) or an already-base64 / data-URI
    // string. Strip any leading "data:image/...;base64," header so we always
    // pass strictly the raw base64 data string, then wrap it in exactly one
    // properly-formatted data URI for the Groq multimodal content block.
    let raw;
    if (input instanceof Blob) {
      raw = await fileToBase64InMemory(input);
    } else {
      const str = String(input || "");
      raw = str.replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
    }
    const dataUri = `data:image/jpeg;base64,${raw}`;
    const messages = [
      {
        role: "system",
        content: `You are NexText AI analyzing an image. ${getSystemPrompt(personalityKey)} Be helpful, concise, and describe what you see accurately.`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ];
    // Isolated client-side try/catch around the vision fetch so the generic
    // tier / loading error can never bubble up and crash the UI.
    try {
      return await callGroqVision(key, messages);
    } catch (err) {
      const msg = String(err?.message || "");
      if (
        msg.includes("permissions") || msg.includes("403") ||
        msg.includes("model_not_found") || msg.includes("404") ||
        msg.includes("tier") || msg.includes("unauthorized") ||
        msg.includes("quota") || msg.includes("exceeded")
      ) {
        throw new Error("Vision analysis is temporarily unavailable. The vision model may be loading or require a different API key tier.");
      }
      throw err;
    }
  } catch (err) {
    // Hard guard: never let a raw vision error escape to the React tree.
    if (err && String(err.message || "").includes("temporarily unavailable")) throw err;
    throw new Error("Vision analysis failed. Please try again.");
  }
}

// ── Groq Voice-Note Transcription (Whisper) ──
// Transcribes a voice-note audio blob via Groq's OpenAI-compatible audio
// endpoint. Uses the same admin-configured API key as chat/vison; if the app
// isn't AI-enabled this throws the standard "not configured" error.
export async function transcribeVoiceNote(userUid, audioBlob) {
  const key = await getApiKeyFresh();
  if (!audioBlob) throw new Error("No audio provided for transcription.");
  const form = new FormData();
  form.append("file", audioBlob, "voice.mp4");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Groq transcription error (${response.status}): ${errText}`);
  }
  const data = await response.json();
  const text = (data?.text || "").trim();
  if (!text) throw new Error("Transcription returned no text.");
  return text;
}

// ── Smart Group AI Proactivity Filter ──
// Triggers Groq when the message contains "hey nextext" or "hey nextrai"
// (case-insensitive) or ends with a question mark. Keyword-based
// to protect the free-tier token budget.
const AI_TRIGGER_KEYWORD = /^\s*hey\s+(nextext|nextrai)\b/i;
const AI_TRIGGER_QUESTION = /\?\s*$/;

export function shouldTriggerGroupAI(messageText) {
  if (!messageText || typeof messageText !== "string") return false;
  return AI_TRIGGER_KEYWORD.test(messageText) || AI_TRIGGER_QUESTION.test(messageText);
}

export async function sendGroupAIMessage(userUid, chatId, messageText, chatHistory = []) {
  const key = await getApiKeyFresh();
  const personalityKey = await getPersonalityKey(userUid);
  const contextMessages = chatHistory
    .slice(-20)
    .map((m) => ({
      role: m.senderId === AI_CONTACT_UID ? "assistant" : "user",
      content: m.text || "",
    }))
    .filter((m) => m.content);
  const messages = [
    {
      role: "system",
      content: `You are NexText AI participating in a group chat. ${getSystemPrompt(personalityKey)} You are responding because someone mentioned you or asked a question. Be helpful, concise, and relevant to the conversation context. Keep responses under 3 sentences unless detail is requested.`,
    },
    ...contextMessages,
    { role: "user", content: messageText },
  ];
  return callGroq(key, messages, 0.6);
}

// ── Enhanced Transcript Context Summarizer ──
export async function sendAIContextMessageWithActiveChat(userUid, question, chatTranscript, activeChatMessages = []) {
  const key = await getApiKeyFresh();
  const personalityKey = await getPersonalityKey(userUid);
  let contextBlock = "";
  if (activeChatMessages && activeChatMessages.length > 0) {
    const recentText = activeChatMessages
      .slice(-30)
      .map((m) => `${m.senderName || m.senderId || "unknown"}: ${m.text || "[media]"}`)
      .join("\n");
    contextBlock = `\n\nRecent active chat messages for real-time context:\n${recentText}`;
  }
  const messages = [
    {
      role: "system",
      content: `You are NexText AI analyzing chat conversations. ${getSystemPrompt(personalityKey)} The user will ask questions about the transcripts below. Be helpful and concise. You have access to both the full transcript and recent messages from the active chat.`,
    },
    {
      role: "user",
      content: `Here is the chat transcript:\n\n${chatTranscript}${contextBlock}\n\nMy question: ${question}`,
    },
  ];
  return callGroq(key, messages, 0.5);
}
