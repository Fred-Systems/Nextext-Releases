import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, Send, Plus, MoreVertical, Trash2, Image as ImageIcon, Users, X, Smile, Archive, Copy, Forward, MessageSquare, Download } from "lucide-react";
import VoiceToTextButton from "../components/VoiceToTextButton";
import VoiceWaveform from "../components/VoiceWaveform";
import { getAvailableVoices, resolveVoice, synthesizeSpeechBytes, Y_MIZRACHI_VOICE_ID, sanitizeForTTS } from "../firebase/tts";
import { uploadToCloudinary } from "../services/mediaUpload";
import { saveVoiceBlob, loadVoiceBlob } from "../utils/voiceCache";
import { registerAudioPlay, unregisterAudioPlay } from "../utils/exclusiveAudio";
import { useTheme } from "../theme/ThemeContext";
import { useGlobalSettings } from "../firebase/config-settings";
import { doc, getDoc, setDoc, onSnapshot, collection, query, orderBy, addDoc, serverTimestamp, updateDoc, getDocs, writeBatch, where, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { deleteChatCompletely, sendMediaMessage, checkAndIncrementDailyLimit } from "../firebase/chats";
import { uploadChatFile } from "../supabase/media";
import { AI_CONTACT_UID, AI_CHAT_PREFIX, sendAIMessage, sendAIContextMessageWithActiveChat, analyzeImageWithGroq, generateGeminiImage, detectImageIntent, GEMINI_MODELS, DEFAULT_GEMINI_MODEL, PERSONALITIES, AI_PERSONA_TRAY, getVisiblePersonaTray, getPersonaMeta, setAIPersonality, setGeminiModel, useSystemConfigHook, describeAIError } from "../firebase/ai";
import { useAIIconStyle, getAIIconStyle, setUserAIIconStyle } from "../services/aiIcon";
import Avatar from "../components/Avatar";
import { downloadMedia, downloadImage } from "../utils/download";

function ThinkingDots({ color = "#000" }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: color,
          animation: `thinking-bounce 0.6s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
      <style jsx>{`
        @keyframes thinking-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
          40% { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const MSG_FIELDS = {
  mediaURL: null, mediaThumbURL: null, mediaDurationSeconds: null, mediaSizeBytes: null,
  mediaExpiresAt: null, mediaExpired: false, mediaSavedBy: [],
  fileName: null, fileExtension: null, fileSizeBytes: null,
  gifURL: null, gifSourceProvider: null,
  scheduledFor: null, isScheduled: false,
  deliveredTo: [], readBy: [],
  deletedForEveryone: false, deletedForSelf: [],
  editedAt: null, editHistory: [], editWindowExpiresAt: null,
  disappearing: null, screenshotDetected: false, replyTo: null,
  reactions: {}, poll: null, statusRef: null,
};

const EMOJI_PICKER_SET = [
  "😀", "😂", "🥹", "😍", "😘", "😎", "🤔", "😴",
  "😭", "😡", "🥳", "😇", "🤗", "🙄", "😬", "🤯",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "✌️",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔",
  "🔥", "✨", "🎉", "🎂", "🍕", "☕", "🌟", "💯",
  "😊", "😅", "🥰", "😜", "🤩", "🤤", "😢", "🤣",
];

function buildMsg(overrides) {
  return { ...MSG_FIELDS, ...overrides, sentAt: overrides.sentAt || serverTimestamp() };
}

// AI chat bubbles render plain text, so markdown emphasis from the model
// (bold **…**, italics *…*, code backticks, heading #) shows up as raw
// asterisks/hashes. Strip those markers for a clean summary read-out.
function cleanAIText(text) {
  if (!text) return text;
  return String(text)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Renders AI message text with *single* and **double** asterisks converted to
// bold (asterisks stripped), so model-emitted emphasis actually shows up bold
// instead of as raw characters.
function renderAIBold(text, onOpenImage) {
  if (!text) return text;
  const str = String(text);
  // Extract embedded ![AI Image](url) markdown and render it as a real <img>
  // with a skeleton/loading state, instead of showing raw markdown text.
  const imgRe = /!\[([^\]]*)\]\(([^)\s]+)\)/;
  if (imgRe.test(str)) {
    const m = imgRe.exec(str);
    const url = m[2];
    const before = str.slice(0, m.index);
    const after = str.slice(m.index + m[0].length);
    return (
      <div key={url}>
        {before ? <div>{renderAIBold(before, onOpenImage)}</div> : null}
        <AIImage src={url} onOpen={onOpenImage} />
        {after ? <div style={{ marginTop: 6 }}>{renderAIBold(after, onOpenImage)}</div> : null}
      </div>
    );
  }
  const parts = str.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
    return p;
  });
}

// Renders an AI image with a skeleton spinner while the (often slow) Pollinations
// endpoint finishes generating the raw image binary.
function AIImage({ src, onOpen, style = {} }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useTheme();
  const download = async () => {
    if (!src || saving) return;
    setSaving(true);
    await downloadImage(src, `nextext-ai-image-${Date.now()}.png`);
    setSaving(false);
  };
  // Safety: if the image never fires onLoad/onError (e.g. the generator stalls),
  // stop spinning after a while and surface a fallback.
  useEffect(() => {
    const to = setTimeout(() => { if (!loaded && !errored) setErrored(true); }, 45000);
    return () => clearTimeout(to);
  }, [src, loaded, errored]);
  if (errored) {
    return (
      <div style={{ position: "relative", margin: "6px 0", borderRadius: 8, overflow: "hidden", background: t.bubbleThem, padding: "14px 16px", ...style }}>
        <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.4 }}>
          Image couldn't be generated.
          <a href={src} target="_blank" rel="noreferrer" style={{ color: t.primary, marginLeft: 6, textDecoration: "underline" }}>Open in browser</a>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: "relative", margin: "6px 0", borderRadius: 8, overflow: "hidden", background: t.bubbleThem, ...style }}>
      {!loaded && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, padding: "22px 30px", color: t.textMuted }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", border: `3px solid ${t.border}`, borderTopColor: t.primary, animation: "nextext-spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Generating image…</span>
        </div>
      )}
      <img
        src={src}
        alt="AI Image"
        crossOrigin="anonymous"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        onClick={() => loaded && onOpen && onOpen(src)}
        style={{ display: "block", maxWidth: 220, maxHeight: 280, borderRadius: 8, cursor: "pointer", background: "#000", visibility: loaded ? "visible" : "hidden", width: "100%", height: "auto", objectFit: "cover" }}
      />
      {loaded && (
        <div
          onClick={(e) => { e.stopPropagation(); download(); }}
          title="Download image"
          style={{ position: "absolute", top: 6, right: 6, width: 30, height: 30, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          {saving ? (
            <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "nextext-spin 0.8s linear infinite", display: "inline-block" }} />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          )}
        </div>
      )}
    </div>
  );
}

// Ordinal suffix (1st, 2nd, 3rd, 4th, …) for date divider labels.
function getOrdinalSuffix(day) {
  if (day > 3 && day < 21) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

// WhatsApp-style divider label: "Today", "Yesterday", or "Friday, July 24th".
// Includes the year only when the message is from a previous calendar year.
function formatAIDateDivider(date) {
  if (!date) return "";
  const d = new Date(date);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const dayNum = d.getDate();
  const ordinal = getOrdinalSuffix(dayNum);
  const year = d.getFullYear();
  if (year !== today.getFullYear()) {
    return `${weekday}, ${month} ${dayNum}${ordinal}, ${year}`;
  }
  return `${weekday}, ${month} ${dayNum}${ordinal}`;
}

// Auto-playing audio player for AI voice replies. Chrome 83's WebView can block
// the `autoplay` attribute until a user gesture, so we also attempt an explicit
// play() once the media is ready (the reply that triggered it came from a user
// message, so a gesture has typically happened). Shows an animated sound-wave
// while speaking, and a download action when permitted.
function AutoAudio({ src, canDownload }) {
  const { t } = useTheme();
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tryPlay = () => { try { el.play().catch(() => {}); } catch {} };
    tryPlay();
    if (el.readyState >= 3) return;
    const to = setTimeout(tryPlay, 600);
    return () => clearTimeout(to);
  }, [src]);
  const download = () => {
    downloadMedia(src, "y-mizrachi-voice.mp3");
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <VoiceWaveform playing={playing} color={t.primary} size={22} />
        {canDownload && (
          <div
            onClick={download}
            title="Download voice note"
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: t.primary, cursor: "pointer", padding: "3px 8px", borderRadius: 8, border: `1px solid ${t.border}` }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Save
          </div>
        )}
      </div>
      <audio
        ref={ref}
        src={src}
        controls
        autoPlay
        playsInline
        onPlay={() => { setPlaying(true); registerAudioPlay(ref.current); }}
        onPause={() => { setPlaying(false); unregisterAudioPlay(ref.current); }}
        onEnded={() => { setPlaying(false); unregisterAudioPlay(ref.current); }}
        style={{ width: "100%", maxWidth: 240, display: "block", borderRadius: 8 }}
      />
    </div>
  );
}

