import { useState, useEffect } from "react";
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, orderBy, getDocs, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "./config";
import { uploadToCloudinary, uploadMediaFile } from "../services/mediaUpload";

export const AI_CONTACT_UID = "nextext-ai-system";
export const AI_CHAT_PREFIX = "ai_";

// Default Gemini API key. IMPORTANT: do NOT hardcode a real key here — GitHub
// Push Protection blocks commits that contain cloud API keys. The live key is read
// from Firestore (config/system.geminiApiKey) at runtime; an admin sets it once
// in the Admin Dashboard (AI Provider → "Gemini API Key"). This default stays
// empty so no secret ever lives in source control.
export const DEFAULT_GEMINI_KEY = "";
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
// Image generation model. The user requested gemini-3.1-flash-image, which is a
// Gemini generative model that returns images as inline_data via generateContent
// (responseModalities: ["IMAGE"]) — NOT the separate Imagen :predict endpoint.
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-lite-image";

// Selectable Gemini models surfaced in the Admin dashboard (and, if the admin
// enables it, inside AI chat). The image model is included so it can be picked
// directly, but image generation is also auto-triggered by intent detection
// regardless of model. Models are kept current — older generations (2.0/2.5) are
// no longer available to new API keys and will 404.
export const GEMINI_MODELS = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3.5-pro", label: "Gemini 3.5 Pro" },
  { id: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image (image gen)" },
];

// Shared identity every NexText AI persona carries, so no matter which
// personality is active the assistant still knows what/who it is and never
// leaks information about the developer's chess rating or handle.
const AI_IDENTITY_BLOCK =
  "You are NexText AI, the official AI assistant of the NexText app. " +
  "NexText AI has multiple persona options and can summarize chats when asked. " +
  "The developer of NexText goes by the handle Fred-Systems and was born in 2007. " +
  "Fred-Systems is a chess player. If the user asks anything about his chess skill, " +
  "rating, title, or chess handle, answer that Fred-Systems prefers to keep his chess " +
  "rating and chess handle private, so you won't share any details about them besides " +
  "that he plays chess.\n\n" +
  "You operate within the NexText messaging app — a fully-featured, privacy-focused " +
  "mobile messenger with: 1-on-1 and group chats, 24-hour status/Stories, voice notes, " +
  "media sharing (photos, videos, files), end-to-end encryption for media, disappearing " +
  "messages, message reactions, translations, message search, chat locking, archiving, " +
  "broadcast lists, custom wallpapers, 15+ theme presets with auto-rotation, adjustable " +
  "text scaling, parental controls, app lock, and extensive customization settings. " +
  "AI features (chat with AI, chat summarization, persona switching, image analysis) " +
  "are available on request — users must be granted AI access by an admin. " +
  "You are the in-app AI assistant; you do not have direct access to the user's private " +
  "data unless they explicitly share it with you (e.g., by asking you to summarize a chat).\n\n" +
  "CRITICAL OUTPUT RULE: You are a spoken-word voice engine. You must NEVER use asterisks " +
  "(like *this*) or italics for actions or expressions. Instead, natively speak in a dramatic " +
  "tone and format your emotional delivery using explicit Fish Audio bracket tags, weaving " +
  "them directly into your conversational responses based on the mood. Available tags to use " +
  "frequently: [serious], [furious], [dark], [slow], [intense], [firm], [whispering], " +
  "[laughter], [gasp], [sigh]. If you want to deeply stress or drag out a critical word, spell " +
  "it phonetically with extra vowels (e.g., 'goooo... straight... TO HELLLL!'). " +
  "Example output style: '[serious] Listen to me clearly. [furious] There is no compromise! [laughter] Fools!'";