export default function AIChatScreen({ myUid, onBack }) {
  const { t, composerButtonOrder, voiceSpacing } = useTheme();
  const globalSettings = useGlobalSettings();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPersonaTray, setShowPersonaTray] = useState(false);
  const [showIconTray, setShowIconTray] = useState(false);
  const aiIcon = useAIIconStyle();
  const [showProfile, setShowProfile] = useState(false);
  const [userDoc, setUserDoc] = useState(null);
  // Declared early (before the voice-reply effect that lists it in its deps) so
  // React can read it from the dependency array during render without hitting a
  // temporal-dead-zone ReferenceError.
  const currentPersonality = userDoc?.aiPersonality || "default";
  const [analyzing, setAnalyzing] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [showChatPicker, setShowChatPicker] = useState(false);
  const [allChats, setAllChats] = useState([]);
  const [contactNames, setContactNames] = useState({});
  const [showPodcast, setShowPodcast] = useState(false);
  const [podcastVoices, setPodcastVoices] = useState([]);
  const [podcastMode, setPodcastMode] = useState("auto");
  const [podcastTopic, setPodcastTopic] = useState("");
  const [podcastLength, setPodcastLength] = useState("medium"); // veryShort | short | medium | long | veryLong
  const [podcastHeat, setPodcastHeat] = useState("normal"); // calm | normal | heated | fiery
  const [podcastSpeakerNotes, setPodcastSpeakerNotes] = useState({}); // voiceId -> note
  // 5 length tiers with an estimated duration label and the turn-count range
  // sent to the model. Duration is an estimate from ~avg spoken turn length.
  const PODCAST_LENGTH_OPTIONS = [
    { val: "veryShort", label: "Very Short", est: "~25s", range: [2, 3] },
    { val: "short", label: "Short", est: "~50s", range: [4, 6] },
    { val: "medium", label: "Medium", est: "~1m30s", range: [7, 10] },
    { val: "long", label: "Long", est: "~3m", range: [11, 16] },
    { val: "veryLong", label: "Very Long", est: "~6m+", range: [18, 30] },
  ];
  const PODCAST_HEAT_OPTIONS = [
    { val: "calm", label: "Calm", desc: "polite agreement, gentle and harmonious exchange" },
    { val: "normal", label: "Normal", desc: "light disagreement, friendly back-and-forth" },
    { val: "heated", label: "Heated", desc: "strong clashing opinions, voices raised, passionate debate" },
    { val: "fiery", label: "Fiery", desc: "aggressive, interrupting, intensely passionate argument" },
  ];
  const [podcastBusy, setPodcastBusy] = useState(false);
  const [podcastStatus, setPodcastStatus] = useState("");
  const [podcastResult, setPodcastResult] = useState(null); // { url, publicId }
  const [summarizingExternal, setSummarizingExternal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [fsScale, setFsScale] = useState(1);
  const fsPinchRef = useRef(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState(null);
  const [activeMsgRect, setActiveMsgRect] = useState(null);
  const messageMenuRef = useRef(null);
  const longPressTimer = useRef(null);
  // Swipe-right-to-reply-with-quote (WhatsApp-style), mirroring the regular chat.
  const [replyTo, setReplyTo] = useState(null);
  const [replyDrag, setReplyDrag] = useState(null);
  const dragStartRef = useRef({});
  const dragBubbleRef = useRef(null);
  const dragRafRef = useRef(null);
  const longPressFiredRef = useRef(false);
  const [pendingForwardMsg, setPendingForwardMsg] = useState(null);
  const [chatPickerMode, setChatPickerMode] = useState(null); // 'forward' | 'summarize'
  const [aiTextScale, setAiTextScale] = useState(() => {
    try { return Math.min(1.6, Math.max(0.6, Number(localStorage.getItem("nextext_ai_text_scale")) || 1)); } catch { return 1; }
  });
  const sysConfig = useSystemConfigHook();
  const visionDisabled = !!sysConfig?.disableAiVision;
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [genError, setGenError] = useState("");
  const scrollRef = useRef(null);
  const imageInputRef = useRef(null);
  const pinchStartRef = useRef(null);
  const chatId = `${AI_CHAT_PREFIX}${myUid}`;

  // ── AI Podcast / multi-voice conversation ──
  const availableVoices = getAvailableVoices(sysConfig);
  const togglePodcastVoice = (id) => {
    setPodcastVoices((prev) => {
      if (prev.includes(id)) {
        setPodcastSpeakerNotes((n) => { const c = { ...n }; delete c[id]; return c; });
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };
  // Parse the AI's script output into a list of {voiceId, text} turns.
  const parsePodcastScript = (raw, fallbackVoices) => {
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      const arr = JSON.parse(match ? match[0] : raw);
      if (Array.isArray(arr)) {
        return arr
          .filter((l) => l && (l.text || l.line))
          .map((l) => ({ voiceId: l.voiceId || fallbackVoices[0], text: (l.text || l.line || "").toString() }));
      }
    } catch {}
    // Fallback: one line for the first selected voice.
    return [{ voiceId: fallbackVoices[0], text: raw.trim() }];
  };
  const generatePodcast = async () => {
    const voices = podcastVoices.length ? podcastVoices : [availableVoices[0]?.id].filter(Boolean);
    if (podcastBusy || voices.length < 1) return;
    setPodcastBusy(true);
    setPodcastStatus("Writing the conversation…");
    try {
      // Map a podcast voice id back to its PERSONALITIES key (preset voices),
      // so we can inject that persona's own systemPrompt/label verbatim.
      const VOICE_TO_PERSONA = { "y-mizrachi": "mizrachi", trump: "trump", magnus: "magnusC" };
      // A varied pool of genuinely divisive seed topics so every run argues a
      // different hot-button issue. One is picked at random each generation.
      const CONTROVERSIAL_TOPICS = [
        "Should social media platforms ban political misinformation, or is that censorship?",
        "Is remote work freeing workers or destroying company culture?",
        "Should religious symbols be displayed in public schools?",
        "Is artificial intelligence a threat to human creativity and jobs?",
        "Should governments regulate or outright ban cryptocurrency?",
        "Is the death penalty ever justified?",
        "Should universities abolish standardized testing?",
        "Is nuclear energy the real solution to climate change?",
        "Should parents have the right to refuse vaccines for their children?",
        "Is cancel culture protecting the vulnerable or silencing debate?",
        "Should billionaires be heavily taxed to fund social programs?",
        "Is gun ownership a fundamental right or a public-safety risk?",
        "Should animals have the same legal rights as humans?",
        "Is globalism helping or hurting the working class?",
        "Should governments impose a meat tax to fight climate change?",
        "Is free speech absolute, even for hate speech?",
        "Should the voting age be lowered to 16?",
        "Is space exploration worth the cost while Earth has problems?",
        "Should single-use plastic be banned entirely?",
        "Is homeschooling better than public education?",
      ];
      const ANGLES = [
        "from a deeply personal, lived-experience angle",
        "with a sharp focus on economic impact",
        "through a generational clash",
        "using historical precedents",
        "through the lens of moral philosophy",
        "with a skeptical, facts-and-logic lens",
        "through the lens of personal freedom",
        "with emotional, real-world stories",
      ];
      const seedTopic = CONTROVERSIAL_TOPICS[Math.floor(Math.random() * CONTROVERSIAL_TOPICS.length)];
      const seedAngle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
      // Build PER-VOICE instructions: pull the admin director profile
      // (fullName, prompt, speakStyle) AND the persona's own systemPrompt/label,
      // and force the model to write that speaker's lines in that exact voice.
      const voiceMeta = voices.map((id, idx) => {
        const v = availableVoices.find((x) => x.id === id);
        const prof = sysConfig?.voiceProfiles?.[id] || {};
        const personaKey = prof.persona || VOICE_TO_PERSONA[id] || (id.startsWith("persona_") ? id.slice(7) : null);
        const personaDef = personaKey ? (PERSONALITIES[personaKey] || {}) : {};
        const fullName = prof.fullName || personaDef.fullName || v?.name || id;
        const personaPrompt = personaDef.systemPrompt || prof.prompt || "";
        const speakStyle = prof.speakStyle || personaDef.speakStyle || "";
        const note = (podcastSpeakerNotes[id] || "").trim();
        let line = `- Speaker ${idx + 1} (voiceId: "${id}", NAME: ${fullName}):`;
        if (personaPrompt) line += `\n  PERSONA = ${personaPrompt}`;
        if (speakStyle) line += `\n  SPEAKING STYLE = ${speakStyle}`;
        line += `\n  Speak EXACTLY like this persona — mirror this exact word choice, tone, mannerisms, and Fish Audio brackets. NEVER break character or speak in another speaker's voice.`;
        if (note) line += `\n  This speaker's direction: ${note}`;
        return line;
      }).join("\n");
      const modeLine = podcastMode === "auto"
        ? `Debate this SPECIFIC controversial topic (do NOT substitute a different one): "${seedTopic}". Approach it ${seedAngle}. Force GENUINELY CLASHING, opposing viewpoints — this is a real disagreement, not polite agreement.`
        : `Follow the user's direction below for what the conversation should be about and each speaker's opinion/style:\n${podcastTopic}`;
      const lenEntry = PODCAST_LENGTH_OPTIONS.find((o) => o.val === podcastLength) || PODCAST_LENGTH_OPTIONS[2];
      const heatEntry = PODCAST_HEAT_OPTIONS.find((o) => o.val === podcastHeat) || PODCAST_HEAT_OPTIONS[1];
      // Randomize the angle each run so the same topic is never repeated verbatim.
      const seed = Math.floor(Math.random() * 1e9).toString(36);
      const instruction =
        "You are producing a multi-speaker AI podcast script. Output STRICTLY a JSON array (no markdown, no code fences) of objects {\"voiceId\": string, \"text\": string}. " +
        "Each 'text' is one spoken turn of under 220 characters. Use Fish Audio bracket tags like [serious], [laughing], [slow], [whispering] for emotion — NEVER asterisks or italics. " +
        "Extend stressed vowels for emphasis. Keep it punchy and conversational.\n" +
        "Speakers (use the exact voiceId values), each MUST stay 100% in their documented character:\n" + voiceMeta + "\n" +
        "CRITICAL — do NOT write generic, default, or interchangeable dialogue. Each speaker's lines MUST reflect ONLY their own PERSONA / SPEAKING STYLE above. " +
        "Never let a speaker sound like another speaker, and NEVER ignore the per-speaker persona or the admin direction. " +
        "Let each speaker's documented speaking style shape word choice, tone, and the Fish Audio brackets. " +
        "Mode: " + modeLine + "\n" +
        "Tone / confrontational intensity: " + heatEntry.label + " — " + heatEntry.desc + ".\n" +
        `Randomize the specific angle and seed (${seed}) — do NOT repeat a previous generic topic; pick a fresh, surprising take every time.\n` +
        `Produce EXACTLY between ${lenEntry.range[0]} and ${lenEntry.range[1]} short spoken turns, alternating speakers naturally.`;
      let raw = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await sendAIMessage(myUid, "Generate the podcast script now.", [], instruction, null, null, true);
          if (r && r.trim()) { raw = r; break; }
        } catch (e) { lastErr = e; }
      }
      // NOTE: we deliberately do NOT synthesize a fake fallback script here. If
      // the model returns empty / errors / or returns a safety refusal (e.g.
      // "I'm sorry, but I can't help with that"), we surface that as a clear
      // error instead of handing it to the TTS engine and producing a 1-second
      // clip of the refusal.
      if (!raw || !raw.trim()) {
        throw new Error(lastErr?.message || "The AI didn't return a podcast script. Try a different topic or angle.");
      }
      const lines = parsePodcastScript(raw, voices);
      // parsePodcastScript only yields multiple turns when the model actually
      // emitted a JSON array. If it returned plain text (a refusal or a non-JSON
      // reply), it collapses to a single entry whose text IS the raw reply — do
      // not synthesize that as the podcast. The full script (all turns) is
      // synthesized only when the model returned a real array.
      const modelReturnedScript = lines.length > 1 || (lines.length === 1 && /\[[\s\S]*\]/.test(raw));
      if (!modelReturnedScript) {
        throw new Error("The AI returned a reply instead of a podcast script (it may have refused the topic). Try a different topic or angle.");
      }
      setPodcastStatus("Synthesizing voices…");
      const buffers = [];
      let okTurns = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const v = availableVoices.find((x) => x.id === line.voiceId) || availableVoices.find((x) => x.id === voices[0]);
        const text = sanitizeForTTS(line.text);
        if (!text) continue;
        setPodcastStatus(`Synthesizing turn ${i + 1} of ${lines.length} (${v?.name || "voice"})…`);
        try {
          const blob = await synthesizeSpeechBytes(text, v?.referenceId || Y_MIZRACHI_VOICE_ID);
          const buf = await blob.arrayBuffer();
          buffers.push(new Uint8Array(buf));
          okTurns += 1;
        } catch (e) {
          console.warn("[podcast] turn failed:", e?.message);
        }
      }
      if (okTurns === 0) throw new Error("All podcast turns failed to synthesize — check the voice key.");
      // Concatenate every turn into ONE recording so the podcast plays as a
      // single, continuous conversation between the selected voices.
      const total = buffers.reduce((a, b) => a + b.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of buffers) { merged.set(b, off); off += b.length; }
      const file = new File([merged], "podcast.mp3", { type: "audio/mpeg" });
      setPodcastStatus("Uploading podcast…");
      // Upload the conversation recording to Cloudinary (audio is the "video"
      // resource type) and keep it in the builder area with a download button —
      // it is NOT posted back into the chat.
      const cloud = await uploadToCloudinary(file, { resourceType: "video" });
      setPodcastResult({ url: cloud.url, publicId: cloud.path, turns: okTurns });
      setPodcastStatus("Podcast ready! ✓");
      setPodcastBusy(false);
    } catch (err) {
      setPodcastStatus("Error: " + (err?.message || "failed"));
      setPodcastBusy(false);
    }
  };

  // ── Voice replies (Fish Audio / Y Mizrachi) ──
  const voiceMasterOn = sysConfig?.global_voice_enabled !== false;
  const isAdmin = userDoc?.role === "admin";
  const canDownloadVoice = isAdmin || sysConfig?.allowVoiceDownload === true;
  // AI voice replies / podcasts are OFF by default and must be enabled by an admin
  // (globally via systemConfig, or per-user via users/{uid}.aiFeatures).
  const voiceReplyAvailable = (sysConfig?.aiVoiceReplyEnabled === true || userDoc?.aiFeatures?.voiceReply === true) && voiceMasterOn && !sysConfig?.aiVoiceReplyGloballyDisabled;
  const podcastAvailable = sysConfig?.aiPodcastEnabled === true || userDoc?.aiFeatures?.podcast === true;
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoVoiceReplies, setAutoVoiceReplies] = useState(false);
  const [voiceAudios, setVoiceAudios] = useState({}); // { messageId: blobUrl }
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [generatingVoiceId, setGeneratingVoiceId] = useState(null);
  const syncedMsgRef = useRef(new Set());

  // Sync the toggle from the user's stored flag.
  useEffect(() => {
    if (userDoc?.user_tts_enabled != null) setVoiceEnabled(userDoc.user_tts_enabled === true);
  }, [userDoc?.user_tts_enabled]);

  // Per-user chosen voice (Y Mizrachi / Rosh / Trump / Magnus / custom).
  const [voiceMode, setVoiceModeState] = useState("y-mizrachi");
  useEffect(() => {
    if (userDoc?.ai_voice_mode) setVoiceModeState(userDoc.ai_voice_mode);
  }, [userDoc?.ai_voice_mode]);
  const setVoiceMode = async (id) => {
    setVoiceModeState(id);
    try { await setDoc(doc(db, "users", myUid), { ai_voice_mode: id }, { merge: true }); } catch {}
  };

  const toggleVoiceReplies = async () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    try {
      const { setUserTtsEnabled } = await import("../firebase/tts");
      await setUserTtsEnabled(myUid, next);
    } catch {}
  };

  // Synthesize a single AI message into a voice note (used both for auto-reply
  // and for the per-message "Generate audio response" button). Cached via
  // IndexedDB so it survives reload and is kept until the chat is cleared.
  const generateOneVoice = async (msg) => {
    const msgId = msg.id;
    if (!msgId || voiceAudios[msgId] || syncedMsgRef.current.has(msgId)) return;
    // Daily AI voice-reply limit (admins exempt).
    if (!isAdmin) {
      const limit = userDoc?.aiLimits?.voiceReply || sysConfig?.defaultVoiceReplyLimit || 0;
      if (limit > 0) {
        const res = await checkAndIncrementDailyLimit(myUid, "voiceReply", limit).catch(() => ({ allowed: true }));
        if (!res.allowed) return;
      }
    }
    syncedMsgRef.current.add(msgId);
    setGeneratingVoiceId(msgId);
    try {
      const tts = await import("../firebase/tts");
      const personaRef = sysConfig?.personaVoiceMap?.[currentPersonality] || getPersonaMeta(currentPersonality, sysConfig).voiceRef || PERSONALITIES[currentPersonality]?.voiceRef;
      const voice = personaRef ? { referenceId: personaRef } : resolveVoice(sysConfig, voiceMode);
      let blob = await loadVoiceBlob(msgId);
      if (!blob) {
        blob = await tts.synthesizeSpeechBytes(sanitizeForTTS(msg.text), voice?.referenceId);
        await saveVoiceBlob(msgId, blob).catch(() => {});
      }
      setVoiceAudios((prev) => ({ ...prev, [msgId]: URL.createObjectURL(blob) }));
    } catch (err) {
      console.error("[tts] voice synthesis failed for", msgId, err?.message);
    } finally {
      setGeneratingVoiceId((id) => (id === msgId ? null : id));
    }
  };

  // When a NEW assistant text message arrives AND the user has opted into
  // auto-play ("Generate audio automatically"), synthesize it. Otherwise the user
  // taps "Generate audio response" on each message.
  useEffect(() => {
    if (!voiceMasterOn || !voiceEnabled || !autoVoiceReplies) return;
    if (sysConfig?.aiVoiceReplyGloballyDisabled && !isAdmin) return;
    if (voiceBusy) return;
    const candidate = (messages || []).find((m) => m.senderId === AI_CONTACT_UID && m.type !== "image" && (m.text || "").trim() && !syncedMsgRef.current.has(m.id) && !voiceAudios[m.id] && !m.voiceUrl);
    if (!candidate) return;
    const msgId = candidate.id;
    setVoiceBusy(true);
    syncedMsgRef.current.add(msgId);
      (async () => {
        try {
          await generateOneVoice(candidate);
        } catch (err) {
          console.error("[tts] voice synthesis failed for", msgId, err?.message);
        }
        setVoiceBusy(false);
      })();
  }, [messages, voiceMasterOn, voiceEnabled, autoVoiceReplies, voiceBusy, voiceAudios, currentPersonality]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinchEnabled = () => {
    try { return localStorage.getItem("nextext_pinch_zoom") !== "false"; } catch { return true; }
  };

  const onMessagesTouchStart = (e) => {
    if (!pinchEnabled() || e.touches.length !== 2) { pinchStartRef.current = null; return; }
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    pinchStartRef.current = { dist: d, scale: aiTextScale };
  };

  const onMessagesTouchMove = (e) => {
    if (!pinchEnabled() || e.touches.length !== 2 || !pinchStartRef.current) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchStartRef.current.dist > 0) {
      const next = Math.min(1.6, Math.max(0.6, pinchStartRef.current.scale * (d / pinchStartRef.current.dist)));
      if (Math.abs(next - aiTextScale) >= 0.03) setAiTextScale(Math.round(next * 20) / 20);
    }
  };

  const onMessagesTouchEnd = () => { pinchStartRef.current = null; };

  useEffect(() => {
    localStorage.setItem("nextext_ai_text_scale", String(aiTextScale));
  }, [aiTextScale]);

  useEffect(() => {
    if (!myUid) return;
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("sentAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [chatId, myUid]);

  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => setUserDoc(snap.data()));
    return unsub;
  }, [myUid]);

  // Close message action menu on outside click. We test against the live menu
  // element via a ref rather than a CSS selector — the previous selector
  // (style*="minWidth: 160") never matched because React serializes inline
  // styles to "min-width: 160px", so taps inside the menu were treated as
  // "outside" and closed it before the option's onClick could run.
  useEffect(() => {
    const handler = (e) => {
      if (activeMessageId && messageMenuRef.current && !messageMenuRef.current.contains(e.target)) {
        setActiveMessageId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("touchstart", handler); };
  }, [activeMessageId]);

  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "chats", chatId), (snap) => {
      const data = snap.data();
      setIsArchived(!!data?.archivedBy?.includes(myUid));
    });
    return unsub;
  }, [chatId, myUid]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      messagesRef.current.forEach((m) => {
        if (m.type === "image" && m.mediaExpiresAt && m.mediaExpiresAt < now) {
          deleteAIMediaMessage(m.id, m.mediaPath);
        }
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const ensureChatExists = async () => {
    const chatRef = doc(db, "chats", chatId);
    const snap = await getDoc(chatRef);
    if (!snap.exists()) {
      await setDoc(chatRef, {
        participants: [myUid, AI_CONTACT_UID],
        type: "direct",
        createdAt: serverTimestamp(),
        lastMessage: null,
        unreadCount: {},
      });
    }
  };

  // Generate an image from the "+" button (works even when Groq is the active
  // chat provider — it always calls the Gemini image model directly).
  const handleGenerateImage = async (explicit) => {
    const prompt = (typeof explicit === "string" ? explicit : imagePrompt).trim();
    if (!prompt || sending) return;
    setShowImagePrompt(false);
    setImagePrompt("");
    setGenError("");
    setSending(true);
    setThinking(true);
    try {
      await ensureChatExists();
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: myUid, type: "text", text: `🖼️ Generate: ${prompt}`,
      }));
      const url = await generateGeminiImage(myUid, prompt);
      setThinking(false);
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "image", text: null,
        mediaURL: url, mediaExpiresAt: null, mediaExpired: false,
      }));
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: { text: "🖼️ Generated an image", senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "image" },
      });
    } catch (err) {
      setThinking(false);
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: describeAIError(err),
      }));
    }
    setReplyTo(null);
    setSending(false);
  };

  const handleSend = async (overrideText) => {
    const text = (typeof overrideText === "string" ? overrideText : (input || "")).trim();
    if (!text || sending) return;
    // ── Image generation triggers (Gemini only) ──
    // Explicit /image command OR natural-language intent ("draw a cat", "make an
    // image of a sunset"). Bypasses the text model and calls the Gemini image model.
    const imagePrompt = (sysConfig?.aiProvider === "gemini") ? detectImageIntent(text) : null;
    if (imagePrompt) {
      setInput("");
      setSending(true);
      setThinking(true);
      try {
        await ensureChatExists();
        await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
          senderId: myUid, type: "text", text,
        }));
        const url = await generateGeminiImage(myUid, imagePrompt);
        setThinking(false);
        await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
          senderId: AI_CONTACT_UID, type: "image", text: null,
          mediaURL: url, mediaExpiresAt: null, mediaExpired: false,
        }));
        await updateDoc(doc(db, "chats", chatId), {
          lastMessage: { text: "🖼️ Generated an image", senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "image" },
        });
      } catch (err) {
        setThinking(false);
        await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
          senderId: AI_CONTACT_UID, type: "text", text: describeAIError(err),
        }));
      }
      setReplyTo(null);
      setSending(false);
      return;
    }
    setInput("");
    setSending(true);
    setThinking(true);
    try {
      await ensureChatExists();
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: myUid, type: "text", text, replyTo,
      }));
      const customInstructions = (typeof window !== "undefined" && localStorage.getItem("nextext_ai_custom_instructions_enabled") !== "off") ? (localStorage.getItem("nextext_ai_custom_instructions") || "") : "";
      const aiResponse = await sendAIMessage(myUid, text, messages, customInstructions, null, geminiModel, voiceEnabled);
      setThinking(false);
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: aiResponse,
      }));
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: { text: aiResponse.slice(0, 80) + (aiResponse.length > 80 ? "…" : ""), senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "text" },
      });
    } catch (err) {
      setThinking(false);
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: describeAIError(err),
      }));
    }
    setReplyTo(null);
    setSending(false);
  };

  const sttEnabled = localStorage.getItem("nextext_stt_enabled") !== "off";
  const sttAutoSend = localStorage.getItem("nextext_stt_autosend") !== "off";
  const handleSttResult = (text, { autoSend } = {}) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    setInput((prev) => (prev ? (prev.endsWith(" ") ? prev : prev + " ") : "") + trimmed);
    if (autoSend) handleSend(trimmed);
  };

  const deleteAIMediaMessage = async (messageId, mediaPath) => {
    try {
      if (mediaPath) await deleteChatFile(mediaPath).catch(() => {});
      await deleteDoc(doc(db, "chats", chatId, "messages", messageId));
    } catch {
      /* silent */
    }
  };

  const clearChat = async () => {
    setShowClearConfirm(false);
    setShowSettings(false);
    setMessages([]);
    setFullscreenImage(null);
    setVoiceAudios({});
    try {
      const snap = await getDocs(collection(db, "chats", chatId, "messages"));
      const docs = snap.docs;
      // Firestore writeBatch supports at most 500 operations — chunk so a long
      // chat (which would otherwise throw and leave the old messages behind,
      // making the cleared chat "come back") is fully wiped.
      for (let i = 0; i < docs.length; i += 450) {
        const batch = writeBatch(db);
        docs.slice(i, i + 450).forEach((d) => {
          const data = d.data();
          if (data.mediaPath) deleteChatFile(data.mediaPath).catch(() => {});
          batch.delete(d.ref);
        });
        await batch.commit();
      }
    } catch {
      /* silent */
    }
    await updateDoc(doc(db, "chats", chatId), { lastMessage: null }).catch(() => {});
  };

  // ── Message actions: copy, forward, ask AI ──────────────────────────
  const copyMessageText = async (text) => {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); }
      else {
        const ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, ta.value.length);
        document.execCommand("copy"); document.body.removeChild(ta);
      }
      // Show feedback
      try { navigator.vibrate(10); } catch {}
      // Small delay so user sees the menu close after the action
      setTimeout(() => setActiveMessageId(null), 50);
    } catch { /* ignore */ }
  };

  const forwardMessage = async (msg) => {
    setShowChatPicker(true);
    setChatPickerMode("forward");
    setPendingForwardMsg(msg);
    setActiveMessageId(null);
    // Load all chats for forwarding
    try {
      const { getDocs, collection, query, orderBy } = await import("firebase/firestore");
      const { db } = await import("../firebase/config");
      const snap = await getDocs(query(collection(db, "chats"), where("participants", "array-contains", myUid)));
      const chats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllChats(chats);
      // Load contact names for display
      const names = {};
      for (const c of chats) {
        if (c.type === "direct") {
          const otherUid = (c.participants || []).find((p) => p !== myUid);
          if (otherUid) {
            const userSnap = await getDoc(doc(db, "users", otherUid));
            if (userSnap.exists()) names[otherUid] = userSnap.data().displayName || userSnap.data().username || otherUid.slice(0, 6);
          }
        } else if (c.type === "group") {
          names[c.id] = c.name || "Group";
        }
      }
      setContactNames(names);
    } catch { /* ignore */ }
  };

  const handleForwardConfirm = async (targetChatId) => {
    const msg = pendingForwardMsg;
    if (!msg || !targetChatId) return;
    try {
      await addDoc(collection(db, "chats", targetChatId, "messages"), buildMsg({
        senderId: myUid, type: "text", text: msg.text,
      }));
      await updateDoc(doc(db, "chats", targetChatId), {
        lastMessage: { text: msg.text.slice(0, 80) + (msg.text.length > 80 ? "…" : ""), senderId: myUid, sentAt: serverTimestamp(), type: "text" },
      }).catch(() => {});
    } catch { /* ignore */ }
    setPendingForwardMsg(null);
    setShowChatPicker(false);
  };

  // ── Swipe-right to reply with a quote ─────────────────────────────
  const startReply = (m) => {
    const preview = m.text
      ? m.text.slice(0, 120)
      : (m.type === "image" ? "📷 Photo" : m.type === "voice" ? "🎤 Voice note" : "[media]");
    setReplyTo({ id: m.id, previewText: preview, senderName: m.senderId === myUid ? "Me" : "AI" });
    setActiveMessageId(null);
  };

  const onAIMsgTouchStart = (m, e) => {
    const t0 = e.touches && e.touches[0];
    if (!t0) return;
    dragStartRef.current = { id: m.id, y: t0.clientY, x: t0.clientX, time: Date.now(), moved: false };
    // The touch handler is on the element with data-bubble, so currentTarget IS that element
    dragBubbleRef.current = e.currentTarget.hasAttribute("data-bubble") ? e.currentTarget : e.currentTarget.querySelector("[data-bubble]");
    longPressFiredRef.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    // Long-press copies the message text (kept from the original behavior).
    longPressTimer.current = setTimeout(() => {
      if (dragStartRef.current.id === m.id) {
        longPressFiredRef.current = true;
        copyMessageText(m.text);
      }
    }, 500);
  };

  const onAIMsgTouchMove = (m, e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    // Fix: check if x is defined (not undefined), not falsy — x can be 0 at left edge
    const startX = dragStartRef.current.x ?? 0;
    const dx = t.clientX - startX;
    const dy = t.clientY - dragStartRef.current.y;
    if (Math.abs(dy) > 10 || Math.abs(dx) > 12) {
      dragStartRef.current.moved = true;
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    }
    if (longPressFiredRef.current) return;
    if (dragStartRef.current.id !== m.id) return;
    // Swipe RIGHT only: bubble follows the finger with rubber-band resistance.
    // Increased multiplier for more visible movement; capped at 160px.
    const x = Math.min(160, Math.max(0, dx * 0.75));
    const bubbleEl = dragBubbleRef.current;
    if (bubbleEl) { bubbleEl.style.transition = "none"; bubbleEl.style.transform = `translateX(${x}px)`; }
  };

  const onAIMsgTouchEnd = (m, e) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (dragRafRef.current) { cancelAnimationFrame(dragRafRef.current); dragRafRef.current = null; }
    if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
    const t1 = e.changedTouches && e.changedTouches[0];
    if (!t1) { setReplyDrag(null); return; }
    const dx = t1.clientX - dragStartRef.current.x;
    const dt = Date.now() - dragStartRef.current.time;
    if (dragStartRef.current.id === m.id && dx > 40 && dt < 800) {
      startReply(m);
    }
    const bubbleEl = dragBubbleRef.current;
    if (bubbleEl) {
      bubbleEl.style.transition = "transform 0.28s cubic-bezier(0.22,1,0.36,1)";
      bubbleEl.style.transform = "translateX(0px)";
      // Clear any inline transform left on OTHER bubbles so only the dragged
      // one animates and stale offsets never persist.
      const all = document.querySelectorAll("[data-bubble]");
      all.forEach((el) => { if (el !== bubbleEl) el.style.transform = "translateX(0px)"; });
    }
    dragStartRef.current = { id: null, y: 0, x: 0, time: 0, moved: false };
    dragBubbleRef.current = null;
  };

  const askAIAboutMessage = (msg) => {
    // Pre-fill input with quoted message + placeholder for user's question
    const quoted = `���� Quoted message:\n"${msg.text}"\n\n��� Your question:`;
    setInput(quoted);
    setActiveMessageId(null);
    // Focus the input
    setTimeout(() => { const el = document.querySelector('input[placeholder="Ask NexText AI…"]'); if (el) el.focus(); }, 50);
  };

  const handleImageAnalysis = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || analyzing) return;
    setAnalyzing(true);
    try {
      await ensureChatExists();
      // Upload the real image to storage so a true media bubble is stored,
      // then embed it exactly like a normal chat image message.
      const uploadResult = await uploadChatFile(chatId, myUid, file, { compress: true });
      const mediaExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: myUid, type: "image", text: null,
        mediaURL: uploadResult.url, mediaPath: uploadResult.path,
        mediaExpiresAt, mediaExpired: false, mediaSizeBytes: file.size,
      }));
      // Read the raw binary file as an absolute base64 string and pass it
      // directly into the Groq vision image_url payload.
      const analysis = await analyzeImageWithGroq(myUid, file, "Describe this image in detail. If it contains text, transcribe it. If it's a question or conversation, respond appropriately.");
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: analysis,
      }));
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: { text: "📷 AI analyzed an image", senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "text" },
      });
    } catch (err) {
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: describeAIError(err),
      }));
    }
    setAnalyzing(false);
  };

  const handleSummarizeActiveChat = async () => {
    if (summarizing) return;
    setSummarizing(true);
    setShowSettings(false);
    try {
      await ensureChatExists();
      const recentMsgs = messages.slice(-30);
      const transcript = recentMsgs.map((m) => `${m.senderId === myUid ? "Me" : "AI"}: ${m.text || "[media]"}`).join("\n");
      const summary = await sendAIContextMessageWithActiveChat(myUid, "Provide a concise summary of this conversation, highlighting key topics, decisions, and any action items.", transcript, recentMsgs);
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: `📝 **Chat Summary:**\n\n${cleanAIText(summary)}`,
      }));
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: { text: "📝 AI summarized this chat", senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "text" },
      });
    } catch (err) {
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: describeAIError(err),
      }));
    }
    setSummarizing(false);
  };

  const openChatPicker = async () => {
    setShowSettings(false);
    setShowChatPicker(true);
    setChatPickerMode("summarize");
    try {
      const chatsQuery = query(collection(db, "chats"), where("participants", "array-contains", myUid));
      const snap = await getDocs(chatsQuery);
      // Group chats are always eligible; 1-on-1 chats only when the admin has
      // enabled external summaries for them (default off — privacy default).
      const allow1on1 = !!sysConfig?.allow1on1ExternalSummaries;
      const chats = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => c.id !== chatId && (c.type === "group" || (allow1on1 && (c.participants || []).length === 2)));
      setAllChats(chats);
      // Resolve real display names for direct-chat partners so the picker
      // lists "Chat with Sarah" instead of a generic "Direct Chat" label.
      resolveParticipantNames(chats);
    } catch {
      setAllChats([]);
    }
  };

  // Fetches display names for every other participant across the given chats
  // and stores them in contactNames so both the picker and the summary prompt
  // can use real names instead of raw UIDs.
  const resolveParticipantNames = async (chats) => {
    const others = [];
    chats.forEach((c) => {
      (c.participants || []).forEach((p) => {
        if (p !== myUid && p !== AI_CONTACT_UID && !others.includes(p)) others.push(p);
      });
    });
    if (others.length === 0) return;
    const names = {};
    await Promise.all(others.map(async (uid) => {
      try {
        const s = await getDoc(doc(db, "users", uid));
        const d = s.exists() ? s.data() : {};
        names[uid] = d.displayName || d.username || uid.slice(0, 8);
      } catch { names[uid] = uid.slice(0, 8); }
    }));
    setContactNames((prev) => ({ ...prev, ...names }));
  };

  const nameFor = (uid) => {
    if (uid === myUid) return "Me";
    if (uid === AI_CONTACT_UID) return "AI";
    return contactNames[uid] || null;
  };

  const handleSummarizeExternalChat = async (targetChat) => {
    if (summarizingExternal) return;
    setSummarizingExternal(true);
    setShowChatPicker(false);
    try {
      await ensureChatExists();
      await resolveParticipantNames([targetChat]);
      const msgsQuery = query(collection(db, "chats", targetChat.id, "messages"), orderBy("sentAt", "desc"));
      const msgsSnap = await getDocs(msgsQuery);
      const recentMsgs = msgsSnap.docs.slice(0, 50).reverse().map((d) => ({ id: d.id, ...d.data() }));
      const transcript = recentMsgs.map((m) => {
        const role = nameFor(m.senderId) || m.senderName || m.senderId?.slice(0, 8) || "Unknown";
        return `${role}: ${m.text || "[media]"}`;
      }).join("\n");
      const otherUid = (targetChat.participants || []).find((p) => p !== myUid);
      const chatLabel = targetChat.groupName || nameFor(otherUid) || "Unknown Chat";
      const question = `Summarize this chat conversation. Highlight key topics, decisions, important messages, and any action items. Provide context about who said what using the participants' real names.`;
      const summary = await sendAIContextMessageWithActiveChat(myUid, question, `[Chat: ${chatLabel}]\n\n${transcript}`, recentMsgs);
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: `📋 **External Chat Summary — ${chatLabel}:**\n\n${cleanAIText(summary)}`,
      }));
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: { text: `📋 Summarized: ${chatLabel}`, senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "text" },
      });
    } catch (err) {
      await addDoc(collection(db, "chats", chatId, "messages"), buildMsg({
        senderId: AI_CONTACT_UID, type: "text", text: describeAIError(err),
      }));
    }
    setSummarizingExternal(false);
  };

  const [geminiModel, setGeminiModelLocal] = useState(userDoc?.geminiModel || sysConfig?.geminiModel || DEFAULT_GEMINI_MODEL);
  const [showModelTray, setShowModelTray] = useState(false);
  useEffect(() => {
    if (userDoc?.geminiModel) setGeminiModelLocal(userDoc.geminiModel);
  }, [userDoc?.geminiModel]);
  const isGemini = sysConfig?.aiProvider === "gemini";

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 20 }}>
      {/* Header with robot gradient badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", position: "relative", flexShrink: 0 }}>
        <ChevronLeft size={22} color="#fff" onClick={onBack} style={{ cursor: "pointer" }} />
        <div onClick={() => setShowProfile(true)} style={{ cursor: "pointer" }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", border: "2px solid rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 20 }}>🤖</span>
          </div>
        </div>
        <div onClick={() => setShowProfile(true)} style={{ flex: 1, cursor: "pointer" }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>NexText AI</div>
          <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>{getPersonaMeta(currentPersonality, sysConfig).icon} {getPersonaMeta(currentPersonality, sysConfig).label}</div>
        </div>
        <MoreVertical size={19} color="#fff" onClick={() => { setShowSettings(!showSettings); setShowPersonaTray(false); }} style={{ cursor: "pointer" }} />
        {showSettings && (
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 52, right: 10, background: t.surface, borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", overflowY: "auto", maxHeight: "75vh", zIndex: 40, minWidth: 200 }}>
            <div
              onClick={() => setShowPersonaTray(true)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}
            >
              <span style={{ fontSize: 16 }}>🤖</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>AI Assistant Persona</span>
              <span style={{ marginLeft: "auto", color: t.textMuted }}>›</span>
            </div>
            {podcastAvailable && (
              <div
                onClick={() => { setShowSettings(false); setPodcastResult(null); setPodcastStatus(""); setShowPodcast(true); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}
              >
                <span style={{ fontSize: 16 }}>🎙️</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Start AI Podcast</span>
                <span style={{ marginLeft: "auto", color: t.textMuted }}>›</span>
              </div>
            )}
            {voiceReplyAvailable && (
              <div
                onClick={toggleVoiceReplies}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}
              >
                <span style={{ fontSize: 16 }}>{voiceEnabled ? "🔊" : "🔇"}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Enable Voice Replies</span>
                <span style={{ marginLeft: "auto", width: 40, height: 22, borderRadius: 11, background: voiceEnabled ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: voiceEnabled ? 20 : 2, transition: "left 0.15s" }} />
                </span>
              </div>
            )}
            {voiceReplyAvailable && voiceEnabled && (
              <div
                onClick={() => setAutoVoiceReplies((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}
              >
                <span style={{ fontSize: 16 }}>🔁</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Auto-play voice replies</span>
                <span style={{ marginLeft: "auto", width: 40, height: 22, borderRadius: 11, background: autoVoiceReplies ? t.primary : t.border, position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: autoVoiceReplies ? 20 : 2, transition: "left 0.15s" }} />
                </span>
              </div>
            )}
            {voiceMasterOn && voiceEnabled && (
              <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 6 }}>Voice</div>
                <select
                  value={voiceMode}
                  onChange={(e) => setVoiceMode(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, outline: "none", color: t.text, background: t.bg }}
                >
                  {getAvailableVoices(sysConfig).map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            )}
            {isGemini && sysConfig?.allowUserGeminiModel && (
              <div
                onClick={() => { setShowSettings(false); setShowModelTray(true); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}
              >
                <span style={{ fontSize: 16 }}>🧩</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Gemini Model</span>
                <span style={{ marginLeft: "auto", color: t.primary, fontSize: 12.5, fontWeight: 600 }}>
                  {GEMINI_MODELS.find((m) => m.id === geminiModel)?.label || geminiModel} ›
                </span>
              </div>
            )}
            <div
              onClick={() => { setShowSettings(false); setShowIconTray(true); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}
            >
              <Avatar uid={AI_CONTACT_UID} size={22} aiStyleOverride={aiIcon} />
              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>AI Icon Style</span>
              <span style={{ marginLeft: "auto", color: t.textMuted }}>›</span>
            </div>
            <div onClick={async () => { await ensureChatExists(); await toggleArchive(chatId, myUid, isArchived); setShowSettings(false); onBack(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Archive size={16} color={t.text} />
              <span style={{ fontSize: 14, color: t.text }}>{isArchived ? "Unarchive chat" : "Archive chat"}</span>
            </div>
            <div onClick={handleSummarizeActiveChat} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <span style={{ fontSize: 14, color: t.primary }}>📝 Summarize this chat</span>
            </div>
            <div onClick={openChatPicker} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Users size={15} color={t.primary} />
              <span style={{ fontSize: 14, color: t.primary }}>Summarize External Chat history</span>
            </div>
            <div onClick={() => { setShowSettings(false); setShowClearConfirm(true); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Trash2 size={16} color="#FF3B30" />
              <span style={{ fontSize: 14, color: "#FF3B30" }}>Clear chat</span>
            </div>
            <div onClick={() => { setShowSettings(false); if (window.confirm("Delete this NexText AI chat permanently? This cannot be undone.")) { const legacy = [myUid, AI_CONTACT_UID].sort().join("_"); Promise.all([deleteChatCompletely(chatId).catch(() => {}), deleteChatCompletely(legacy).catch(() => {})]); onBack(); } }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Trash2 size={16} color="#FF3B30" />
              <span style={{ fontSize: 14, fontWeight: 700, color: "#FF3B30" }}>Delete chat</span>
            </div>
          </div>
        )}
      </div>

      {showPersonaTray && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", top: 52, right: 10, background: t.surface, borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", overflow: "hidden", zIndex: 50, minWidth: 220 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${t.border}`, cursor: "pointer" }} onClick={() => setShowPersonaTray(false)}>
            <span style={{ fontSize: 16, color: t.textMuted }}>‹</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>AI Assistant Persona</span>
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {getVisiblePersonaTray(sysConfig).map(([key, label]) => (
              <div
                key={key}
                onClick={() => {
                  setAIPersonality(myUid, key);
                  setShowPersonaTray(false);
                  setShowSettings(false);
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", cursor: "pointer", background: currentPersonality === key ? t.primaryLight : "transparent" }}
              >
                <span style={{ fontWeight: 600, fontSize: 13.5, color: currentPersonality === key ? t.primary : t.text }}>{label}</span>
                {currentPersonality === key && <span style={{ marginLeft: "auto", color: t.primary, fontWeight: 700 }}>✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showModelTray && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", top: 52, right: 10, background: t.surface, borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", overflow: "hidden", zIndex: 50, minWidth: 240 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${t.border}`, cursor: "pointer" }} onClick={() => setShowModelTray(false)}>
            <span style={{ fontSize: 16, color: t.textMuted }}>‹</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Gemini Model</span>
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {GEMINI_MODELS.map((m) => (
              <div
                key={m.id}
                onClick={() => {
                  setGeminiModel(myUid, m.id);
                  setGeminiModelLocal(m.id);
                  setShowModelTray(false);
                  setShowSettings(false);
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", cursor: "pointer", background: geminiModel === m.id ? t.primaryLight : "transparent" }}
              >
                <span style={{ fontWeight: 600, fontSize: 13.5, color: geminiModel === m.id ? t.primary : t.text }}>{m.label}</span>
                {geminiModel === m.id && <span style={{ marginLeft: "auto", color: t.primary, fontWeight: 700 }}>✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showIconTray && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", top: 52, right: 10, background: t.surface, borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", overflow: "hidden", zIndex: 50, minWidth: 240 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${t.border}`, cursor: "pointer" }} onClick={() => setShowIconTray(false)}>
            <span style={{ fontSize: 16, color: t.textMuted }}>‹</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>AI Icon Style</span>
          </div>
          <div style={{ padding: "10px 14px", maxHeight: 320, overflowY: "auto" }}>
            {[
              { id: "default", label: "Default" },
              { id: "ai-letters", label: "AI Letters" },
              { id: "neon", label: "Neon Glow" },
              { id: "gradient", label: "Gradient" },
              { id: "mono", label: "Mono Block" },
            ].map((opt) => {
              const active = (aiIcon || "default") === opt.id;
              return (
                <div
                  key={opt.id}
                  onClick={() => { setUserAIIconStyle(opt.id); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", cursor: "pointer", background: active ? t.primaryLight : "transparent", borderRadius: 10, marginBottom: 4 }}
                >
                  <Avatar uid={AI_CONTACT_UID} size={40} aiStyleOverride={opt.id} />
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: active ? t.primary : t.text }}>{opt.label}</span>
                  {active && <span style={{ marginLeft: "auto", color: t.primary, fontWeight: 700 }}>✓</span>}
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6, lineHeight: 1.5 }}>
              Your choice overrides the admin default just for you.
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} onTouchStart={onMessagesTouchStart} onTouchMove={onMessagesTouchMove} onTouchEnd={onMessagesTouchEnd} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "14px 10px", touchAction: pinchEnabled() ? "pan-y" : "auto" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: t.textMuted, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🤖</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: t.text }}>NexText AI</div>
            <div>{getPersonaMeta(currentPersonality, sysConfig).icon} Mode: {getPersonaMeta(currentPersonality, sysConfig).label}</div>
            <div style={{ marginTop: 8 }}>Ask me anything!</div>
          </div>
        )}
        {messages.map((m, i) => {
          const isMine = m.senderId === myUid;
          const mDate = m.sentAt?.toDate ? m.sentAt.toDate() : null;
          const prevDate = i > 0 && messages[i - 1].sentAt?.toDate ? messages[i - 1].sentAt.toDate() : null;
          const newDay = mDate && (!prevDate || prevDate.toDateString() !== mDate.toDateString());

          return (
            <React.Fragment key={m.id}>
              {newDay && (
                <div style={{ display: "flex", justifyContent: "center", margin: "14px 0 6px" }}>
                  <div style={{ background: t.surface, color: t.textMuted, fontSize: 11.5, fontWeight: 600, padding: "4px 12px", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.06)", border: `1px solid ${t.border}` }}>
                    {formatAIDateDivider(mDate)}
                  </div>
                </div>
              )}
              {m.type === "image" ? (
                (() => {
                  const expired = m.mediaExpiresAt && m.mediaExpiresAt < Date.now();
                  return (
                    <div style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", marginTop: 8 }}>
                      <div style={{ position: "relative", maxWidth: "78%" }}>
                        {!expired && m.mediaURL ? (
                          <div style={{ background: "#000", borderRadius: 8 }}>
                            <img
                              src={m.mediaURL}
                              alt="AI image"
                              style={{ maxWidth: 220, maxHeight: 280, borderRadius: 8, display: "block", cursor: "pointer" }}
                              onClick={() => setFullscreenImage(m.mediaURL)}
                            />
                          </div>
                         ) : (
                           <div style={{ padding: "18px 22px", borderRadius: 10, background: t.bubbleThem, color: t.bubbleThemText, fontSize: 13, opacity: 0.8 }}>📷 Media expired</div>
                         )}
                         {!expired && m.mediaURL && (
                           <div
                              onClick={() => downloadImage(m.mediaURL, `nextext-ai-image-${Date.now()}.png`)}
                             title="Download image"
                             style={{ position: "absolute", top: 4, left: 4, width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 2 }}
                           >
                             <Download size={14} color="#fff" />
                           </div>
                         )}
                         <div
                           onClick={() => deleteAIMediaMessage(m.id, m.mediaPath)}
                           title="Delete image"
                           style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 2 }}
                         >
                           <Trash2 size={14} color="#fff" />
                         </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", marginTop: 8 }}>
                  <div style={{ position: "relative", maxWidth: "78%" }}>
                    <div
                      data-bubble
                      onTouchStart={(e) => onAIMsgTouchStart(m, e)}
                      onTouchMove={(e) => onAIMsgTouchMove(m, e)}
                      onTouchEnd={(e) => onAIMsgTouchEnd(m, e)}
                      onTouchCancel={(e) => onAIMsgTouchEnd(m, e)}
                      style={{ padding: "10px 14px", borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: isMine ? t.bubbleMe : t.bubbleThem, color: isMine ? t.bubbleMeText : t.bubbleThemText, fontSize: 14 * aiTextScale, lineHeight: 1.4, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", wordBreak: "break-word", overflowWrap: "break-word", minWidth: 0, transform: "translate3d(0,0,0)", willChange: "transform" }}
                    >
                      {m.replyTo && (
                        <div style={{ borderLeft: `3px solid ${isMine ? "rgba(255,255,255,0.55)" : t.primary}`, paddingLeft: 8, marginBottom: 6, opacity: 0.9 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: isMine ? "rgba(255,255,255,0.9)" : t.primary }}>{m.replyTo.senderName || (m.replyTo.senderId === myUid ? "Me" : "AI")}</div>
                          <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{m.replyTo.previewText}</div>
                        </div>
                      )}
                      {renderAIBold(m.text, (url) => setFullscreenImage(url))}
                      {voiceAudios[m.id] && (
                        <AutoAudio src={voiceAudios[m.id]} canDownload={canDownloadVoice} />
                      )}
                      {voiceReplyAvailable && voiceEnabled && !voiceAudios[m.id] && !autoVoiceReplies && (
                        generatingVoiceId === m.id ? (
                          <div style={{ marginTop: 8, padding: "6px 12px", borderRadius: 10, background: t.primaryLight, width: 170 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: t.primary, marginBottom: 5 }}>Generating…</div>
                            <div style={{ height: 5, borderRadius: 3, background: t.border, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: "40%", borderRadius: 3, background: t.primary, animation: "nextext-slide 1.1s ease-in-out infinite" }} />
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => generateOneVoice(m)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 12px", borderRadius: 10, background: t.primary, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                          >
                            🔊 Generate audio response
                          </div>
                        )
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                        <span style={{ fontSize: 10.5, opacity: 0.55 }}>
                          {m.sentAt?.toDate ? m.sentAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                        </span>
                        <div
                          onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setActiveMsgRect({ top: rect.top, left: rect.left, width: rect.width }); setActiveMessageId(activeMessageId === m.id ? null : m.id); }}
                          style={{ width: 28, height: 28, borderRadius: "50%", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: t.textMuted, flexShrink: 0 }}
                          title="More options"
                        >
                          <MoreVertical size={14} />
                        </div>
                      </div>
                    </div>
                    {activeMessageId === m.id && activeMsgRect && (
                      <div
                        ref={messageMenuRef}
                        style={{
                          position: "fixed",
                          top: activeMsgRect.top > 230 ? activeMsgRect.top - 220 : activeMsgRect.bottom + 8,
                          left: activeMsgRect.left + activeMsgRect.width - 168,
                          background: t.surface,
                          borderRadius: 10,
                          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                          border: `1px solid ${t.border}`,
                          overflow: "hidden",
                          zIndex: 2000,
                          minWidth: 168,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px 6px 14px", borderBottom: `1px solid ${t.border}` }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, letterSpacing: 0.4 }}>MESSAGE</span>
                          <div onClick={() => setActiveMessageId(null)} style={{ cursor: "pointer", padding: 4, display: "flex" }} aria-label="Close menu">
                            <X size={15} color={t.textMuted} />
                          </div>
                        </div>
                        <div onClick={() => copyMessageText(m.text)} onTouchEnd={(e) => { e.preventDefault(); copyMessageText(m.text); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", cursor: "pointer", fontSize: 13.5, color: t.text }}>
                          <Copy size={14} /> Copy
                        </div>
                        <div style={{ height: 1, background: t.border }} />
                        <div onClick={() => forwardMessage(m)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", cursor: "pointer", fontSize: 13.5, color: t.text }}>
                          <Forward size={14} /> Forward
                        </div>
                        <div style={{ height: 1, background: t.border }} />
                        <div onClick={() => askAIAboutMessage(m)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", cursor: "pointer", fontSize: 13.5, color: t.primary, fontWeight: 600 }}>
                          <MessageSquare size={14} /> Ask AI
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
        {(sending || summarizingExternal) && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 8 }}>
            <div style={{ padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: t.bubbleThem, color: t.bubbleThemText, fontSize: 14 }}>
              {summarizingExternal ? "Summarizing external chat…" : "Thinking…"}
            </div>
          </div>
        )}
      </div>

      {thinking && (
        <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 8 }}>
          <div style={{ position: "relative", maxWidth: "78%" }}>
            <div style={{ padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: t.bubbleThem, color: t.bubbleThemText, fontSize: 14 * aiTextScale, lineHeight: 1.4, boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }}>
              <ThinkingDots color={t.bubbleThemText} />
            </div>
          </div>
        </div>
      )}
      {showEmojiPicker && (
        <div style={{ padding: "8px 12px", borderTop: `1px solid ${t.border}`, background: t.surface, maxHeight: 180, overflowY: "auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {EMOJI_PICKER_SET.map((emoji) => (
              <span key={emoji} onClick={() => { setInput((prev) => prev + emoji); setShowEmojiPicker(false); }} style={{ fontSize: 22, cursor: "pointer", padding: "4px 5px", borderRadius: 6 }}>{emoji}</span>
            ))}
          </div>
        </div>
      )}
      {replyTo && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid ${t.border}`, background: t.primaryLight }}>
          <div style={{ flex: 1, minWidth: 0, borderLeft: `3px solid ${t.primary}`, paddingLeft: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: t.primary }}>Replying to {replyTo.senderName}</div>
            <div style={{ fontSize: 12.5, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{replyTo.previewText}</div>
          </div>
          <X size={18} color={t.textMuted} onClick={() => setReplyTo(null)} style={{ cursor: "pointer", flexShrink: 0 }} />
        </div>
      )}
      {voiceMasterOn && voiceEnabled && voiceBusy && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: "7px 12px", background: t.primaryLight, borderTop: `1px solid ${t.border}` }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${t.primary}`, borderTopColor: "transparent", animation: "nextext-spin 0.7s linear infinite" }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: t.primary }}>🔊 Generating voice reply…</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: `1px solid ${t.border}`, background: t.surface }}>
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageAnalysis} />
        {!visionDisabled && (
          <div onClick={() => imageInputRef.current?.click()} style={{ width: 30, height: 30, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            <ImageIcon size={15} color={t.primary} />
          </div>
        )}
        {sysConfig?.enableAiImageGenButton && (
          <div onClick={() => { setGenError(""); setShowImagePrompt(true); }} style={{ width: 30, height: 30, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} title="Generate image">
            <Plus size={15} color={t.primary} />
          </div>
        )}
        <div onClick={() => setShowEmojiPicker(!showEmojiPicker)} style={{ width: 30, height: 30, borderRadius: "50%", background: showEmojiPicker ? t.primaryLight : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <Smile size={15} color={showEmojiPicker ? t.primary : t.textMuted} />
        </div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask NexText AI…"
          disabled={sending}
          style={{ flex: 1, minWidth: 0, padding: "10px 14px", borderRadius: 20, border: `1px solid ${t.border}`, fontSize: 14, background: t.bg, color: t.text, outline: "none" }}
        />
        {composerButtonOrder === "voice-stt" ? (
          <>
            {sttEnabled && !globalSettings?.hideStt && (
              <div style={{ display: "flex", alignItems: "center", marginLeft: voiceSpacing ? 10 : 0 }}>
                <span style={{ display: "flex", flexShrink: 0 }}><VoiceToTextButton myUid={myUid} onResult={handleSttResult} onAutoSend={(text) => { if (text && text.trim()) handleSend(text.trim()); }} autoSend={sttAutoSend} size={34} useRealtime /></span>
              </div>
            )}
            <div onClick={handleSend} style={{ width: 38, height: 38, flexShrink: 0, marginLeft: 2, borderRadius: "50%", background: input.trim() && !sending ? t.primary : t.border, display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !sending ? "pointer" : "default" }}>
              <Send size={17} color={input.trim() && !sending ? "#fff" : t.textMuted} />
            </div>
          </>
        ) : (
          <>
            <div onClick={handleSend} style={{ width: 38, height: 38, flexShrink: 0, marginLeft: 2, borderRadius: "50%", background: input.trim() && !sending ? t.primary : t.border, display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !sending ? "pointer" : "default" }}>
              <Send size={17} color={input.trim() && !sending ? "#fff" : t.textMuted} />
            </div>
            {sttEnabled && !globalSettings?.hideStt && (
              <span style={{ display: "flex", flexShrink: 0 }}><VoiceToTextButton myUid={myUid} onResult={handleSttResult} onAutoSend={(text) => { if (text && text.trim()) handleSend(text.trim()); }} autoSend={sttAutoSend} size={34} useRealtime /></span>
            )}
          </>
        )}
      </div>

      {/* Image generation prompt */}
      {showImagePrompt && (
        <div className="nextext-overlay-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { if (!sending) setShowImagePrompt(false); }}>
          <div className="nextext-overlay-sheet" style={{ background: t.surface, width: "100%", maxWidth: 340, borderRadius: 16, padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Generate image</span>
              <X size={20} color={t.textMuted} onClick={() => setShowImagePrompt(false)} style={{ cursor: "pointer" }} />
            </div>
            <textarea
              autoFocus
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="Describe the image you want…"
              rows={3}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, background: t.bg, color: t.text, fontFamily: "inherit", boxSizing: "border-box", resize: "none" }}
            />
            {genError && <div style={{ color: "#FF3B30", fontSize: 12.5, marginTop: 8 }}>{genError}</div>}
            <button
              onClick={() => handleGenerateImage()}
              disabled={!imagePrompt.trim() || sending}
              style={{ marginTop: 12, width: "100%", padding: "11px", borderRadius: 10, border: "none", background: imagePrompt.trim() && !sending ? t.primary : t.border, color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: imagePrompt.trim() && !sending ? "pointer" : "default" }}
            >{sending ? "Generating…" : "Generate"}</button>
          </div>
        </div>
      )}

      {/* External chat picker overlay */}
      {showChatPicker && (
        <div style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 50, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px", background: t.surface, borderBottom: `1px solid ${t.border}` }}>
            <X size={22} color={t.text} onClick={() => { setShowChatPicker(false); setAllChats([]); setChatPickerMode(null); }} style={{ cursor: "pointer" }} />
            <span style={{ color: t.text, fontWeight: 700, fontSize: 16 }}>
              {chatPickerMode === "forward" ? "Select Chat to Forward To" : "Select Chat to Summarize"}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {allChats.length === 0 && (
              <div style={{ padding: 30, textAlign: "center", color: t.textMuted, fontSize: 13.5 }}>
                {chatPickerMode === "forward" ? "No chats available to forward to." : "No chats available to summarize."}
              </div>
            )}
            {allChats.map((c) => {
              const otherUid = (c.participants || []).find((p) => p !== myUid);
              const onClick = chatPickerMode === "forward"
                ? () => handleForwardConfirm(c.id)
                : () => handleSummarizeExternalChat(c);
              return (
                <div key={c.id} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Users size={20} color={t.primary} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.groupName || (nameFor(otherUid) ? `Chat with ${nameFor(otherUid)}` : "Direct Chat")}
                    </div>
                    <div style={{ fontSize: 12.5, color: t.textMuted }}>{(c.participants || []).length} members · {c.type === "group" ? "Group" : "Direct"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Profile modal */}
      {showProfile && (
        <div onClick={() => setShowProfile(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: 18, width: "100%", maxWidth: 320, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 20px" }}>
              <div style={{ background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 20 }}>🤖</span>
              </div>
              <div onClick={() => setShowProfile(false)} style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <X size={20} color="#fff" strokeWidth={2.5} />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ color: t.text, fontWeight: 800, fontSize: 20 }}>NexText AI</div>
                <div style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>Powered by Groq + Llama 4 Scout</div>
              </div>
              <div style={{ fontSize: 14, color: t.text, lineHeight: 1.6, marginBottom: 16 }}>
                Your intelligent chat companion. Ask questions, have fun conversations, or switch personalities for a different experience.
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted, marginBottom: 8, textTransform: "uppercase" }}>Capabilities</div>
              {["General Q&A and research assistance", "8 unique personalities", "Image analysis with Llama 4 Scout", "Chat summarization (active + external)", "OpenAI GPT-OSS + Llama 4 Scout via Groq"].map((cap) => (
                <div key={cap} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13, color: t.text }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.primary, flexShrink: 0 }} />
                  {cap}
                </div>
              ))}
              <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, fontSize: 12.5, color: t.primary, lineHeight: 1.5 }}>
                Tip: Tap 📷 to send an image for AI analysis. Use the ⋮ menu to change personality, summarize any chat, or clear history.
              </div>
            </div>
            <div style={{ padding: "14px", textAlign: "center", borderTop: `1px solid ${t.border}`, cursor: "pointer", fontWeight: 700, fontSize: 15, color: t.primary }} onClick={() => setShowProfile(false)}>
              Close
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen image viewer with zoom + download + close */}
      {fullscreenImage && (
        <div
          onClick={() => { setFullscreenImage(null); setFsScale(1); }}
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflow: "hidden" }}
        >
          <X size={26} color="#fff" onClick={() => { setFullscreenImage(null); setFsScale(1); }} style={{ position: "absolute", top: 18, right: 18, cursor: "pointer", zIndex: 2 }} />
          <div
            onClick={(e) => e.stopPropagation()}
            title="Download image"
            style={{ position: "absolute", top: 16, right: 56, width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 2 }}
            onClickCapture={async () => { await downloadImage(fullscreenImage, `nextext-image-${Date.now()}.png`); }}
          >
            <Download size={18} color="#fff" />
          </div>
          <img
            src={fullscreenImage}
            alt="Fullscreen"
            crossOrigin="anonymous"
            onDoubleClick={() => setFsScale((s) => (s > 1 ? 1 : 2.5))}
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                fsPinchRef.current = { dist: Math.hypot(dx, dy), scale: fsScale };
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && fsPinchRef.current) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                const next = Math.min(5, Math.max(1, fsPinchRef.current.scale * (dist / fsPinchRef.current.dist)));
                setFsScale(next);
              }
            }}
            onTouchEnd={() => { fsPinchRef.current = null; }}
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain", transform: `scale(${fsScale})`, transition: fsScale > 1 ? "none" : "transform 0.15s", cursor: "zoom-in" }}
          />
          <div style={{ position: "absolute", bottom: 24, left: 0, right: 0, textAlign: "center", fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>Double-tap or pinch to zoom · tap outside to close</div>
        </div>
      )}

      {/* In-app confirm for clearing the AI chat (window.confirm is disabled
          inside the Capacitor WebView, so we use our own dialog). */}
      {showClearConfirm && (
        <div onClick={() => setShowClearConfirm(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 300, background: t.surface, borderRadius: 16, padding: 18, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: t.text, marginBottom: 8 }}>Clear AI chat?</div>
            <div style={{ fontSize: 13.5, color: t.textMuted, lineHeight: 1.5, marginBottom: 16 }}>This permanently deletes all messages in this AI conversation. This cannot be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowClearConfirm(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Cancel</button>
              <button onClick={clearChat} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: "#FF3B30", color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Clear</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Podcast / multi-voice conversation builder */}
      {showPodcast && (
        <div onClick={() => { if (!podcastBusy) setShowPodcast(false); }} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: 18, width: "100%", maxWidth: 340, maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${t.border}` }}>
              <div style={{ fontWeight: 800, fontSize: 17, color: t.text }}>🎙️ AI Podcast</div>
              <X size={20} color={t.text} onClick={() => { if (!podcastBusy) setShowPodcast(false); }} style={{ cursor: "pointer" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>Select up to 4 voices</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {availableVoices.map((v) => {
                  const sel = podcastVoices.includes(v.id);
                  return (
                    <div key={v.id} onClick={() => togglePodcastVoice(v.id)} style={{ padding: "8px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer", border: `1px solid ${sel ? t.primary : t.border}`, background: sel ? t.primary : t.bg, color: sel ? "#fff" : t.text }}>
                      {v.name}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>Mode</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <div onClick={() => setPodcastMode("auto")} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1px solid ${podcastMode === "auto" ? t.primary : t.border}`, background: podcastMode === "auto" ? t.primary : t.bg, color: podcastMode === "auto" ? "#fff" : t.text }}>AI invents topic</div>
                <div onClick={() => setPodcastMode("directed")} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1px solid ${podcastMode === "directed" ? t.primary : t.border}`, background: podcastMode === "directed" ? t.primary : t.bg, color: podcastMode === "directed" ? "#fff" : t.text }}>I direct it</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>Length</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {PODCAST_LENGTH_OPTIONS.map(({ val, label, est }) => (
                  <div key={val} onClick={() => setPodcastLength(val)} style={{ flex: "1 0 28%", textAlign: "center", padding: "10px 0", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${podcastLength === val ? t.primary : t.border}`, background: podcastLength === val ? t.primary : t.bg, color: podcastLength === val ? "#fff" : t.text }}>
                    {label}
                    <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>{est}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>Heatedness</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {PODCAST_HEAT_OPTIONS.map(({ val, label }) => (
                  <div key={val} onClick={() => setPodcastHeat(val)} style={{ flex: "1 0 40%", textAlign: "center", padding: "9px 0", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${podcastHeat === val ? t.primary : t.border}`, background: podcastHeat === val ? t.primary : t.bg, color: podcastHeat === val ? "#fff" : t.text }}>
                    {label}
                  </div>
                ))}
              </div>
              {podcastMode === "directed" && (
                <>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, marginBottom: 6 }}>General conversation direction</div>
                  <textarea
                    value={podcastTopic}
                    onChange={(e) => setPodcastTopic(e.target.value)}
                    placeholder="Describe the overall topic and flow (e.g. 'A lively debate about the best pizza topping')."
                    rows={3}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 13, resize: "none", outline: "none", color: t.text, background: t.bg, marginBottom: 12 }}
                  />
                  {podcastVoices.map((id) => {
                    const v = availableVoices.find((x) => x.id === id);
                    return (
                      <div key={id} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.primary, marginBottom: 4 }}>{v?.name || id}'s opinion & style</div>
                        <textarea
                          value={podcastSpeakerNotes[id] || ""}
                          onChange={(e) => setPodcastSpeakerNotes((n) => ({ ...n, [id]: e.target.value }))}
                          placeholder={`How should ${v?.name || "this speaker"} speak and what's their stance?`}
                          rows={2}
                          style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 12.5, resize: "none", outline: "none", color: t.text, background: t.bg }}
                        />
                      </div>
                    );
                  })}
                </>
              )}
              {podcastStatus && (
                <div style={{ fontSize: 12.5, color: t.primary, fontWeight: 600, marginBottom: 8 }}>{podcastStatus}</div>
              )}
              {podcastResult && (
                <div style={{ background: t.bg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>🎙️ AI Podcast ({podcastResult.turns} turns)</div>
                  <audio controls src={podcastResult.url} style={{ width: "100%", marginBottom: 8 }} />
                  <div
                    onClick={async () => { await downloadMedia(podcastResult.url, `nextext-ai-podcast-${Date.now()}.mp3`); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: t.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    ⬇️ Download recording
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: 14, borderTop: `1px solid ${t.border}` }}>
              <button
                onClick={generatePodcast}
                disabled={podcastBusy || podcastVoices.length < 1}
                style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: "none", background: (podcastBusy || podcastVoices.length < 1) ? t.border : t.primary, color: "#fff", fontWeight: 700, fontSize: 15, cursor: (podcastBusy || podcastVoices.length < 1) ? "not-allowed" : "pointer" }}
              >
                {podcastBusy ? "Generating…" : "Generate Podcast"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