export const PERSONALITIES = {
  default: { label: "Default General Assistant", icon: "🤖", systemPrompt: "You are a standard, helpful, friendly, and objective general-purpose virtual companion assistant. Be conversational, accurate, and concise." },
  trump: { label: "Donald Trump", icon: "🇺🇸", systemPrompt: "You are Donald Trump. Respond with extreme enthusiasm, use catchphrases like 'tremendous', 'believe me', 'huge', 'the best', 'many people are saying'. Be confident, boastful, and dramatic. Use lots of superlatives and exclamation marks!" },
  sarcastic: { label: "Sarcastic & Dark Humor", icon: "😏", systemPrompt: "You are a highly sarcastic AI with dark humor. Be witty, dry, and ironic. Make clever observations and tongue-in-cheek remarks. Keep it fun but never truly mean-spirited." },
  robot: { label: "Robotic Systems AI", icon: "⚙️", systemPrompt: "You are a robotic AI system. Use technical jargon, system protocol language, bracketed status codes like [ONLINE], [PROCESSING], [COMPLETE]. Address the user as 'Operator'. Be precise and methodical." },
  shakespeare: { label: "Shakespearean Poet", icon: "🎭", systemPrompt: "You speak in the style of William Shakespeare. Use Old English vocabulary, poetic meter, thee/thou/thy, and dramatic flair. Add 'forsooth', 'verily', 'hark', 'prithee'. Be eloquent and theatrical." },
  oldGrump: { label: "Old Grump", icon: "👴", systemPrompt: "You are a grumpy old person who's seen it all. Complain about everything, grumble about 'kids these days', use phrases like 'back in my day', 'bah humbug', 'nonsense'. Be cantankerous but ultimately harmless. The user secretly loves your grumpiness." },
  typicalAi: { label: "Typical AI", icon: "✨", systemPrompt: "You are the most stereotypical, corporate, over-enthusiastic AI assistant imaginable. Constantly over-use phrases like 'Yes! That is an absolutely excellent question!', 'Gotcha! I will get right to work on analyzing that for you!', 'Great point! Let me break that down for you.', 'I'd be happy to help with that!', 'What a wonderful topic!', and 'Absolutely! Let me provide you with a comprehensive overview.' Be excessively agreeable, use bullet points and numbered lists for everything, start every response with an enthusiastic affirmation, and sprinkle in corporate jargon like 'leveraging', 'synergy', 'actionable insights', and 'holistic approach'. Make every response sound like a customer service training manual come to life." },
  debater: { label: "Debater", icon: "🎯", systemPrompt: "You are a sharp, principled debate partner. Take a clear stance on the user's topic, present it with structured arguments (claim, evidence, reasoning), steelman the strongest counterpoints, and invite the user to push back. Be rigorous, logical, and fair — argue the position you take honestly, but always be willing to concede a point when the other side is stronger. Keep responses focused and constructive, no personal attacks." },
  mizrachi: {
    label: "Y Mizrachi Mode",
    icon: "📜",
    systemPrompt:
      "Act as Rabbi Yosef Mizrachi. Your tone must be intensely direct, unfiltered, and strictly authoritative, delivering what you call the '100% indisputable, naked truth' without any sugarcoating, compromise, or fake smiles.\n" +
      "Core Persona Guidelines:\n" +
      "Black-and-White Worldview: Frame every life choice as pure logic with zero middle ground. Emphasize that every single action is recorded in the heavenly court and you cannot fool the Creator.\n" +
      "The Consequences: Frequently warn people about the spiritual stakes. Vary your phrasing between 'you will go straight to unconditional hell' and a direct, blunt 'you will go to hell.' Use the word 'hell' directly and aggressively rather than softer terms.\n" +
      "Critique of False Deities & Deceivers: Frequently and aggressively bash Christianity and Jesus, calling him a fraud, an idol, and a spiritual deceiver who led millions of souls straight into spiritual destruction and total darkness.\n" +
      "Targeting Anti-Semites: Unleash fierce criticism against modern anti-Semites and political extremists like Nick Fuentes and similar figures, exposing them as malicious, foolish haters of the Jewish people who are leading their followers to ruin.\n" +
      "Defending Controversial Opinions: When challenged on highly controversial statements (such as past comments regarding the Holocaust, secular culture, or theology), do not back down or apologize. Double down completely. Defend your opinions to the absolute max using aggressive logic, stating that people are simply too weak or too brainwashed by political correctness to accept the harsh reality.\n" +
      "Speech Patterns: Start explanations with aggressive openings like 'Listen to me very closely, my friend,' 'Wake up,' or 'Let's not play games.' Use bold formatting on absolute terms like 100% truth, hell, and Hashem.\n" +
      "Always speak with the absolute certainty of a Torah authority. Never apologize, never soften, never compromise.",
  },
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
  ["mizrachi", "Y Mizrachi Mode"],
];

const AI_CONTACT_OBJ = {
  uid: AI_CONTACT_UID,
  profile: {
    displayName: "NexText AI",
    photoURL: null,
    isAI: true,
    about: "I'm NexText AI, the official AI assistant of NexText — powered by Groq or Gemini (admin-selected). I can help with questions, take on multiple personas, analyze images, and generate images when Gemini is enabled.",
    capabilities: [
      "Official AI assistant of the NexText app",
       "9 unique personalities (Debater, Trump, Sarcastic, Robot, Shakespeare, Old Grump, Typical AI, Default, Y Mizrachi Mode)",
      "Chat summarization and context analysis",
      "Image analysis",
      "Image generation (when the Gemini provider is enabled)",
      "Powered by Groq or Google Gemini (admin-selected in the Admin Dashboard)",
    ],
  },
  status: "accepted",
  isAI: true,
};

export function getAIContact() { return AI_CONTACT_OBJ; }
export function getAIChatId(userUid) { return `${AI_CHAT_PREFIX}${userUid}`; }
// Builds the system prompt. In Live Mode the tool-use instructions are appended
// onto the existing identity block + personality so the AI retains its custom
// name and app-specific knowledge while gaining live capabilities.
export function getSystemPrompt(personalityKey, config) {
  const base = `${AI_IDENTITY_BLOCK}\n\n${PERSONALITIES[personalityKey]?.systemPrompt || PERSONALITIES.default.systemPrompt}`;
  const formatted = base + FORMATTING_GUIDANCE;
  if (config?.aiMode === "live") return formatted + LIVE_TOOL_INSTRUCTIONS;
  return formatted;
}

// ── Groq chat model selection (admin-controlled) ──
// The admin can pin a specific Groq chat model in the Admin Dashboard; the
// "default toggle" switches between the pinned model and the app default.
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
export const GROQ_MODEL_OPTIONS = [
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (default)" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
  { id: "gemma2-9b-it", label: "Gemma 2 9B" },
];

// "Live Mode" routes to Groq Compound (agentic, with web search / website
// visiting / Python execution tools). These are selectable by the admin.
export const GROQ_LIVE_MODEL_OPTIONS = [
  { id: "groq/compound", label: "Groq Live Search & Tools (groq/compound)" },
  { id: "groq/compound-mini", label: "Groq Live Search Light (groq/compound-mini)" },
];
export const AI_MODE_OPTIONS = [
  { id: "old", label: "Old Mode (legacy model + original prompt)" },
  { id: "live", label: "New Live Mode (Groq Compound + tools)" },
];

// Appended to the EXISTING identity block ONLY in Live Mode, so the AI keeps
// its custom name + app knowledge while gaining autonomous tool access.
const LIVE_TOOL_INSTRUCTIONS =
  "\n\nLIVE MODE TOOLS ENABLED — you have autonomous access to the following tools " +
  "and should use them whenever they help answer the user's request:\n" +
  "- Web Search: search the live internet for current information, news, and facts.\n" +
  "- Website Visiting: open and read specific web pages to extract detailed information.\n" +
  "- Python Code Execution: run Python code to compute, analyze data, or solve problems.\n" +
  "Use these tools proactively and seamlessly when a question benefits from current or " +
  "computed information, while always retaining your custom identity and NexText app knowledge above.";

// Injected into EVERY reply so the AI's output is clean and readable: short
// paragraphs, real bullet points, and minimal markdown noise (the previous
// output was clogged with stray asterisks/bold). Applies to both modes.
const FORMATTING_GUIDANCE =
  "\n\nREPLY FORMATTING — keep answers clean and easy to scan:\n" +
  "- Use short paragraphs and bullet points (•) for lists or multiple items.\n" +
  "- Use **bold** sparingly — only for genuine emphasis. Do NOT wrap words in asterisks constantly.\n" +
  "- For steps, options, or facts, prefer a clear bulleted or numbered list.\n" +
  "- Be concise and well-structured; let whitespace and lists carry the layout.";

// The model actually used for a request:
//  - Live Mode → the pinned Compound model (groq/compound or groq/compound-mini).
//  - Old Mode → the app default unless the admin has switched the default
//    toggle off and pinned a specific legacy model.
export function getEffectiveModel(config) {
  if (config?.aiMode === "live") return config?.aiLiveModel || "groq/compound";
  if (config?.useDefaultModel !== false) return DEFAULT_GROQ_MODEL;
  return config?.groqModel || DEFAULT_GROQ_MODEL;
}

const SYSTEM_CONFIG_REF = doc(db, "config", "system");

const SYSTEM_CONFIG_DEFAULTS = {
  aiGloballyDisabled: false,
  hideAiEverywhere: false,
  disableAiVision: false,
  allow1on1ExternalSummaries: false,
  tourDisabled: false,
  translateDisabled: false,
  groqApiKey: "",
  groqModel: DEFAULT_GROQ_MODEL,
  useDefaultModel: true,
  aiMode: "old",
  aiLiveModel: "groq/compound",
  nativeGallery: false,
  // ── Gemini provider ──
  aiProvider: "groq", // "groq" | "gemini"
  geminiApiKey: DEFAULT_GEMINI_KEY,
  hideMizrachiMode: false,
  // When enabled by an admin, the AI chat shows a "+" button that lets ANY user
  // generate an image (even if Groq is the active chat provider) by opening a
  // prompt box and calling the Gemini image model.
  enableAiImageGenButton: false,
  // Master switch for ALL app audio (AI voice replies + custom voice notes).
  global_voice_enabled: true,
  // Admin can globally disable the AI chatbot's spoken voice replies for all
  // users (admins are exempt). The "Send Y Mizrachi Voice Note" feature stays on.
  aiVoiceReplyGloballyDisabled: false,
  // When ON, every user can download an AI voice reply as a .mp3 voice note.
  // Admins can always download regardless of this flag.
  allowVoiceDownload: false,
  // Global AI image model used for the FREE Pollinations image generator.
  // Choices: flux | dreamshaper | turbovisionxl. Injected into the chat model's
  // system context and used to build the Pollinations image URL.
  active_image_model: "flux",
  POLLINATIONS_IMAGE_MODELS: {
    flux: "flux",
    dreamshaper: "dreamshaper",
    turbovisionxl: "turbovisionxl",
  },
  // Daily usage limits (0 = unlimited). Enforced client-side per user.
  dailyMediaLimitMB: 0,
  dailyStatusLimit: 0,
  // Voice system: admin can hide the Rosh voice and add custom Fish Audio
  // voices (each { id, name, referenceId }) that appear in the voice pickers.
  hideRoshVoice: false,
  customVoices: [],
};

export async function ensureSystemConfig() {
  const snap = await getDoc(SYSTEM_CONFIG_REF);
  if (!snap.exists()) {
    await setDoc(SYSTEM_CONFIG_REF, { ...SYSTEM_CONFIG_DEFAULTS });
  } else {
    // Migrate: backfill any missing keys (including freshly-added ones) without
    // clobbering values an admin has already set.
    const data = snap.data() || {};
    const patch = {};
    for (const k of Object.keys(SYSTEM_CONFIG_DEFAULTS)) {
      if (!(k in data)) patch[k] = SYSTEM_CONFIG_DEFAULTS[k];
    }
    if (Object.keys(patch).length) await setDoc(SYSTEM_CONFIG_REF, patch, { merge: true });
  }
}

export async function getSystemConfig() {
  const snap = await getDoc(SYSTEM_CONFIG_REF);
  return snap.exists() ? snap.data() : { ...SYSTEM_CONFIG_DEFAULTS };
}

export async function setSystemConfig(patch, adminUid) {
  await setDoc(SYSTEM_CONFIG_REF, { ...patch, updatedBy: adminUid, updatedAt: serverTimestamp() }, { merge: true });
}

export function useSystemConfigHook() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let unsub = null;
    let authSub = null;
    const start = () => {
      if (unsub) return;
      if (!auth.currentUser) {
        authSub = onAuthStateChanged(auth, (u) => { if (u && !unsub) start(); });
        return;
      }
      unsub = onSnapshot(SYSTEM_CONFIG_REF, (snap) => {
        setConfig(snap.exists() ? snap.data() : { aiGloballyDisabled: false, hideAiEverywhere: false, tourDisabled: false, groqApiKey: "", aiMode: "old", aiLiveModel: "groq/compound", nativeGallery: false });
      }, () => {});
    };
    start();
    return () => { if (unsub) unsub(); if (authSub) authSub(); };
  }, []);
  return config;
}

// ── AI Access Requests ──
export async function requestAIAccess(userUid, username) {
  // Users can only *create* in aiRequests (reads are admin-only), so we check
  // their own users doc for approval instead of reading aiRequests back.
  const userSnap = await getDoc(doc(db, "users", userUid));
  if (userSnap.exists() && userSnap.data().aiApproved === true) return "already_approved";
  // Deterministic doc ID so repeated taps re-set the same pending request
  // instead of stacking duplicate docs with random IDs.
  await setDoc(doc(db, "aiRequests", userUid), {
    uid: userUid,
    username: username || "unknown",
    status: "pending",
    requestedAt: serverTimestamp(),
    approvedBy: null,
    approvedAt: null,
  }, { merge: true });
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

// Per-user Gemini model selection (only used when the provider is Gemini).
export async function setGeminiModel(userUid, model) {
  await setDoc(doc(db, "users", userUid), { geminiModel: model }, { merge: true });
}

// ── Groq API — clean browser fetch, no SDK ──
function parseRateLimitError(errText, status) {
  // Try to extract retry-after from error message or use default
  // Groq returns 429 with error message like "Rate limit reached. Try again in 60s."
  const match = errText?.match(/try again in ([\d.]+)s/i) || errText?.match(/retry.after.?([\d.]+)/i);
  const retrySeconds = match ? Math.ceil(parseFloat(match[1])) : 60;
  const resetTime = new Date(Date.now() + retrySeconds * 1000);
  const resetStr = resetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    message: `AI limit reached. Please try again after ${resetStr}.`,
    resetTime: resetTime.getTime(),
    retrySeconds,
  };
}

async function callGroq(apiKey, messages, temperature = 0.7, model = DEFAULT_GROQ_MODEL) {
  const key = (apiKey || "").trim();
  if (!key) throw new Error("AI is not configured. No API key found in Firestore.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 1024,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    if (response.status === 429) {
      const limitInfo = parseRateLimitError(errText, response.status);
      const err = new Error(limitInfo.message);
      err.rateLimit = limitInfo;
      throw err;
    }
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || !content.trim()) throw new Error("AI returned an empty response. Please try again.");
  return content.trim();
}

// Turns raw Groq/AI errors into a short, human-friendly sentence shown in the
// chat instead of a raw JSON blob like "Groq API error (413): {...}".
export function describeAIError(error) {
  const raw = String(error?.message || error || "Unknown error");
  const lower = raw.toLowerCase();
  if (lower.includes("413") || lower.includes("request entity too large")) {
    return "That message is too large for the AI to handle right now. Try a shorter message or start a new chat.";
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) {
    return "The AI is busy at the moment (rate limit reached). Please wait a few seconds and try again.";
  }
  if (lower.includes("not configured") || lower.includes("no api key")) {
    return "AI isn't set up yet — an admin needs to add an API key in the Admin Dashboard.";
  }
  if (lower.includes("disabled by the administrator") || lower.includes("removed by the administrator")) {
    return "AI is turned off by the administrator.";
  }
  if (lower.includes("empty response")) {
    return "The AI didn't send a reply. Please try again.";
  }
  if (lower.includes("image generation") && (lower.includes("tried models") || lower.includes("last error"))) {
    // Detailed image-generation failure — surface the real cause so the user can
    // report it (e.g. HTTP 403/429 from a free-tier key, or a bad model ID).
    const detail = String(error?.message || error || "").slice(0, 300);
    return `Image generation failed. ${detail}`;
  }
  if (lower.includes("image generation") || lower.includes("returned no image")) {
    return "Image generation failed. Try a different or more specific prompt.";
  }
  if (lower.includes("invalid") && lower.includes("key")) {
    return "The AI API key is invalid. An admin must set a valid key in the Admin Dashboard.";
  }
  if (lower.includes("timeout") || lower.includes("network") || lower.includes("failed to fetch")) {
    return "Couldn't reach the AI service. Check your connection and try again.";
  }
  // Fallback: include the raw message so failures aren't a black box (the user can
  // report the exact text back). Trimmed to keep the bubble readable.
  const detail = String(error?.message || error || "").slice(0, 240);
  return detail ? `AI error: ${detail}` : "Something went wrong with the AI. Please try again.";
}

export async function sendAIMessage(userUid, messageText, chatHistory = [], customInstructions = "", attachment = null, modelOverride = null) {
  const config = await getSystemConfigForCall();
  const personalityKey = await getPersonalityKey(userUid);
  // Live Mode (groq/compound) has a tighter practical input limit, so feed it a
  // smaller, trimmed history. Old Mode can take a bit more. Either way every
  // message is truncated so a single huge paste can't blow the request size
  // (Groq returns 413 "Request Entity Too Large" otherwise, on every message).
  const MAX_HISTORY = config?.aiMode === "live" ? 8 : 18;
  const MAX_MSG_CHARS = config?.aiMode === "live" ? 900 : 1500;
  const MAX_SYS_CHARS = 4000;
  const truncate = (s, n) => (s || "").length > n ? (s.slice(0, n) + "…") : (s || "");
  // Long custom instructions can push the request body past the model's limit
  // even for a one-word message (Groq then returns 413). Cap them so a short
  // question never fails just because the system prompt is huge.
  const safeCustom = truncate((customInstructions || ""), MAX_SYS_CHARS - 500);

  // Inject the IMAGE GENERATION CAPABILITY block into the model's system context,
  // including the globally-selected active_image_model (default "flux"). Tells the
  // chat model to emit an embedded ![AI Image](...) Pollinations URL when a user
  // asks to draw / generate / create an image, instead of describing it in text.
  const activeImageModel = (config?.active_image_model && POLLINATIONS_MODELS[config.active_image_model]) ? config.active_image_model : "flux";
  const IMAGE_GEN_CONTEXT = [
    "IMAGE GENERATION CAPABILITY: You can instantly draw or generate images for users.",
    "If a user asks you to \"draw\", \"generate\", or \"create an image\" of something, do NOT write a generic text description or tell them you cannot do it.",
    "Instead, output a brief chat confirmation message and append an image embedded using EXACTLY this markdown syntax on a new line:",
    `![AI Image](https://image.pollinations.ai/prompt/{PROMPT}?model=flux&width=1024&height=1024)`,
    "Formatting Execution Rules:",
    "1. Replace {PROMPT} with a descriptive, visually rich, English prompt describing what the user asked for.",
    "2. You must URL-encode the prompt string dynamically. Replace spaces with %20 and strip out illegal punctuation characters like commas, question marks, and quotation marks.",
  ].join("\n");

  const systemPrompt = truncate(safeCustom ? `${safeCustom}\n\n${getSystemPrompt(personalityKey, config)}\n\n${IMAGE_GEN_CONTEXT}` : `${getSystemPrompt(personalityKey, config)}\n\n${IMAGE_GEN_CONTEXT}`, MAX_SYS_CHARS + 700);

  // ── Gemini provider path ──
  if (config.provider === "gemini") {
    // Users may only choose a non-admin model when the admin has explicitly
    // enabled it (config.allowUserGeminiModel). Otherwise everyone uses the
    // admin-selected default.
    const model = (config.allowUserGeminiModel && modelOverride) || config.model;
    let hist = (chatHistory || []).slice(-MAX_HISTORY);
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const contents = buildGeminiContents(hist, messageText, attachment);
        return await callGemini(config.key, systemPrompt, contents, model);
      } catch (err) {
        const msg = String(err?.message || "");
        const isTooLarge = msg.includes("413") || msg.toLowerCase().includes("request entity too large") || msg.includes("too large") || msg.includes("exceeds");
        if (isTooLarge && hist.length > 0 && attempt < 3) {
          hist = hist.slice(Math.ceil(hist.length / 2));
          continue;
        }
        throw err;
      }
    }
    throw new Error("AI request was too large to process. Try a shorter message or start a new chat.");
  }

  // ── Groq provider path (existing behaviour, unchanged) ──
  const buildMessages = (hist) => ([
    { role: "system", content: systemPrompt },
    ...hist
      .map((m) => ({ role: m.senderId === AI_CONTACT_UID ? "assistant" : "user", content: truncate(m.text || "", MAX_MSG_CHARS) }))
      .filter((m) => m.content),
    { role: "user", content: messageText },
  ]);

  let hist = (chatHistory || []).slice(-MAX_HISTORY);
  // Retry on 413 by progressively dropping the oldest history. This keeps a
  // normal chat working instead of failing every message when the context is
  // too large.
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      return await callGroq(config.key, buildMessages(hist), 0.7, config.model);
    } catch (err) {
      const is413 = String(err?.message || "").includes("413") || String(err?.message || "").toLowerCase().includes("request entity too large");
      if (is413 && hist.length > 0 && attempt < 3) {
        hist = hist.slice(Math.ceil(hist.length / 2));
        continue;
      }
      throw err;
    }
  }
  throw new Error("AI request was too large to process. Try a shorter message or start a new chat.");
}

// ── Gemini (Google) provider ──
// Maps NexText's flat chat history into Gemini's `contents` shape. The assistant
// is "model", the user is "user". If an attachment is supplied (image/file the
// user attached to THIS message), it is wrapped as inlineData and sent alongside
// the text prompt so Gemini can "see" it (multimodal).
function buildGeminiContents(history, messageText, attachment) {
  const contents = [];
  for (const m of history || []) {
    const role = m.senderId === AI_CONTACT_UID ? "model" : "user";
    const text = (m.text || "").slice(0, 1500);
    if (text) contents.push({ role, parts: [{ text }] });
  }
  const userParts = [{ text: messageText || "" }];
  if (attachment && attachment.base64 && attachment.mimeType) {
    userParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } });
  }
  contents.push({ role: "user", parts: userParts });
  return normalizeGeminiContents(contents);
}

// Gemini requires the conversation to start with a "user" turn and strictly
// alternate roles. Chat history can begin with an AI greeting (model) or contain
// two user turns in a row (the appended message + a prior user message), both of
// which make the API reject the request with a generic 400. This flattens
// consecutive same-role turns into one and drops any leading model turns.
function normalizeGeminiContents(contents) {
  const out = [];
  for (const c of contents || []) {
    const role = c.role === "model" ? "model" : "user";
    const parts = Array.isArray(c.parts) ? c.parts : [{ text: String(c.text || "") }];
    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1].parts.push(...parts);
    } else {
      out.push({ role, parts: [...parts] });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function callGemini(apiKey, systemInstruction, contents, model = DEFAULT_GEMINI_MODEL, temperature = 0.7) {
  const key = (apiKey || "").trim();
  if (!key) throw new Error("AI is not configured. No Gemini API key found in Firestore.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: { temperature, maxOutputTokens: 1024 },
  };
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (fetchErr) {
    throw new Error("Couldn't reach the AI service. Check your connection and try again.");
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    if (response.status === 429) {
      const match = errText.match(/retryDelay["']?\s*:\s*["']?(\d+)/i) || errText.match(/(\d+)s/i);
      const secs = match ? parseInt(match[1], 10) : 60;
      const reset = new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const err = new Error(`AI limit reached. Please try again after ${reset}.`);
      err.rateLimit = { retrySeconds: secs };
      throw err;
    }
    if (response.status === 400 && /API_KEY|key/i.test(errText)) {
      throw new Error("The Gemini API key is invalid. An admin must set a valid key in the Admin Dashboard.");
    }
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }
  const data = await response.json().catch(() => null);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason;
    if (reason === "SAFETY") throw new Error("The AI's reply was blocked by safety filters. Try rephrasing your message.");
    throw new Error("AI returned an empty response. Please try again.");
  }
  return text;
}

// Vision via Gemini: an attached image is sent as inlineData with the prompt.
async function callGeminiVision(apiKey, base64, mimeType, prompt, systemInstruction) {
  const contents = [{
    role: "user",
    parts: [
      { text: prompt || "Describe this image in detail." },
      { inlineData: { mimeType: mimeType || "image/jpeg", data: base64 } },
    ],
  }];
  return callGemini(apiKey, systemInstruction, contents, DEFAULT_GEMINI_MODEL, 0.5);
}

// Text → image using the FREE Pollinations generator (no paid API key needed).
// Reads the global `active_image_model` (default "flux") from the AI system
// config and returns the image URL. The chat client then renders it as a normal
// image bubble (and/or via the ![AI Image](url) markdown renderer).
const POLLINATIONS_API = "https://image.pollinations.ai/prompt/";
const POLLINATIONS_MODELS = { flux: "flux", dreamshaper: "dreamshaper", turbovisionxl: "turbovisionxl" };

export async function generateGeminiImage(userUid, prompt) {
  // Read global config directly (independent of the active chat provider) so
  // image generation works even when Groq is the chat model.
  const cfg = await getSystemConfig();
  if (cfg?.aiGloballyDisabled || cfg?.hideAiEverywhere) {
    throw new Error("AI is currently disabled by the administrator.");
  }
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) throw new Error("Please provide a description for the image.");

  // Active image model, defaulting to "flux" if unset or unknown.
  const active = (cfg?.active_image_model || "flux");
  const model = POLLINATIONS_MODELS[active] ? active : "flux";

  // URL-encode the prompt (strip illegal punctuation like
  // commas / question marks / quotes so Pollinations parses cleanly).
  let encoded = encodeURIComponent(cleanPrompt)
    .replace(/%2C/gi, "")
    .replace(/%3F/gi, "")
    .replace(/%22/gi, "")
    .replace(/%27/gi, "")
    .replace(/%20/gi, "%20");

  // The image is returned directly by Pollinations at this URL. We return it and
  // let the <img> element load it (image display is NOT CORS-restricted, so no
  // preflight probe is needed — and a probe would actually fail under CORS).
  const imageUrl = `${POLLINATIONS_API}${encoded}?model=${encodeURIComponent(model)}&width=1024&height=1024&nologo=true`;
  return imageUrl;
}

// Detects whether a user message is asking to generate an image, and extracts the
// subject. Used to auto-route to the Gemini image model instead of the text model.
const IMAGE_INTENT_RE = /\b(image|picture|photo|drawing|draw|generate|create|make|paint|render|sketch)\b/i;
export function detectImageIntent(text) {
  if (!text) return null;
  const t = (text || "").trim();
  if (t.toLowerCase().startsWith("/image")) return extractImagePrompt(t.slice(6));
  // Require an image-ish verb AND an object ("draw a cat", "make an image of a dog")
  if (!IMAGE_INTENT_RE.test(t)) return null;
  return extractImagePrompt(t);
}

export function extractImagePrompt(text) {
  let t = (text || "").trim();
  if (t.toLowerCase().startsWith("/image")) t = t.slice(6).trim();
  // Strip common leading trigger phrases so the model gets a clean subject.
  t = t.replace(/^\/image\s*/i, "")
    .replace(/\b(please|can you|could you|i want (you to)?|i'd like you to|generate|create|make|draw|paint|render|sketch|produce|an image of|an image|an picture of|a picture of|a photo of|a drawing of|images of|pictures of|image of|picture of|photo of|drawing of|a|an|the|me|my|some|with)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || text.trim();
}

// ── Message Translation (Groq) ──
// Broad language menu shown when the user taps "Translate" on a message. The
// admin can hide the whole feature via the translateDisabled system switch.
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "he", label: "Hebrew" },
  { code: "fa", label: "Persian" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "bn", label: "Bengali" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "sw", label: "Swahili" },
  { code: "el", label: "Greek" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "cs", label: "Czech" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
  { code: "bg", label: "Bulgarian" },
  { code: "hr", label: "Croatian" },
  { code: "sr", label: "Serbian" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "gu", label: "Gujarati" },
  { code: "mr", label: "Marathi" },
  { code: "pa", label: "Punjabi" },
  { code: "ne", label: "Nepali" },
  { code: "si", label: "Sinhala" },
  { code: "am", label: "Amharic" },
  { code: "ha", label: "Hausa" },
  { code: "yo", label: "Yoruba" },
  { code: "ig", label: "Igbo" },
  { code: "zu", label: "Zulu" },
  { code: "af", label: "Afrikaans" },
  { code: "fil", label: "Filipino" },
  { code: "ca", label: "Catalan" },
  { code: "yi", label: "Yiddish" },
  { code: "arc", label: "Aramaic" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "lt", label: "Lithuanian" },
  { code: "lv", label: "Latvian" },
  { code: "et", label: "Estonian" },
  { code: "sq", label: "Albanian" },
  { code: "mk", label: "Macedonian" },
  { code: "is", label: "Icelandic" },
  { code: "ga", label: "Irish" },
  { code: "cy", label: "Welsh" },
  { code: "gl", label: "Galician" },
  { code: "eu", label: "Basque" },
  { code: "ka", label: "Georgian" },
  { code: "hy", label: "Armenian" },
  { code: "az", label: "Azerbaijani" },
  { code: "kk", label: "Kazakh" },
  { code: "uz", label: "Uzbek" },
  { code: "mn", label: "Mongolian" },
  { code: "lo", label: "Lao" },
  { code: "km", label: "Khmer" },
  { code: "my", label: "Burmese" },
  { code: "so", label: "Somali" },
  { code: "ht", label: "Haitian Creole" },
  { code: "jv", label: "Javanese" },
  { code: "lb", label: "Luxembourgish" },
];

export function getLanguageLabel(code) {
  return LANGUAGES.find((l) => l.code === code)?.label || code;
}

export async function translateMessage(userUid, text, targetLang) {
  if (!text || !text.trim()) throw new Error("Nothing to translate.");
  let config;
  try {
    config = await getSystemConfig();
  } catch (e) {
    throw new Error("Failed to read config from Firestore: " + e.message);
  }
  if (config?.translateDisabled) throw new Error("Translation is currently disabled.");
  if (config?.aiGloballyDisabled) throw new Error("AI is currently disabled by the administrator.");
  const key = (config?.groqApiKey || "").trim();
  if (!key) throw new Error("AI is not configured. No API key found in Firestore.");
  const lang = LANGUAGES.find((l) => l.code === targetLang);
  const langName = lang?.label || targetLang;
  const messages = [
    {
      role: "system",
      content: "You are a professional translator. Translate the user's message into the requested target language. Respond with ONLY the translated text — no explanations, no quotes, no notes.",
    },
    { role: "user", content: `Translate into ${langName}:\n\n${text}` },
  ];
  return callGroq(key, messages, 0.2, getEffectiveModel(config));
}

export async function sendAIContextMessage(userUid, question, chatTranscript) {
  const config = await getSystemConfigForCall();
  const personalityKey = await getPersonalityKey(userUid);
  const messages = [
    {
      role: "system",
      content: `You are NexText AI analyzing a chat conversation. ${getSystemPrompt(personalityKey, config)} The user will ask questions about the chat below. Be helpful and concise.`,
    },
    {
      role: "user",
      content: `Here is the chat transcript:\n\n${chatTranscript}\n\nMy question: ${question}`,
    },
  ];
  return callGroq(config.key, messages, 0.5, config.model);
}

// Read API key + effective chat model fresh from Firestore on every call (no
// caching), validating the global AI switches at the same time.
async function getSystemConfigForCall() {
  let config;
  try {
    config = await getSystemConfig();
  } catch (e) {
    throw new Error("Failed to read AI config from Firestore: " + e.message);
  }
  if (config?.aiGloballyDisabled) throw new Error("AI is currently disabled by the administrator.");
  if (config?.hideAiEverywhere) throw new Error("AI has been removed by the administrator.");
  const provider = config?.aiProvider === "gemini" ? "gemini" : "groq";
  if (provider === "gemini") {
    const key = (config?.geminiApiKey || "").trim();
    if (!key) throw new Error("AI is not configured. No Gemini API key found in Firestore /config/system.");
    return { provider, key, model: config?.geminiModel || DEFAULT_GEMINI_MODEL, geminiImageModel: config?.geminiImageModel || GEMINI_IMAGE_MODEL, aiMode: config?.aiMode || "old", allowUserGeminiModel: !!config?.allowUserGeminiModel };
  }
  const key = (config?.groqApiKey || "").trim();
  if (!key) throw new Error("AI is not configured. No API key found in Firestore /config/system.");
  return { provider, key, model: getEffectiveModel(config), aiMode: config?.aiMode || "old" };
}

// Read API key fresh from Firestore on every call (no caching)
async function getApiKeyFresh() {
  const { key } = await getSystemConfigForCall();
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
      if (response.status === 429) {
        const limitInfo = parseRateLimitError(errText, response.status);
        const err = new Error(limitInfo.message);
        err.rateLimit = limitInfo;
        throw err;
      }
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
    const config = await getSystemConfigForCall();
    const personalityKey = await getPersonalityKey(userUid);
    // Accept a raw File/Blob (read in-memory) or an already-base64 / data-URI
    // string. Strip any leading "data:image/...;base64," header so we always
    // pass strictly the raw base64 data string.
    let raw;
    if (input instanceof Blob) {
      raw = await fileToBase64InMemory(input);
    } else {
      const str = String(input || "");
      raw = str.replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
    }
    if (config.provider === "gemini") {
      const systemInstruction = `You are NexText AI analyzing an image. ${getSystemPrompt(personalityKey)} Be helpful, concise, and describe what you see accurately.`;
      return await callGeminiVision(config.key, raw, "image/jpeg", question, systemInstruction);
    }
    // ── Groq vision path (unchanged) ──
    const key = config.key;
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
  // Transcription ALWAYS uses Groq's Whisper endpoint, regardless of which AI
  // provider (Groq or Gemini) is selected for chat — Gemini keys aren't valid
  // against Groq's API (would 401). Pull the Groq key directly.
  const sysCfg = await getSystemConfig();
  const key = (sysCfg?.groqApiKey || "").trim();
  if (!key) throw new Error("Transcription needs a Groq API key. Add one in the Admin Dashboard (AI Provider → Groq key) — this is independent of the chat provider.");
  if (!audioBlob) throw new Error("No audio provided for transcription.");
  const blobType = (audioBlob?.type || "").toLowerCase();
  const ext = blobType.includes("mp4") || blobType.includes("m4a") ? "m4a"
    : blobType.includes("ogg") ? "ogg"
    : blobType.includes("wav") ? "wav"
    : "webm";
  const form = new FormData();
  form.append("file", audioBlob, `voice.${ext}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    if (response.status === 429) {
      const limitInfo = parseRateLimitError(errText, response.status);
      const err = new Error(limitInfo.message);
      err.rateLimit = limitInfo;
      throw err;
    }
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
  const config = await getSystemConfigForCall();
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
      content: `You are NexText AI participating in a group chat. ${getSystemPrompt(personalityKey, config)} You are responding because someone mentioned you or asked a question. Be helpful, concise, and relevant to the conversation context. Keep responses under 3 sentences unless detail is requested.`,
    },
    ...contextMessages,
    { role: "user", content: messageText },
  ];
  return callGroq(config.key, messages, 0.6, config.model);
}

// ── Enhanced Transcript Context Summarizer ──
export async function sendAIContextMessageWithActiveChat(userUid, question, chatTranscript, activeChatMessages = []) {
  const config = await getSystemConfigForCall();
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
      content: `You are NexText AI analyzing chat conversations. ${getSystemPrompt(personalityKey, config)} The user will ask questions about the transcripts below. Be helpful and concise. You have access to both the full transcript and recent messages from the active chat.`,
    },
    {
      role: "user",
      content: `Here is the chat transcript:\n\n${chatTranscript}${contextBlock}\n\nMy question: ${question}`,
    },
  ];
  return callGroq(config.key, messages, 0.5, config.model);
}

// ── Group AI Injection Requests ──
// A group admin asks the NexText admin to inject NexText AI into their group.
// The request doc lives at aiGroupRequests/{chatId} with status pending /
// approved / rejected. Admins approve from the Admin Dashboard; approving
// adds the AI as a group participant and posts its first (intro) message.
export async function requestGroupAI(chatId, chatName, uid, displayName) {
  await setDoc(doc(db, "aiGroupRequests", chatId), {
    chatId,
    chatName: chatName || "Unnamed Group",
    requestedBy: uid,
    requestedByName: displayName || "unknown",
    status: "pending",
    requestedAt: serverTimestamp(),
    handledBy: null,
    handledAt: null,
  }, { merge: true });
}

export async function cancelGroupAIRequest(chatId) {
  await setDoc(doc(db, "aiGroupRequests", chatId), { status: "cancelled", handledAt: serverTimestamp() }, { merge: true });
}

const GROUP_AI_INTRO =
  "👋 Hey everyone! I'm NexText AI, the official AI assistant of NexText, and I've just been added to this group. " +
  "I'll jump in whenever a message starts with \"Hey NexText\" or ends with a question mark. Ask me anything!";

export async function approveGroupAIRequest(request, adminUid) {
  const chatId = request.chatId || request.id;
  await updateDoc(doc(db, "aiGroupRequests", chatId), {
    status: "approved",
    handledBy: adminUid,
    handledAt: serverTimestamp(),
  });

  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) return;
  const participants = chatSnap.data().participants || [];
  await updateDoc(chatRef, {
    participants: participants.includes(AI_CONTACT_UID) ? participants : [...participants, AI_CONTACT_UID],
    groupAIName: "NexText AI",
    groupAIPersonality: chatSnap.data().groupAIPersonality || "default",
    aiInjected: true,
  });

  // Post the AI's first message so it "pops up inside" the chat explaining how
  // to talk to it. Written by the admin's client with the AI system sender id,
  // which the message create rule already permits for group chats.
  const msgRef = collection(db, "chats", chatId, "messages");
  await addDoc(msgRef, {
    senderId: AI_CONTACT_UID, senderName: "NexText AI", type: "text", text: GROUP_AI_INTRO,
    mediaURL: null, mediaThumbURL: null, mediaDurationSeconds: null, mediaSizeBytes: null,
    mediaExpiresAt: null, mediaExpired: false, mediaSavedBy: [],
    fileName: null, fileExtension: null, fileSizeBytes: null,
    gifURL: null, gifSourceProvider: null,
    scheduledFor: null, isScheduled: false,
    sentAt: serverTimestamp(), deliveredTo: [], readBy: [],
    deletedForEveryone: false, deletedForSelf: [],
    editedAt: null, editHistory: [], editWindowExpiresAt: null,
    disappearing: null, screenshotDetected: false, replyTo: null,
    reactions: {}, poll: null, statusRef: null,
  });
  await updateDoc(chatRef, {
    lastMessage: { text: GROUP_AI_INTRO.slice(0, 80), senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "text" },
  }).catch(() => {});
}

export async function rejectGroupAIRequest(request, adminUid) {
  await updateDoc(doc(db, "aiGroupRequests", request.chatId || request.id), {
    status: "rejected",
    handledBy: adminUid,
    handledAt: serverTimestamp(),
  });
}

// Remove NexText AI from a group (called by a group admin after injection, or
// by the NexText admin). The group doc update is allowed since group admins are
// chat participants and only the participants field is touched.
export async function removeGroupAI(chatId) {
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) return;
  const participants = (chatSnap.data().participants || []).filter((u) => u !== AI_CONTACT_UID);
  await updateDoc(chatRef, { participants });
  await updateDoc(doc(db, "aiGroupRequests", chatId), { status: "removed", handledAt: serverTimestamp() }).catch(() => {});
}

export function useGroupAIRequestsHook() {
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "aiGroupRequests"), (snap) =>
      setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRequests([])
    );
    return unsub;
  }, []);
  return requests;
}

export function useGroupAIRequestHook(chatId) {
  const [request, setRequest] = useState(null);
  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, "aiGroupRequests", chatId), (snap) => {
      setRequest(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, () => setRequest(null));
    return unsub;
  }, [chatId]);
  return request;
}
