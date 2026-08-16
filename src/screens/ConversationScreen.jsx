import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Send, Smile, Check, CheckCheck, CornerUpLeft, X, BarChart2, Plus, MoreVertical, Bell, BellOff, Star, ArrowDown, ArrowUp, Search, Image as ImageIcon, Paperclip, Mic, Play, Pause, FileText, Camera, Lock, Archive, Trash2, MessageSquare, UserPlus, Users, ImageOff, VideoOff, MicOff, FileX, RefreshCw, RotateCcw, MapPin, Square, Headphones, EyeOff, Forward, Languages } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import {
  useMessages, sendTextMessage, markChatRead, setTypingHeartbeat, reactToMessage,
  getOrCreateDirectChat, markMessagesDelivered, markMessagesRead, sendPollMessage,
  voteOnPoll, editMessage, deleteMessageForSelf, deleteMessageForEveryone,
  toggleFavorite, setMute, clearMute, sendMediaMessage, toggleLocked, toggleArchive, deleteChatCompletely,
  isMediaExpired, setVoiceRecordingHeartbeat, clearVoiceRecordingStatus,
  sendLocationMessage, updateLiveLocation, sendContactMessage,
  sendForwardedMessage, incrementForwardedCount,
} from "../firebase/chats";
import { getWallpaperForChat, setWallpaperForChat, fileToWallpaperDataUrl } from "../theme/wallpaper";
import { usePresence, formatLastSeen } from "../firebase/presence";
import { uploadChatFile } from "../supabase/media";
import { FileTooLargeError } from "../media/mediaCompression";
import { doc, getDoc, onSnapshot, addDoc, collection, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { registerPlugin } from "@capacitor/core";
import Avatar, { getLocalPhotoOverride } from "../components/Avatar";
import { extractFirstUrl, fetchLinkPreview, isLinkPreviewEnabled } from "../utils/linkPreview";
import { playVoicePing, playVoiceEndChime } from "../utils/pingSounds";
import { useGlobalSettings } from "../firebase/config-settings";
import { getSystemInsets } from "../utils/systemInsets";

const NextextNative = registerPlugin("NextextNative");
import { useStatuses } from "../firebase/status";
import { shouldTriggerGroupAI, sendGroupAIMessage, AI_CONTACT_UID, transcribeVoiceNote, useSystemConfigHook, translateMessage, LANGUAGES, getLanguageLabel } from "../firebase/ai";
import { useContacts, getContactDisplayName, getContactRealName } from "../firebase/contacts";
import ContactSharePicker from "../components/ContactSharePicker";
import ForwardPicker from "../components/ForwardPicker";


const VIEWED_KEY = "nextext_status_viewed";
function getStoredViewed() {
  try { const raw = localStorage.getItem(VIEWED_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "👍"];

function isEmojiOnly(text) {
  if (!text || !text.trim()) return false;
  const chunks = text.trim().split(/\s+/);
  if (chunks.length === 0 || chunks.length > 4) return false;
  const EMO = /^\p{Extended_Pictographic}$/u;
  for (const chunk of chunks) {
    const core = chunk.replace(/[\uFE0F\u200D]/g, "");
    if (!core) return false;
    for (const ch of core) {
      if (!EMO.test(ch) && !/^\p{Emoji_Modifier}$/u.test(ch)) return false;
    }
  }
  return true;
}

function emojiAnimClass(emoji) {
  if (/[😂🤣😹]/.test(emoji)) return "nextext-emoji-shake";
  if (/[🥲😢😭😿]/.test(emoji)) return "nextext-emoji-tears";
  if (/[❤💙💚💛🧡💜🖤🤍💗💖💘💝💟]/.test(emoji)) return "nextext-emoji-beat";
  return "nextext-emoji-float";
}

const EMOJI_PICKER_SET = [
  "😀", "😂", "🥹", "😍", "😘", "😎", "🤔", "😴",
  "😭", "😡", "🥳", "😇", "🤗", "🙄", "😬", "🤯",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "✌️",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔",
  "🔥", "✨", "🎉", "🎂", "🍕", "☕", "🌟", "💯",
  "😊", "😅", "🥰", "😜", "🤩", "🤤", "😢", "🤣",
];
const READ_DELAY_MS = 1500; // deliberate small gap so "delivered" is actually visible before "read"

// Animated live waveform for the recording composer bar. Bars scale with the
// mic level (0..1) supplied by the native amplitude poller or WebView analyser.
// Each bar has a fixed pseudo-random factor so the wave looks organic instead
// of a uniform block. When inactive (paused), bars drop to a low static level.
function LiveWave({ level = 0, active = true, color, height = 18, count = 20, max = 1 }) {
  const { t } = useTheme();
  const barColor = color || t.accent;
  const lvl = active ? Math.max(0, Math.min(max, level)) : 0.1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height, flexShrink: 0 }}>
      {Array.from({ length: count }).map((_, i) => {
        const factor = 0.35 + ((i * 37) % 10) / 18;
        const h = Math.max(3, Math.round(height * factor * (active ? (0.15 + lvl * 0.85) : 0.1)));
        return (
          <div key={i} style={{ width: 3, height: Math.min(height, h), borderRadius: 2, background: barColor, opacity: active ? 0.9 : 0.35, transition: "height 60ms linear" }} />
        );
      })}
    </div>
  );
}

// WhatsApp-style day divider label: "Today", "Yesterday", or "Friday, July 16".
function formatDayLabel(date) {
  const d = new Date(date);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

// A scheduled message was composed at sentAt but delivered at scheduledFor;
// the timestamp shown on the bubble (and day separators) should reflect the
// actual delivery time, matching what a real-time send would show.
function msgDisplayDate(m) {
  if (m?.isScheduled && m?.scheduledFor?.toDate) return m.scheduledFor.toDate();
  return m?.sentAt?.toDate ? m.sentAt.toDate() : null;
}

function getMediaExpiryText(sentAt, mediaExpiryDays) {
  if (mediaExpiryDays == null) return "Permanent Storage";
  if (!sentAt?.toDate) return "";
  const daysElapsed = (Date.now() - sentAt.toDate().getTime()) / (1000 * 60 * 60 * 24);
  const remaining = Math.ceil(mediaExpiryDays - daysElapsed);
  if (remaining <= 0) return "Expired";
  return `Deletes in ${remaining} day${remaining !== 1 ? "s" : ""}`;
}

function filterTextByParentalControls(text, customFilterLists) {
  if (!text || !customFilterLists || customFilterLists.length === 0) return { text, blocked: false };
  const allKeywords = customFilterLists.flatMap((list) => list.keywords || []);
  if (allKeywords.length === 0) return { text, blocked: false };
  for (const kw of allKeywords) {
    const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (regex.test(text)) return { text: "[Blocked by parental controls]", blocked: true };
  }
  return { text, blocked: false };
}

function StatusReplyBlock({ statusRef, mine, t }) {
  if (!statusRef) return null;
  const isExpired = statusRef.expiresAt?.toDate ? statusRef.expiresAt.toDate().getTime() < Date.now() : false;
  const hasMedia = !isExpired && statusRef.mediaURL;
  return (
    <div style={{ background: mine ? "rgba(255,255,255,0.15)" : t.primaryLight, borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.6)" : t.primary}`, borderRadius: 6, padding: "5px 8px", marginBottom: 6, fontSize: 12, overflow: "hidden" }}>
      {hasMedia && statusRef.mediaType === "image" && (
        <img src={statusRef.mediaURL} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", marginBottom: 4 }} />
      )}
      {hasMedia && statusRef.mediaType === "video" && (
        <div style={{ width: 48, height: 48, borderRadius: 6, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>🎥</span>
        </div>
      )}
      {isExpired ? (
        <div style={{ opacity: 0.6, fontStyle: "italic", fontSize: 11 }}>
          [Reacted to status on {statusRef.createdAt?.toDate ? statusRef.createdAt.toDate().toLocaleDateString() : "unknown date"}]
        </div>
      ) : (
        <>
          {statusRef.text && <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.8 }}>{statusRef.text}</div>}
          {!statusRef.text && hasMedia && <div style={{ opacity: 0.6, fontStyle: "italic" }}>📷 Status media</div>}
          {!statusRef.text && !hasMedia && <div style={{ opacity: 0.6, fontStyle: "italic" }}>Status</div>}
        </>
      )}
    </div>
  );
}

function LinkPreviewCard({ text, mine, t, textScale }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!text) return;
    const url = extractFirstUrl(text);
    if (!url) { setLoading(false); return; }
    fetchLinkPreview(url).then((p) => { setPreview(p); setLoading(false); });
  }, [text]);

  if (loading || !preview || !preview.url) return null;
  const cardBg = mine ? "rgba(255,255,255,0.08)" : t.surface;
  const borderColor = mine ? "rgba(255,255,255,0.12)" : t.border;
  return (
    <a href={preview.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "block", marginTop: 6, borderRadius: 10, border: `1px solid ${borderColor}`, background: cardBg, overflow: "hidden", textDecoration: "none", color: "inherit", maxWidth: 260 }}>
      {preview.image && !imageFailed && (
        <img src={preview.image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} style={{ width: "100%", height: 100, objectFit: "cover", display: "block", background: "rgba(0,0,0,0.06)" }} />
      )}
      <div style={{ padding: "7px 10px" }}>
        <div style={{ fontSize: 12 * textScale, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: mine ? t.bubbleMeText : t.text }}>{preview.title}</div>
        {preview.description && <div style={{ fontSize: 11 * textScale, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2, color: mine ? t.bubbleMeText : t.text }}>{preview.description}</div>}
        <div style={{ fontSize: 10 * textScale, opacity: 0.5, marginTop: 2, color: mine ? t.bubbleMeText : t.textMuted }}>{new URL(preview.url).hostname}</div>
      </div>
    </a>
  );
}

function StatusTicks({ mine, deliveredTo = [], readBy = [], otherParticipants = [] }) {
  if (!mine) return null;
  const allRead = otherParticipants.length > 0 && otherParticipants.every((uid) => readBy.includes(uid));
  const allDelivered = otherParticipants.length > 0 && otherParticipants.every((uid) => deliveredTo.includes(uid));
  if (allRead) return <CheckCheck size={15} style={{ color: "#4FC3E8" }} />;
  if (allDelivered) return <CheckCheck size={15} style={{ opacity: 0.7 }} />;
  return <Check size={15} style={{ opacity: 0.7 }} />;
}

function TypingDots({ color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 0" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: color || "rgba(255,255,255,0.85)",
          animation: `nextext-typing-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </div>
  );
}

function PollBubble({ t, mine, poll, myUid, onVote, textScale = 1 }) {
  const votesArr = Object.values(poll.votes || {});
  const total = votesArr.length;
  const myVote = poll.votes?.[myUid];
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <BarChart2 size={14} /><span style={{ fontWeight: 700, fontSize: 13.5 * textScale }}>{poll.question}</span>
      </div>
      {poll.options.map((opt) => {
        const count = votesArr.filter((v) => v === opt.id).length;
        const pct = total ? Math.round((count / total) * 100) : 0;
        const isMine = myVote === opt.id;
        return (
          <div key={opt.id} onClick={() => onVote(opt.id)} style={{ position: "relative", marginBottom: 6, cursor: "pointer", borderRadius: 8, overflow: "hidden", border: `1.5px solid ${isMine ? (mine ? "rgba(255,255,255,0.6)" : t.primary) : (mine ? "rgba(255,255,255,0.25)" : t.border)}` }}>
            <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: mine ? "rgba(255,255,255,0.18)" : t.primaryLight, transition: "width 0.3s" }} />
            <div style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: "7px 10px", fontSize: 12.5 }}>
              <span style={{ fontWeight: isMine ? 700 : 500 }}>{isMine && "✓ "}{opt.text}</span>
              <span style={{ opacity: 0.7 }}>{pct}%</span>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{total} vote{total !== 1 ? "s" : ""}</div>
    </div>
  );
}

function PollCreateSheet({ t, onClose, onCreate }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 55, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: t.surface, width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 22px", maxHeight: "80%", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Create a poll</span>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question" style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14.5, marginBottom: 10, boxSizing: "border-box" }} />
        {options.map((o, i) => (
          <input key={i} value={o} onChange={(e) => setOptions((opts) => opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }} />
        ))}
        <div onClick={() => setOptions((o) => [...o, ""])} style={{ color: t.primary, fontSize: 13.5, fontWeight: 600, cursor: "pointer", marginBottom: 16 }}>+ Add option</div>
        <button disabled={!valid} onClick={() => onCreate(question, options.filter((o) => o.trim()))} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", background: valid ? t.primary : t.border, color: valid ? t.bubbleMeText : t.textMuted, fontWeight: 700, fontSize: 15, cursor: valid ? "pointer" : "not-allowed" }}>
          Send poll
        </button>
      </div>
    </div>
  );
}

const PLACEHOLDER_WAVE = [0.3, 0.55, 0.4, 0.75, 0.5, 0.65, 0.35, 0.8, 0.45, 0.6, 0.4, 0.7, 0.55, 0.75, 0.38, 0.65, 0.5, 0.72, 0.42, 0.6, 0.35, 0.68, 0.48, 0.78, 0.55, 0.62, 0.4, 0.7, 0.52, 0.66, 0.38, 0.74, 0.46, 0.58, 0.42, 0.68, 0.5, 0.64, 0.36, 0.6];

function hashSeed(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function seededWave(seed) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // Same natural envelope as the placeholder but varied per note so two notes
  // never look identical.
  return PLACEHOLDER_WAVE.map((h) => Math.min(1, Math.max(0.08, h * (0.7 + rand() * 0.6))));
}

// Builds a static waveform from the real audio samples (RMS per bucket).
// Returns null if the browser can't decode the file — the caller falls back to
// a deterministic seeded wave. This does NOT touch the <audio> element's output
// path, so playback stays clean and unmodified.
async function computeWaveFromAudio(url, buckets = 40) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const audioBuffer = await ctx.decodeAudioData(buf);
    ctx.close().catch(() => {});
    const channel = audioBuffer.getChannelData(0);
    const perBucket = Math.max(1, Math.floor(channel.length / buckets));
    const out = [];
    for (let b = 0; b < buckets; b++) {
      let peak = 0;
      for (let i = b * perBucket; i < (b + 1) * perBucket && i < channel.length; i++) {
        const v = Math.abs(channel[i]);
        if (v > peak) peak = v;
      }
      out.push(Math.min(1, Math.max(0.08, peak * 4)));
    }
    return out;
  } catch {
    return null;
  }
}

function VoicePlayer({ url, duration, mine, t, msgId, onEnded, autoPlayToken, isAutoPlayTarget, nowPlayingId, onPlayStart }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [error, setError] = useState(false);
  // Static waveform heights (0..1), computed once from the audio (or seeded).
  // It does NOT morph while playing — only the progress sweep changes.
  const [wave, setWave] = useState(null);
  // "waveform" (raw bars) or "scrubber" (clean seek bar) — chosen in Settings.
  const [playerStyle] = useState(() => { try { return localStorage.getItem("nextext_voice_player_style") || "waveform"; } catch { return "waveform"; } });
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const dragging = useRef(false);

  // Compute the static wave once per note.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const real = await computeWaveFromAudio(url);
      if (cancelled) return;
      setWave(real || seededWave(hashSeed(String(url) + String(msgId || ""))));
    })();
    return () => { cancelled = true; };
  }, [url, msgId]);

  const toggle = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else { onPlayStart?.(msgId); audioRef.current.play().catch(() => setError(true)); }
  };

  // Auto-advance: when the parent flags this note as the next one to play and
  // bumps the token, start it automatically.
  useEffect(() => {
    if (!isAutoPlayTarget || !autoPlayToken || !audioRef.current) return;
    onPlayStart?.(msgId);
    if (audioRef.current.readyState >= 1) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => setError(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayToken]);

  // Exclusivity: only one voice note plays at a time. If another note starts,
  // pause this one.
  useEffect(() => {
    if (nowPlayingId && nowPlayingId !== msgId && playing && audioRef.current) {
      audioRef.current.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlayingId, msgId]);

  const seekTo = (fraction) => {
    if (!audioRef.current || !totalDuration) return;
    audioRef.current.currentTime = fraction * totalDuration;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleBarInteraction = (clientX, ref) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(fraction);
  };

  const onBarPointerDown = (ref) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    dragging.current = true;
    handleBarInteraction(e.clientX || e.touches?.[0]?.clientX, ref);
    const onMove = (ev) => { if (dragging.current) handleBarInteraction(ev.clientX || ev.touches?.[0]?.clientX, ref); };
    const onUp = () => { dragging.current = false; document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const formatTime = (secs) => {
    if (!isFinite(secs) || secs <= 0) return "0:00";
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  const progress = totalDuration > 0 ? Math.min(currentTime / totalDuration, 1) : 0;
  const heights = wave || PLACEHOLDER_WAVE;
  const idleColor = mine ? "rgba(255,255,255,0.45)" : (t.textMuted + "88");
  const playedColor = mine ? "rgba(255,255,255,0.9)" : t.primary;
  const waveBarCount = heights.length;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: 230, maxWidth: "64vw" }} onClick={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => { setPlaying(true); }}
        onPause={() => { setPlaying(false); }}
        onEnded={() => { setPlaying(false); onPlayStart?.(null); onEnded?.(msgId); }}
        onError={() => setError(true)}
        onLoadedMetadata={() => { if (audioRef.current) setTotalDuration(audioRef.current.duration || duration || 0); }}
        onTimeUpdate={() => { if (!dragging.current && audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
      />
      <div onClick={toggle} style={{ width: 30, height: 30, borderRadius: "50%", background: mine ? "rgba(255,255,255,0.25)" : t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
        {playing ? <Pause size={14} color={mine ? t.bubbleMeText : t.primary} /> : <Play size={14} color={mine ? t.bubbleMeText : t.primary} />}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        {playerStyle === "scrubber" ? (
          <div
            ref={barRef}
            onPointerDown={onBarPointerDown(barRef)}
            style={{ position: "relative", height: 26, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" }}
          >
            <div style={{ flex: 1, height: 3.5, borderRadius: 2, background: idleColor, position: "relative", overflow: "visible" }}>
              <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 2, background: playedColor }} />
            </div>
            <div style={{ position: "absolute", left: `calc(${progress * 100}% - 6px)`, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, borderRadius: "50%", background: playedColor, boxShadow: "0 0 4px rgba(0,0,0,0.35)", transition: "left 0.1s linear" }} />
          </div>
        ) : (
          <div
            ref={barRef}
            onPointerDown={onBarPointerDown(barRef)}
            style={{ display: "flex", alignItems: "center", gap: 1.5, height: 26, cursor: "pointer", touchAction: "none" }}
          >
            {heights.map((h, i) => (
              <div key={i} style={{
                flex: 1, height: `${Math.max(8, h * 100)}%`, minHeight: 4, borderRadius: 2,
                background: (i / waveBarCount) <= progress ? playedColor : idleColor,
                transition: "background 0.08s linear",
              }} />
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 9.5, opacity: 0.65 }}>
          <span>{error ? "⚠ play error" : formatTime(currentTime)}</span>
          <span>{error ? "" : formatTime(totalDuration || duration || 0)}</span>
        </div>
      </div>
    </div>
  );
}

function ScheduleSendSheet({ t, onClose, onSchedule }) {
  const [customValue, setCustomValue] = useState("");
  const presets = [
    { label: "In 1 hour", getDate: () => new Date(Date.now() + 60 * 60 * 1000) },
    { label: "Tomorrow morning (9 AM)", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Next week (same time)", getDate: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  ];
  return (
    <div className="nextext-overlay-backdrop" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 58, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div className="nextext-overlay-sheet" style={{ background: t.surface, width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 24px" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Schedule message</span>
          <X size={20} color={t.textMuted} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        {presets.map((p) => (
          <div key={p.label} onClick={() => onSchedule(p.getDate())} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 4px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
            <span style={{ color: t.text, fontSize: 15 }}>{p.label}</span>
          </div>
        ))}
        <div style={{ paddingTop: 12 }}>
          <input type="datetime-local" value={customValue} onChange={(e) => setCustomValue(e.target.value)} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, marginBottom: 10, boxSizing: "border-box" }} />
          <button disabled={!customValue} onClick={() => onSchedule(new Date(customValue))} style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: customValue ? t.primary : t.border, color: customValue ? t.bubbleMeText : t.textMuted, fontWeight: 700, cursor: customValue ? "pointer" : "not-allowed" }}>
            Schedule for this time
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConversationScreen({ myUid, chatId: initialChatId, otherUid, contact, onBack, onOpenProfile, onOpenGroupInfo, onOpenChat, openSettings = false, showScrollDownSetting = true, scrollDownSize = 22, scrollDownPos = "center", animatedScrollEntry = false, recordingBarScale = 1, userDoc, emojiAnimations = true, emojiBigOn = true }) {
  const { t, chatTextScale, setChatTextScale, composerHeight, messageWidth } = useTheme();
  const rs = recordingBarScale || 1;
  const globalSettings = useGlobalSettings();
  const sysConfig = useSystemConfigHook();
  const isGroup = !!contact?.isGroup;
  const [chatId, setChatId] = useState(initialChatId);
  const [input, setInput] = useState("");
  const [activeMsg, setActiveMsg] = useState(null);
  const [reactionFx, setReactionFx] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [translateMsg, setTranslateMsg] = useState(null);
  const [translatingLang, setTranslatingLang] = useState("");
  const [translations, setTranslations] = useState({});
  const [hiddenTranslations, setHiddenTranslations] = useState({});
  const [translationErrors, setTranslationErrors] = useState({});
  const [editingMsg, setEditingMsg] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [theyTyping, setTheyTyping] = useState(false);
  const [sendError, setSendError] = useState("");
  const [chatSetupError, setChatSetupError] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [attachRendered, setAttachRendered] = useState(false);
  const [attachClosing, setAttachClosing] = useState(false);
  const [galleryActive, setGalleryActive] = useState(false);
  const [showLocationSheet, setShowLocationSheet] = useState(false);
  const [showLiveDurations, setShowLiveDurations] = useState(false);
  const [liveCustomMinutes, setLiveCustomMinutes] = useState("");
  const [showContactShare, setShowContactShare] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState("");
  const [locPosition, setLocPosition] = useState(null);
  const liveLocRef = useRef(null);
  // Voice-note "burst" tracking for the end-of-burst chime: consecutive notes
  // the user listened to back-to-back. A run of 3+ triggers the chime once
  // when it ends.
  const voiceChainRef = useRef(0);
  const voiceChainLastIdxRef = useRef(-1);
  const openAttach = () => { setAttachClosing(false); setAttachRendered(true); setShowAttach(true); };
  const closeAttach = () => {
    if (!attachRendered) return;
    setGalleryActive(false);
    setAttachClosing(true);
    setTimeout(() => { setAttachRendered(false); setShowAttach(false); setAttachClosing(false); }, 150);
  };

  useEffect(() => {
    if (!reactionFx) return;
    const timer = setTimeout(() => setReactionFx(null), 1200);
    return () => clearTimeout(timer);
  }, [reactionFx]);

  useEffect(() => {
    // The gallery button stays highlighted (galleryActive) while the system
    // file picker is open. Android's WebView does NOT reliably fire the file
    // input's "cancel" event when the user backs out without choosing a file,
    // and it also doesn't fire window "focus" on return — but it DOES fire
    // visibilitychange (the page hides while the chooser activity is on top,
    // and becomes visible again when it closes). Reset on visible, plus a
    // fallback reset when the composer is interacted with again.
    const onVis = () => { if (document.visibilityState === "visible") setGalleryActive(false); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── Share location ─────────────────────────────────────────────
  const openLocationSheet = async () => {
    closeAttach();
    setLocError("");
    setLocPosition(null);
    setShowLiveDurations(false);
    setLiveCustomMinutes("");
    // Request location permission right when user taps the button.
    let nativeGranted = false;
    try {
      const perm = await NextextNative.requestLocationPermission();
      nativeGranted = perm?.granted === true;
      if (!nativeGranted) {
        setLocError("Location permission denied. Enable it in Settings → Permissions to share your location.");
        setShowLocationSheet(true);
        return;
      }
    } catch (e) {
      console.warn("Native location permission request failed:", e);
      // Native call failed, fall through to geolocation attempt
    }
    setShowLocationSheet(true);
    fetchCurrentPosition();
  };

  const fetchCurrentPosition = () => {
    setLocBusy(true);
    setLocError("");
    const hasGeo = "geolocation" in navigator;
    if (!hasGeo) {
      setLocError("Location is not supported on this device.");
      setLocBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy || null });
        setLocBusy(false);
      },
      (err) => {
        setLocError(err.code === 1
          ? "Location permission is off. Tap Settings in your device for NexText, allow Location, then try again."
          : "Couldn't get your location. Please try again.");
        setLocBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  const stopLiveLocation = () => {
    clearInterval(liveLocRef.current);
    liveLocRef.current = null;
  };

  const sendLocation = async (durationMin) => {
    if (!chatId) { setLocError("Chat isn't ready yet — please wait a moment and try again."); return; }
    if (!locPosition) { setLocError("Waiting for your location…"); return; }
    stopLiveLocation();
    setLocBusy(true);
    setLocError("");
    try {
      const liveUntil = durationMin ? Date.now() + durationMin * 60 * 1000 : null;
      const msgRef = await sendLocationMessage(chatId, myUid, locPosition, otherParticipants, {
        liveUntil,
        replyTo: replyingTo,
      });
      setReplyingTo(null);
      // For live shares, refresh the coordinates every 8s until the window
      // expires or the user stops sharing.
      if (durationMin && msgRef?.id) {
        let active = true;
        const tick = async () => {
          if (!active) return;
          if (Date.now() >= liveUntil) { stopLiveLocation(); return; }
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              if (!active) return;
              try {
                await updateLiveLocation(chatId, msgRef.id, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy || null });
              } catch {}
            },
            () => {},
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
          );
        };
        liveLocRef.current = setInterval(tick, 8000);
        tick();
      }
      setLocPosition(null);
      setShowLocationSheet(false);
      setLocBusy(false);
    } catch (e) {
      setLocError(e?.message || "Couldn't share location.");
      setLocBusy(false);
    }
  };

  // ── Share contact ───────────────────────────────────────────
  // From the composer + menu: pick which of your contacts to send as a card
  // into the current chat.
  const shareContactIntoChat = async (pickedContact) => {
    if (!chatId) return;
    try {
      await sendContactMessage(chatId, myUid, {
        uid: pickedContact.uid,
        contactName: getContactDisplayName(pickedContact),
        contactUsername: pickedContact.profile?.username || null,
        contactPhotoURL: pickedContact.profile?.photoURL || null,
      }, otherParticipants);
    } catch (e) {
      setSendError(e?.message || "Couldn't share that contact.");
    }
  };

  // Card action: open a direct chat with the shared contact (create it if
  // it doesn't exist yet).
  const openSharedContactChat = async (m) => {
    if (!m.contactUid || !onOpenChat) return;
    try {
      const newChatId = await getOrCreateDirectChat(myUid, m.contactUid);
      onOpenChat(newChatId, m.contactUid, { uid: m.contactUid, profile: { displayName: m.contactName || null, username: m.contactUsername || null, photoURL: m.contactPhotoURL || null } });
    } catch { /* chat setup failure */ }
  };

  // Card action: add the shared contact to my contacts as accepted.
  const saveSharedContact = async (m) => {
    if (!m.contactUid || m.contactUid === myUid) return;
    try {
      await setDoc(doc(db, "users", myUid, "contacts", m.contactUid), {
        addedAt: serverTimestamp(),
        nickname: null,
        status: "accepted",
        blocked: false,
        mutedUntil: null,
        favorite: false,
        customAppearance: { photoURL: null, color: null },
      }, { merge: true });
    } catch { /* rules may reject; silently ignore */ }
  };
  const [showPoll, setShowPoll] = useState(false);
  const [showOverflow, setShowOverflow] = useState(openSettings || false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [chatMeta, setChatMeta] = useState(null);
  const [memberNames, setMemberNames] = useState({});
  const [isBlockedByMe, setIsBlockedByMe] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [wallpaper, setWallpaperState] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showCustomEmoji, setShowCustomEmoji] = useState(false);
  const [customEmoji, setCustomEmoji] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // Media caption preview: instead of instantly sending a gallery photo/video,
  // show it full-width with a caption input + Send/Cancel so the user can add
  // a message (or back out) before it goes.
  const [pendingMedia, setPendingMedia] = useState(null); // { file, isImage, previewUrl }
  const [captionText, setCaptionText] = useState("");
  const [captionBusy, setCaptionBusy] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingHold, setRecordingHold] = useState(false);
  const [recordingTapMode, setRecordingTapMode] = useState(false);
  const [recordingSlideCancel, setRecordingSlideCancel] = useState(false);
  const [recLevel, setRecLevel] = useState(0);
  // Stopped-but-not-sent voice note (Stop button) — can be listened to and then
  // sent or discarded. `{ url, blob, duration, type, isNative }`.
  const [recordedPreview, setRecordedPreview] = useState(null);
  const recordedPreviewRef = useRef(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewAudioRef = useRef(null);
  useEffect(() => { recordedPreviewRef.current = recordedPreview; }, [recordedPreview]);
  useEffect(() => () => { try { if (recordedPreviewRef.current?.url) URL.revokeObjectURL(recordedPreviewRef.current.url); } catch {} }, []);
  const [theyRecordingVoice, setTheyRecordingVoice] = useState(false);
  const [voiceAutoPlayId, setVoiceAutoPlayId] = useState(null);
  const [voiceAutoPlayNonce, setVoiceAutoPlayNonce] = useState(0);
  const [nowPlayingId, setNowPlayingId] = useState(null);
  const [voiceTranscripts, setVoiceTranscripts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nextext_voice_transcripts") || "{}"); } catch { return {}; }
  });
  // Per-device, per-transcription "hide" preference (localStorage, not
  // Firestore — hiding is a personal display choice, not chat data).
  const [hiddenTranscripts, setHiddenTranscripts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nextext_hidden_transcripts") || "{}"); } catch { return {}; }
  });
  const [transcribingId, setTranscribingId] = useState(null);
  const [transcriptErrors, setTranscriptErrors] = useState({});
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [navInset, setNavInset] = useState(0);
  const [cameraFacing, setCameraFacing] = useState("environment");
  const [capturedPhotos, setCapturedPhotos] = useState([]);
  const [restrictions, setRestrictions] = useState(null);
  const [newMsgBadge, setNewMsgBadge] = useState(0);
  const [contactCardMember, setContactCardMember] = useState(null);
  const [myGroupNickname, setMyGroupNickname] = useState("");
  const [otherUserPhoto, setOtherUserPhoto] = useState(null);

  // Fallback: fetch the other user's profile photo directly from Firestore so
  // "View Profile Picture" always has the image even if the contact object is stale.
  useEffect(() => {
    if (isGroup || !otherUid || otherUid === myUid) { setOtherUserPhoto(null); return; }
    const unsub = onSnapshot(doc(db, "users", otherUid), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      setOtherUserPhoto(data?.photoURL || null);
    });
    return unsub;
  }, [otherUid, myUid, isGroup]);

  useEffect(() => {
    getSystemInsets().then((insets) => setNavInset(insets.bottom || 0)).catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem("nextext_voice_transcripts", JSON.stringify(voiceTranscripts)); } catch {}
  }, [voiceTranscripts]);

  useEffect(() => {
    try { localStorage.setItem("nextext_hidden_transcripts", JSON.stringify(hiddenTranscripts)); } catch {}
  }, [hiddenTranscripts]);

  const pinchEnabled = () => {
    // Defaults ON (matches the Settings toggle: anything except an explicit
    // "false" means enabled). The old `=== "true"` check made the toggle look
    // on by default while pinch stayed dead until it was toggled off and on.
    try { return localStorage.getItem("nextext_pinch_zoom") !== "false"; } catch { return true; }
  };

  const onMessagesTouchStart = (e) => {
    if (!pinchEnabled() || e.touches.length !== 2) { pinchStartRef.current = null; return; }
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    // Smooth zoom: lock in the live scale at gesture start so each move
    // updates smoothly relative to the *current* scale, not the start scale
    // (avoids the old "jumps back to start scale when fingers drift" feel).
    pinchStartRef.current = { dist: d, scale: chatTextScale };
  };

  const onMessagesTouchMove = (e) => {
    if (!pinchEnabled() || e.touches.length !== 2 || !pinchStartRef.current) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchStartRef.current.dist > 0) {
      const ratio = d / pinchStartRef.current.dist;
      // Track every move for an instant, lag-free zoom. The rounding to a
      // 0.005 step only caps how often React commits; the visual update is
      // continuous so the text grows/shrinks the moment the fingers move.
      const next = Math.min(1.6, Math.max(0.6, pinchStartRef.current.scale * ratio));
      setChatTextScale(Math.round(next * 200) / 200);
    }
  };

  const onMessagesTouchEnd = () => { pinchStartRef.current = null; };

  // Read this user's per-group nickname override (if any).
  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      setMyGroupNickname(data?.groupNicknames?.[chatId] || "");
    });
    return unsub;
  }, [myUid, chatId]);
  const isFirstLoadRef = useRef(true);
  const isScrolledUpRef = useRef(false);
  const photoInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordingNativeRef = useRef(false);
  const recordStartTsRef = useRef(null);
  const recordHoldStartRef = useRef(null);
  const recordHoldCancelRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingHoldRef = useRef(false);
  const recLevelTimerRef = useRef(null);
  const recLevelListenerRef = useRef(null);
  const recAudioCtxRef = useRef(null);
  const recAnalyserRef = useRef(null);
  const lastRecLevelRef = useRef(0);
  const voiceHeartbeatRef = useRef(null);
  const voiceSessionTokenRef = useRef(0);
  const wallpaperInputRef = useRef(null);
  const longPressTimer = useRef(null);
  const scrollRef = useRef(null);
  const composerRef = useRef(null);
  const composerBarRef = useRef(null);
  const pinchStartRef = useRef(null);
  const prevMessageCount = useRef(0);
  const typingClearTimer = useRef(null);
  const voiceRecordingClearTimer = useRef(null);
  const readTimer = useRef(null);
  const { messages: rawMessages } = useMessages(chatId, myUid);
  const messages = rawMessages || [];
  const { contacts: convoContacts } = useContacts(myUid);
  const acceptedContacts = (convoContacts || []).filter((c) => c.status === "accepted");
  const presence = usePresence(isGroup ? null : otherUid, myUid);
  const otherParticipants = isGroup
    ? (chatMeta?.participants || []).filter((p) => p !== myUid)
    : [otherUid];
  const otherStatuses = useStatuses(isGroup ? [] : [otherUid]);
  const hasOtherActiveStatus = otherStatuses.length > 0;
  const otherViewedMap = getStoredViewed();
  const otherStatusViewed = !!otherViewedMap[otherUid];

  useEffect(() => {
    if (chatId || isGroup) return;
    getOrCreateDirectChat(myUid, otherUid).then(setChatId).catch((e) => setChatSetupError("Couldn't open this chat: " + e.message));
  }, [myUid, otherUid, chatId, isGroup]);

  useEffect(() => {
    if (chatId) markChatRead(chatId, myUid);
  }, [chatId, myUid, messages.length]);

  // Typing indicator: re-checked on a running local clock (not just when
  // Firestore sends an update), so a heartbeat that's gone stale actually
  // clears instead of getting stuck showing "typing" forever.
  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, "chats", chatId), (snap) => {
      const data = snap.data();
      setChatMeta(data);
      evaluateTyping(data?.typingUsers || {});
      evaluateVoiceRecording(data?.voiceRecordingUsers || {});
    });
    return unsub;

    function evaluateTyping(typingMap) {
      clearTimeout(typingClearTimer.current);
      const others = Object.entries(typingMap).filter(([uid]) => uid !== myUid);
      const freshest = others.reduce((max, [, ts]) => Math.max(max, ts?.toMillis?.() || 0), 0);
      const age = Date.now() - freshest;
      if (freshest && age < 5000) {
        setTheyTyping(true);
        typingClearTimer.current = setTimeout(() => setTheyTyping(false), 5000 - age);
      } else {
        setTheyTyping(false);
      }
    }

    // Same pattern as the typing indicator but for an in-progress voice note.
    function evaluateVoiceRecording(vrMap) {
      clearTimeout(voiceRecordingClearTimer.current);
      const others = Object.entries(vrMap).filter(([uid]) => uid !== myUid);
      const freshest = others.reduce((max, [, ts]) => Math.max(max, ts?.toMillis?.() || 0), 0);
      const age = Date.now() - freshest;
      if (freshest && age < 10000) {
        setTheyRecordingVoice(true);
        voiceRecordingClearTimer.current = setTimeout(() => setTheyRecordingVoice(false), 10000 - age);
      } else {
        setTheyRecordingVoice(false);
      }
    }
  }, [chatId, myUid]);

  useEffect(() => () => clearTimeout(typingClearTimer.current), []);
  useEffect(() => () => { clearTimeout(voiceRecordingClearTimer.current); clearInterval(voiceHeartbeatRef.current); clearInterval(liveLocRef.current); }, []);

  // Delivered fires immediately -- this chat's listener having the message
  // is a reasonable proxy for "the recipient's device has received it."
  useEffect(() => {
    if (chatId && messages.length) markMessagesDelivered(chatId, myUid, messages);
  }, [chatId, myUid, messages]);

  // Read fires after a short, deliberate delay so "delivered" is genuinely
  // visible for a moment first, rather than both states landing in the same
  // instant and looking like receipts jumped straight from sent to read.
  useEffect(() => {
    if (!chatId || !messages.length) return;
    clearTimeout(readTimer.current);
    const tryMarkRead = () => {
      if (document.visibilityState !== "visible") return;
      readTimer.current = setTimeout(() => markMessagesRead(chatId, myUid, messages), READ_DELAY_MS);
    };
    tryMarkRead();
    document.addEventListener("visibilitychange", tryMarkRead);
    return () => { document.removeEventListener("visibilitychange", tryMarkRead); clearTimeout(readTimer.current); };
  }, [chatId, myUid, messages]);

  useEffect(() => {
    if (!myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      const data = snap.data();
      setRestrictions(data?.restrictions || null);
    });
    return unsub;
  }, [myUid]);

  // Only auto-scroll when a NEW message actually arrives (count increases),
  // not on every metadata change (reactions, read receipts, etc.) -- that
  // was the cause of the view constantly jumping back to the bottom.
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      if (isFirstLoadRef.current) {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: animatedScrollEntry ? "smooth" : "instant" });
        isFirstLoadRef.current = false;
      } else if (isScrolledUpRef.current) {
        setNewMsgBadge((prev) => prev + (messages.length - prevMessageCount.current));
      } else {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }
    } else if (isFirstLoadRef.current && messages.length > 0) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: animatedScrollEntry ? "smooth" : "instant" });
      isFirstLoadRef.current = false;
    }
    prevMessageCount.current = messages.length;
  }, [messages, animatedScrollEntry]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isUp = distanceFromBottom > 200;
    isScrolledUpRef.current = isUp;
    setShowScrollDown(isUp);
    if (!isUp) setNewMsgBadge(0);
  };

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setNewMsgBadge(0);
  };

  useEffect(() => {
    if (!isGroup || !chatMeta?.participants) return;
    const missing = chatMeta.participants.filter((uid) => !(uid in memberNames));
    if (missing.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (uid) => {
          const snap = await getDoc(doc(db, "users", uid));
          return [uid, snap.data()?.displayName || snap.data()?.username || "Unknown"];
        })
      );
      setMemberNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
  }, [isGroup, chatMeta?.participants, memberNames]);

  useEffect(() => {
    if (isGroup || !otherUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid, "contacts", otherUid), (snap) => {
      setIsBlockedByMe(!!snap.data()?.blocked);
    });
    return unsub;
  }, [myUid, otherUid, isGroup]);

  useEffect(() => {
    if (chatId) setWallpaperState(getWallpaperForChat(chatId));
  }, [chatId]);

  const handleWallpaperUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !chatId) return;
    try {
      const dataUrl = await fileToWallpaperDataUrl(file);
      setWallpaperForChat(chatId, dataUrl);
      setWallpaperState(dataUrl);
    } catch (err) {
      setSendError("Couldn't set wallpaper: " + err.message);
    }
  };
  const clearWallpaper = () => {
    setWallpaperForChat(chatId, null);
    setWallpaperState(getWallpaperForChat(chatId)); // falls back to global if set
  };

  const autoResizeComposer = () => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 26 + composerHeight * 14)}px`;
  };

  useEffect(() => {
    autoResizeComposer();
  }, [composerHeight]);

  const handleInputChange = (val) => {
    setInput(val);
    autoResizeComposer();
    if (chatId) setTypingHeartbeat(chatId, myUid);
  };

  const send = async () => {
    if (!input.trim()) return;
    setSendError("");
    if (!chatId) { setSendError("Chat isn't ready yet — please wait a moment and try again."); return; }
    const textToSend = input.trim();
    setInput("");
    autoResizeComposer();
    try {
      await sendTextMessage(chatId, myUid, textToSend, otherParticipants, { replyTo: replyingTo });
      setReplyingTo(null);
      if (isGroup && shouldTriggerGroupAI(textToSend)) {
        const hasAI = (chatMeta?.participants || []).includes(AI_CONTACT_UID);
        if (hasAI) {
          sendGroupAIMessage(myUid, chatId, textToSend, messages).then(async (aiResponse) => {
            await addDoc(collection(db, "chats", chatId, "messages"), {
              senderId: AI_CONTACT_UID, senderName: "NexText AI", type: "text", text: aiResponse,
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
            await updateDoc(doc(db, "chats", chatId), {
              lastMessage: { text: aiResponse.slice(0, 80), senderId: AI_CONTACT_UID, sentAt: serverTimestamp(), type: "text" },
            }).catch(() => {});
          }).catch(() => {});
        }
      }
    } catch (e) {
      setSendError("Message didn't send: " + e.message);
      setInput(textToSend);
    }
  };

  const sendScheduled = async (dateObj) => {
    setShowSchedule(false);
    if (!input.trim() || !chatId) return;
    const textToSend = input.trim();
    setInput("");
    autoResizeComposer();
    try {
      await sendTextMessage(chatId, myUid, textToSend, otherParticipants, { scheduledFor: dateObj });
    } catch (e) {
      setSendError("Couldn't schedule message: " + e.message);
      setInput(textToSend);
    }
  };

  const saveEdit = async () => {
    if (!editingMsg || !input.trim()) return;
    try { await editMessage(chatId, editingMsg.id, input.trim(), editingMsg.text); }
    catch (e) { setSendError("Couldn't edit: " + e.message); }
    setInput("");
    autoResizeComposer();
    setEditingMsg(null);
  };

  const handleReact = async (emoji) => {
    if (!chatId || !activeMsg) return;
    try { await reactToMessage(chatId, activeMsg.id, myUid, emoji); }
    catch (e) { setSendError("Couldn't react: " + e.message); }
    if (emojiAnimations) setReactionFx({ emoji, nonce: Date.now() });
    setActiveMsg(null);
  };

  const handleCopyText = useCallback(() => {
    if (!activeMsg?.text) return;
    navigator.clipboard?.writeText(activeMsg.text).catch(() => {});
    setActiveMsg(null);
  }, [activeMsg]);

  const handleTranslateSelect = async (langCode) => {
    const m = translateMsg || activeMsg;
    if (!m?.text || !langCode || translatingLang) return;
    const key = m.id;
    setTranslatingLang(langCode);
    setTranslationErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
    try {
      const result = await translateMessage(myUid, m.text, langCode);
      setTranslations((prev) => ({ ...prev, [key]: { lang: langCode, text: result } }));
      setHiddenTranslations((prev) => { const n = { ...prev }; delete n[key]; return n; });
    } catch (e) {
      setTranslationErrors((prev) => ({ ...prev, [key]: e?.message || "Translation failed — try again." }));
    }
    setTranslatingLang("");
    setTranslateMsg(null);
    setActiveMsg(null);
  };

  const handleReply = () => {
    if (!activeMsg) return;
    setReplyingTo({
      messageId: activeMsg.id,
      senderId: activeMsg.senderId,
      previewText: activeMsg.text || (activeMsg.type === "poll" ? "📊 " + (activeMsg.poll?.question || "Poll") : ""),
      previewType: activeMsg.type,
    });
    setActiveMsg(null);
  };

  const canForward = (m) => !!m && m.type !== "poll" && !m.deletedForEveryone && !(m.deletedForSelf || []).includes(myUid);

  const handleForward = () => {
    if (!activeMsg) return;
    setForwardMsg(activeMsg);
    setActiveMsg(null);
  };

  const handleForwardTo = async (targets) => {
    if (!forwardMsg || !chatId || forwardBusy) return;
    setForwardBusy(true);
    let ok = 0;
    let fail = 0;
    for (const target of targets) {
      try {
        const targetChatId = await getOrCreateDirectChat(myUid, target.uid);
        const source = { ...forwardMsg, sourceChatId: chatId };
        await sendForwardedMessage(targetChatId, myUid, source, target.uid === myUid ? [] : [target.uid]);
        await incrementForwardedCount(chatId, forwardMsg.id);
        ok++;
      } catch { fail++; }
    }
    setForwardBusy(false);
    setForwardMsg(null);
    if (ok > 0) {
      setSendError(`↪️ Forwarded to ${ok} chat${ok === 1 ? "" : "s"}`);
      setTimeout(() => setSendError(""), 2500);
    } else if (fail > 0) {
      setSendError("Forward failed — try again.");
    }
  };

  const handleEdit = () => { if (!activeMsg) return; setEditingMsg(activeMsg); setInput(activeMsg.text || ""); setActiveMsg(null); setTimeout(autoResizeComposer, 0); };
  const handleDeleteSelf = async () => { if (!chatId || !activeMsg) return; try { await deleteMessageForSelf(chatId, activeMsg.id, myUid); } catch (e) { setSendError("Couldn't delete: " + (e.message || "server rejected the write")); } setActiveMsg(null); };
  const handleDeleteEveryone = async () => { if (!chatId || !activeMsg) return; try { await deleteMessageForEveryone(chatId, activeMsg.id); } catch (e) { setSendError("Couldn't delete for everyone: " + (e.message || "server rejected the write")); } setActiveMsg(null); };

  const createPoll = async (question, opts) => {
    try { await sendPollMessage(chatId, myUid, question, opts); }
    catch (e) { setSendError("Couldn't send poll: " + e.message); }
    setShowPoll(false); closeAttach();
    if (isGroup && (chatMeta?.participants || []).includes(AI_CONTACT_UID)) {
      setTimeout(async () => {
        try {
          const latest = messages[messages.length - 1];
          if (!latest?.poll) return;
          const opts = latest.poll.options;
          if (opts && opts.length > 0) {
            const randomIdx = Math.floor(Math.random() * opts.length);
            await voteOnPoll(chatId, latest.id, AI_CONTACT_UID, opts[randomIdx].id);
          }
        } catch { /* silent */ }
      }, 2000);
    }
  };

  const handleVote = async (msg, optionId) => {
    try { await voteOnPoll(chatId, msg.id, myUid, optionId); }
    catch (e) { setSendError("Couldn't vote: " + e.message); }
  };

  const handlePhotoOrVideoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file || !chatId) { setGalleryActive(false); return; }
    setGalleryActive(false);
    closeAttach();
    const isImage = file.type.startsWith("image/");
    const blocked = parentalBlockedType(isImage ? "image" : "video");
    if (blocked) { setSendError(blocked); return; }
    // Open a caption preview instead of sending instantly — the user can add
    // a caption, then Send, or Cancel. (File attachment from the paperclip
    // still sends instantly, this only changes gallery photo/video.)
    let previewUrl = null;
    try { previewUrl = URL.createObjectURL(file); } catch { /* preview optional */ }
    setCaptionText("");
    setPendingMedia({ file, isImage, previewUrl });
  };

  const cancelPendingMedia = () => {
    if (pendingMedia?.previewUrl) { try { URL.revokeObjectURL(pendingMedia.previewUrl); } catch {} }
    setPendingMedia(null);
    setCaptionText("");
  };

  const sendPendingMedia = async () => {
    const pm = pendingMedia;
    if (!pm?.file || !chatId || captionBusy) return;
    const blocked = parentalBlockedType(pm.isImage ? "image" : "video");
    if (blocked) { cancelPendingMedia(); setSendError(blocked); return; }
    setCaptionBusy(true);
    setSendError("");
    try {
      const result = await uploadChatFile(chatId, myUid, pm.file, { compress: pm.isImage });
      const caption = captionText.trim();
      await sendMediaMessage(chatId, myUid, pm.isImage ? "image" : "video", result, otherParticipants, { replyTo: replyingTo, text: caption || null });
      setReplyingTo(null);
      cancelPendingMedia();
    } catch (err) {
      if (err instanceof FileTooLargeError) setSendError("Files must be under 50MB.");
      else setSendError("Couldn't send: " + err.message);
    } finally {
      setCaptionBusy(false);
    }
  };

  const handleFilePick = async (e) => {    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !chatId) return;
    setSendError("");
    setUploading(true);
    try {
      const result = await uploadChatFile(chatId, myUid, file);
      await sendMediaMessage(chatId, myUid, "file", result, otherParticipants, { replyTo: replyingTo });
      setReplyingTo(null);
    } catch (err) {
      if (err instanceof FileTooLargeError) setSendError("Files must be under 50MB.");
      else setSendError("Couldn't send: " + err.message);
    }
    setUploading(false);
    closeAttach();
  };

  const getMicrophoneStream = async (constraints) => {
    // The Android WebView caches a "denied" answer for the page session even
    // after the user grants the permission in system settings, and the first
    // audio-capture start after launch (or right after the OS grant) can
    // transiently fail with NotReadableError ("Could not start audio source").
    //
    // Deep fixes applied here:
    //   1. A "priming" acquire+release right before the real capture. Many
    //      Android devices only free the previous AudioRecord/input state after
    //      one full (even failed) open+close cycle, so the second open works.
    //   2. The priming (and the default first attempt) uses AEC/noise/AGC
    //      DISABLED. Some devices cannot route the mic through the
    //      echo-cancelling audio processing chain and report NotReadableError
    //      on the default constraints, while the raw-input variant succeeds.
    //   3. Retry targeting the explicit physical audioinput deviceId. The
    //      virtual "default" device is sometimes busy/blocked while the real
    //      device id is available. Device ids only become visible after the
    //      origin has been granted media permission, so we enumerate AFTER the
    //      priming step (never before).
    //   4. Generous delays between attempts so the OS/WebView media stack can
    //      fully release the input between tries.
    //   5. A settle delay after any native permission request so the WebView
    //      media stack has registered the OS grant before the first capture.
    // Stop any lingering stream first: an un-released AudioTrack from a
    // previous capture can keep the input busy and cause NotReadableError.
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
      cameraStreamRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try { if (mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }

    const isMic = !constraints?.video;
    const base = constraints || { audio: true };
    const RETRYABLE = ["NotAllowedError", "PermissionDeniedError", "NotReadableError", "TrackStartError", "AbortError"];
    const attempts = [];
    const push = (delay, c) => attempts.push({ delay, constraints: c });

    // Settle so the WebView media stack sees the OS-level grant that was just
    // confirmed by the native permission request in startVoiceRecording.
    if (isMic) await new Promise((r) => setTimeout(r, 400));

    // Prime with the raw-input variant and release immediately so the device
    // state is fresh for the real capture below.
    if (isMic) {
      try {
        const primeStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        primeStream.getTracks().forEach((tr) => tr.stop());
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }

    // Capture the physical input deviceId AFTER priming — ids are blank until
    // the origin has media permission.
    let physicalInputId = null;
    if (isMic) {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const input = devs.find((d) => d.kind === "audioinput" && d.deviceId);
        if (input?.deviceId) physicalInputId = input.deviceId;
      } catch {}
    }

    push(0, isMic ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } } : base);
    push(700, base);
    if (physicalInputId) {
      push(1500, { audio: { deviceId: { exact: physicalInputId } } });
      push(2200, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: physicalInputId } } });
    } else {
      push(1500, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    }
    push(2800, base);

    let firstError = null;
    for (const attempt of attempts) {
      if (attempt.delay > 0) await new Promise((r) => setTimeout(r, attempt.delay));
      try {
        return await navigator.mediaDevices.getUserMedia(attempt.constraints);
      } catch (err) {
        firstError = firstError || err;
        if (!RETRYABLE.includes(err.name)) throw err;
      }
    }

    // Last resort: one more attempt with a freshly enumerated deviceId, in
    // case the id only became available after the earlier attempts failed.
    if (isMic) {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const input = devs.find((d) => d.kind === "audioinput" && d.deviceId);
        if (input?.deviceId) {
          try {
            return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: input.deviceId } } });
          } catch (err) {
            firstError = firstError || err;
            if (!RETRYABLE.includes(err.name)) throw err;
          }
        }
      } catch {}
    }

    firstError.isDenied = firstError.name === "NotAllowedError" || firstError.name === "PermissionDeniedError";
    throw firstError;
  };

  const getMicDiagnostics = async (err) => {
    const parts = ["mic diag"];
    try {
      parts.push(`name=${err?.name || "?"}`);
      parts.push(`msg=${(err?.message || "").slice(0, 80)}`);
    } catch { parts.push("name=?"); }
    try {
      const perms = await navigator.permissions?.query?.({ name: "microphone" }).catch(() => null);
      parts.push(`perm=${perms?.state || "unknown"}`);
    } catch { parts.push("perm=unknown"); }
    try {
      const inputs = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = inputs.filter((d) => d.kind === "audioinput");
      const ids = audioInputs.map((d) => (d.deviceId ? "id" : "blank"));
      parts.push(`audioInputs=${audioInputs.length}(${ids.join(",")})`);
    } catch { parts.push("audioInputs=?"); }
    parts.push(`gUM=${typeof navigator.mediaDevices?.getUserMedia === "function" ? "yes" : "no"}`);
    // Native probe: does the OS-level mic actually open? This distinguishes a
    // broken WebView media path (native works) from a device/OS mic problem
    // (native also fails). Runs only on the Capacitor native build.
    if (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform() && typeof window.NextextNative?.testMicrophone === "function") {
      try {
        const probe = await window.NextextNative.testMicrophone();
        parts.push(`osGranted=${probe?.osGranted}`);
        parts.push(`nativeProbe=${probe?.works ? "ok" : "fail"}`);
        if (!probe?.works) parts.push(`nativeErr=${(probe?.reason || "").slice(0, 60)}`);
      } catch { parts.push("nativeProbe=?"); }
    }
    return parts.join(" | ");
  };

  const isNativePlatform = () => window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform();
  const nativeSupportsRecording = () => isNativePlatform() && typeof NextextNative.startVoiceRecording === "function";

  const base64ToBlob = (b64, mimeType) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || "audio/mp4" });
  };

  // Mirrors setTypingHeartbeat but signals "recording a voice note right now"
  // so other users see the wavering mic indicator. Heartbeats every 4s.
  const startVoiceHeartbeat = () => {
    if (!chatId || !myUid) return;
    clearInterval(voiceHeartbeatRef.current);
    setVoiceRecordingHeartbeat(chatId, myUid).catch(() => {});
    voiceHeartbeatRef.current = setInterval(() => {
      setVoiceRecordingHeartbeat(chatId, myUid).catch(() => {});
    }, 4000);
  };

  const stopVoiceHeartbeat = () => {
    clearInterval(voiceHeartbeatRef.current);
    if (chatId && myUid) clearVoiceRecordingStatus(chatId, myUid).catch(() => {});
  };

  const beginRecordTimer = () => {
    clearInterval(recordTimerRef.current);
    recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
  };

  // ── Live recording waveform ─────────────────────────────────────────
  // Native path: NextextNative emits "voiceLevel" (0..1) events polled from
  // MediaRecorder.getMaxAmplitude(). WebView path: an AnalyserNode on the live
  // mic stream. Both drive the same recLevel state so the recording bar can
  // draw real bars while the user talks.
  const updateRecLevel = (v) => {
    v = Math.max(0, Math.min(1, v));
    if (Math.abs(v - lastRecLevelRef.current) < 0.03) return;
    lastRecLevelRef.current = v;
    setRecLevel(v);
  };

  const startRecLevelMonitor = async (stream) => {
    stopRecLevelMonitor();
    if (stream) {
      // WebView recording — sample the live mic via an analyser.
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        try {
          const actx = new Ctx();
          const src = actx.createMediaStreamSource(stream);
          const analyser = actx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          recAudioCtxRef.current = actx;
          recAnalyserRef.current = analyser;
          const buf = new Float32Array(analyser.fftSize);
          recLevelTimerRef.current = setInterval(() => {
            try {
              // Time-domain RMS tracks spoken amplitude the way a real voice
              // waveform looks. (getByteFrequencyData would draw a spiky,
              // nonsensical spectrum instead of a clean speech envelope.)
              analyser.getFloatTimeDomainData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
              const rms = Math.sqrt(sum / buf.length);
              updateRecLevel(Math.min(1, rms * 9));
            } catch {}
          }, 80);
          return;
        } catch { /* fall back to silent wave */ }
      }
      return;
    }
    // Native recording — subscribe to the plugin's amplitude events.
    try {
      const handle = await NextextNative.addListener("voiceLevel", (e) => {
        if (typeof e?.level === "number") updateRecLevel(e.level);
      });
      if (handle && typeof handle.then === "function") {
        handle.then((h) => { recLevelListenerRef.current = h; }).catch(() => {});
      } else {
        recLevelListenerRef.current = handle;
      }
    } catch {
      /* no wave available on this build */
    }
  };

  const stopRecLevelMonitor = () => {
    clearInterval(recLevelTimerRef.current);
    recLevelTimerRef.current = null;
    if (recAudioCtxRef.current) { try { recAudioCtxRef.current.close(); } catch {} }
    recAudioCtxRef.current = null;
    recAnalyserRef.current = null;
    if (recLevelListenerRef.current && typeof recLevelListenerRef.current.remove === "function") {
      try { recLevelListenerRef.current.remove(); } catch {}
    }
    recLevelListenerRef.current = null;
    lastRecLevelRef.current = 0;
    setRecLevel(0);
  };

  const startVoiceRecording = async () => {
    setSendError("");
    if (recordedPreviewRef.current) discardRecordedPreview();
    const blocked = parentalBlockedType("voice");
    if (blocked) { setSendError(blocked); return; }
    const token = ++voiceSessionTokenRef.current;
    try {
      // Native-first: the Android WebView media path (getUserMedia + web
      // MediaRecorder) is unreliable on some devices, so record through the
      // NextextNative plugin (real OS MediaRecorder -> m4a) whenever possible.
      if (nativeSupportsRecording()) {
        try {
          await NextextNative.startVoiceRecording();
          if (token !== voiceSessionTokenRef.current) {
            await NextextNative.cancelVoiceRecording().catch(() => {});
            return;
          }
          recordingNativeRef.current = true;
          recordStartTsRef.current = Date.now();
          setRecording(true);
          setRecordingPaused(false);
          setRecordSeconds(0);
          beginRecordTimer();
          startVoiceHeartbeat();
          startRecLevelMonitor(null);
          return;
        } catch { /* fall through to the WebView path */ }
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setSendError("Voice recording is not supported on this browser or device.");
        return;
      }
      if (isNativePlatform()) {
        try {
          const perm = await NextextNative.requestMicrophone();
          if (perm && perm.granted === false) {
            setSendError("Microphone permission is off. Tap Settings in your device for NexText, allow Microphone, then press the mic button again.");
            return;
          }
        } catch { /* fall through to WebView permission flow */ }
      }
      const stream = await getMicrophoneStream();
      if (token !== voiceSessionTokenRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      recordingNativeRef.current = false;
      recordedChunksRef.current = [];
      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm;codecs=opus";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/ogg;codecs=opus";
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = "";
          }
        }
      }
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 96000 }) : new MediaRecorder(stream, { audioBitsPerSecond: 96000 });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      // Request a 250ms timeslice so dataavailable fires periodically during
      // the recording (not only at stop). This guarantees the audio stream
      // is written incrementally to recordedChunks and protects against the
      // final-stop chunk being dropped on WebViews that race onstop vs.
      // dataavailable ordering — the cause of silent-wave voice notes.
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      recordStartTsRef.current = Date.now();
      setRecording(true);
      setRecordingPaused(false);
      setRecordSeconds(0);
      beginRecordTimer();
      startVoiceHeartbeat();
      startRecLevelMonitor(stream);
    } catch (err) {
      let msg = "Microphone access denied or unavailable. Please check your device settings and ensure microphone permission is granted for NexText, then try again.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        msg = "Microphone permission is off. Tap Settings in your device for NexText, allow Microphone, then press the mic button again. If it still fails, restart the app.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        msg = "No microphone found. Please connect a microphone and try again.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError" || err.originalName === "NotReadableError" || err.originalName === "TrackStartError") {
        msg = "The microphone is busy or unavailable. Please close other apps using the microphone and try again. If it still fails, restart the app.";
      }
      // Append concise device diagnostics so failures can be pinpointed from
      // the exact message the user reports back.
      try {
        const diag = await getMicDiagnostics(err);
        msg += ` (${diag})`;
      } catch { /* diagnostics are best-effort */ }
      setSendError(msg);
    }
  };

  const resetRecordingUi = () => {
    voiceSessionTokenRef.current++;
    setRecording(false);
    setRecordingHold(false);
    setRecordingTapMode(false);
    setRecordingPaused(false);
    setRecordingSlideCancel(false);
    setRecordSeconds(0);
    recordHoldStartRef.current = null;
    recordHoldCancelRef.current = false;
    recordingRef.current = false;
    recordingHoldRef.current = false;
    stopRecLevelMonitor();
  };

  // Stop whichever recorder is active and hand back the captured audio blob.
  // Shared by send (stopVoiceRecording) and the Stop button (preview), so both
  // paths get identical stop semantics (flush onstop + trailing chunk drain).
  const stopRecorder = async () => {
    const wasNative = recordingNativeRef.current;
    let blob = null;
    try {
      if (wasNative) {
        const res = await NextextNative.stopVoiceRecording();
        if (res?.base64) blob = base64ToBlob(res.base64, res.mimeType || "audio/mp4");
      } else {
        const recorder = mediaRecorderRef.current;
        if (recorder) {
          // Critical ordering: stop() the recorder FIRST and wait for the
          // onstop event (which only fires AFTER the recorder has flushed its
          // final dataavailable chunk). Stopping the media tracks before
          // onstop was cutting the last ~200ms of audio and producing
          // silent-tail / flat-wave voice notes on several Android WebViews.
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 2000);
            recorder.onstop = () => { clearTimeout(timer); resolve(); };
            recorder.onerror = () => { clearTimeout(timer); resolve(); };
            try { if (recorder.state !== "inactive") recorder.stop(); else resolve(); } catch { resolve(); }
          });
          // Some WebViews deliver the final dataavailable chunk as a trailing
          // task AFTER onstop despite the spec. One macrotask drain guarantees
          // those chunks are in recordedChunksRef before we build the blob.
          await new Promise((r) => setTimeout(r, 0));
          try { recorder.stream?.getTracks?.().forEach((tr) => tr.stop()); } catch {}
          mediaRecorderRef.current = null;
          blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        }
      }
    } catch (err) {
      setSendError("Couldn't stop recording: " + err.message);
    }
    recordingNativeRef.current = false;
    return { blob, wasNative };
  };

  const stopVoiceRecording = async (send) => {
    clearInterval(recordTimerRef.current);
    stopVoiceHeartbeat();
    const finalDuration = recordSeconds;
    // Android MediaRecorder frequently writes a corrupt/empty MP4 when the
    // recording is stopped within the first ~half second, so a sub-second tap
    // is treated as a cancel rather than a broken note being uploaded.
    const elapsedMs = recordStartTsRef.current ? Date.now() - recordStartTsRef.current : 0;
    recordStartTsRef.current = null;
    const { blob, wasNative } = await stopRecorder();
    resetRecordingUi();
    if (!send) return;
    // Parental controls may have been enabled while the note was being
    // recorded — drop it rather than uploading + failing the Firestore write.
    const blocked = parentalBlockedType("voice");
    if (blocked) { setSendError(blocked); return; }
    if (elapsedMs < 500) {
      setSendError("Hold the mic a little longer — the recording was too short to save.");
      return;
    }
    if (!blob || !chatId || blob.size === 0) {
      // The user pressed Send and we ended up with no audio data.
      // Surface a clear, specific error instead of silently dropping the note
      // (the cause of "voice notes don't record audio" reports).
      setSendError("Voice note failed — no audio was captured. Try again, and make sure the mic permission is granted.");
      return;
    }
    const file = new File([blob], `voice-${Date.now()}.${wasNative ? "m4a" : "webm"}`, { type: blob.type || (wasNative ? "audio/mp4" : "audio/webm") });
    setUploading(true);
    try {
      const result = await uploadChatFile(chatId, myUid, file);
      await sendMediaMessage(chatId, myUid, "voice", result, otherParticipants, { durationSeconds: Math.max(1, Math.round(finalDuration)) });
    } catch (err) {
      if (err instanceof FileTooLargeError) setSendError("Voice note too large (over 50MB).");
      else setSendError("Couldn't send voice note: " + err.message);
    }
    setUploading(false);
  };

  // "Stop" button in the recording bar: stop recording but keep the audio as a
  // pending preview so the user can listen to it before deciding to send.
  const stopVoiceRecordingToPreview = async () => {
    clearInterval(recordTimerRef.current);
    stopVoiceHeartbeat();
    const finalDuration = recordSeconds;
    const elapsedMs = recordStartTsRef.current ? Date.now() - recordStartTsRef.current : 0;
    recordStartTsRef.current = null;
    const { blob, wasNative } = await stopRecorder();
    resetRecordingUi();
    if (elapsedMs < 500) {
      setSendError("The recording was too short to keep — try holding the mic a little longer.");
      return;
    }
    if (!blob || blob.size === 0) {
      setSendError("Voice note failed — no audio was captured. Make sure the mic permission is granted.");
      return;
    }
    discardRecordedPreview(false);
    setRecordedPreview({
      url: URL.createObjectURL(blob),
      blob,
      duration: Math.max(1, Math.round(finalDuration)),
      type: blob.type || (wasNative ? "audio/mp4" : "audio/webm"),
      isNative: wasNative,
    });
  };

  const sendRecordedPreview = async () => {
    const p = recordedPreview;
    if (!p) return;
    const blocked = parentalBlockedType("voice");
    if (blocked) { setSendError(blocked); return; }
    if (!p.blob || !chatId || p.blob.size === 0) {
      setSendError("Voice note failed — no audio was captured.");
      return;
    }
    setUploading(true);
    try {
      const file = new File([p.blob], `voice-${Date.now()}.${p.isNative ? "m4a" : "webm"}`, { type: p.type || (p.isNative ? "audio/mp4" : "audio/webm") });
      const result = await uploadChatFile(chatId, myUid, file);
      await sendMediaMessage(chatId, myUid, "voice", result, otherParticipants, { durationSeconds: p.duration });
      discardRecordedPreview();
    } catch (err) {
      if (err instanceof FileTooLargeError) setSendError("Voice note too large (over 50MB).");
      else setSendError("Couldn't send voice note: " + err.message);
    }
    setUploading(false);
  };

  const discardRecordedPreview = (stopPlayback = true) => {
    if (stopPlayback) {
      try { previewAudioRef.current?.pause(); } catch {}
    }
    try { if (recordedPreviewRef.current?.url) URL.revokeObjectURL(recordedPreviewRef.current.url); } catch {}
    setRecordedPreview(null);
    setPreviewPlaying(false);
  };

  const togglePreviewPlayback = () => {
    const audio = previewAudioRef.current;
    if (!audio || !recordedPreview) return;
    if (previewPlaying) { audio.pause(); setPreviewPlaying(false); return; }
    audio.currentTime = 0;
    audio.play().then(() => setPreviewPlaying(true)).catch(() => setPreviewPlaying(false));
  };

  const cancelVoiceRecording = async () => {
    clearInterval(recordTimerRef.current);
    stopVoiceHeartbeat();
    try {
      if (recordingNativeRef.current) {
        await NextextNative.cancelVoiceRecording().catch(() => {});
      } else if (mediaRecorderRef.current) {
        try { if (mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop(); } catch {}
        mediaRecorderRef.current.stream?.getTracks?.().forEach((tr) => tr.stop());
        mediaRecorderRef.current = null;
      }
    } catch {}
    recordingNativeRef.current = false;
    resetRecordingUi();
  };

  const pauseVoiceRecording = async () => {
    try {
      if (recordingNativeRef.current) {
        await NextextNative.pauseVoiceRecording();
      } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.pause();
      }
      clearInterval(recordTimerRef.current);
      setRecordingPaused(true);
    } catch { /* keep recording */ }
  };

  const resumeVoiceRecording = async () => {
    try {
      if (recordingNativeRef.current) {
        await NextextNative.resumeVoiceRecording();
      } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.resume();
      }
      beginRecordTimer();
      setRecordingPaused(false);
    } catch { /* keep paused */ }
  };

  const restartVoiceRecording = async () => {
    clearInterval(recordTimerRef.current);
    try {
      if (recordingNativeRef.current) {
        await NextextNative.cancelVoiceRecording().catch(() => {});
      } else if (mediaRecorderRef.current) {
        try { if (mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop(); } catch {}
        mediaRecorderRef.current.stream?.getTracks?.().forEach((tr) => tr.stop());
        mediaRecorderRef.current = null;
      }
    } catch {}
    recordedChunksRef.current = [];
    setRecordSeconds(0);
    setRecordingPaused(false);
    setRecordingSlideCancel(false);
    await startVoiceRecording();
  };

  // ── Hold-to-record / tap-to-record gesture handling on the mic button ──
  // Long-press = record (hold to record, release to send, slide left to cancel)
  // Quick tap = enter recording tap mode (pause/restart/cancel/send bar)
  const micPointerDown = (e) => {
    e.preventDefault();
    if (recordingRef.current) return;
    // Parental controls: don't even start the gesture when voice is blocked.
    const blocked = parentalBlockedType("voice");
    if (blocked) { setSendError(blocked); return; }
    // Haptic confirmation that the hold-to-record gesture started.
    if (isNativePlatform() && typeof NextextNative.vibrate === "function") {
      try { NextextNative.vibrate({ ms: 40 }).catch(() => {}); } catch {}
    }
    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
    recordHoldStartRef.current = { x: clientX, y: clientY, t: Date.now() };
    recordHoldCancelRef.current = false;
    recordingRef.current = true;
    recordingHoldRef.current = true;
    setRecordingHold(true);
    setRecordingSlideCancel(false);

    // Recording starts immediately. Release behavior is decided in micPointerUp:
    // quick tap -> keep recording in tap-mode bar, long hold -> release to send.

    const onPointerMove = (ev) => {
      const start = recordHoldStartRef.current;
      if (!start || !recordingHoldRef.current) return;
      const curX = ev.clientX || ev.touches?.[0]?.clientX || 0;
      const dx = curX - start.x;
      if (dx < -70) {
        recordHoldCancelRef.current = true;
        setRecordingSlideCancel(true);
      } else {
        recordHoldCancelRef.current = false;
        setRecordingSlideCancel(false);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("touchend", onPointerUp);
      window.removeEventListener("touchcancel", onPointerUp);
      micPointerUp();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("touchend", onPointerUp);
    window.addEventListener("touchcancel", onPointerUp);

    startVoiceRecording();
  };

  const micPointerMove = (e) => {
    const start = recordHoldStartRef.current;
    if (!start || !recordingHoldRef.current) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const dx = clientX - start.x;
    if (dx < -70) {
      recordHoldCancelRef.current = true;
      setRecordingSlideCancel(true);
    } else {
      recordHoldCancelRef.current = false;
      setRecordingSlideCancel(false);
    }
  };

  const micPointerUp = () => {
    const start = recordHoldStartRef.current;
    const wasHolding = recordingHoldRef.current;
    const heldMs = start ? Date.now() - start.t : 0;
    recordHoldStartRef.current = null;
    recordingHoldRef.current = false;
    setRecordingHold(false);
    setRecordingSlideCancel(false);
    if (!wasHolding) return;
    if (recordHoldCancelRef.current) {
      recordHoldCancelRef.current = false;
      cancelVoiceRecording();
      return;
    }
    // Unified behavior: BOTH gestures work at all times. A quick tap (<300ms)
    // opens the tap-mode bar (pause / cancel / send). A longer hold releases
    // to send immediately. The old per-mode toggle is gone — whichever the
    // user does, it does the right thing.
    if (heldMs >= 300) {
      // Long hold -> release to send.
      stopVoiceRecording(true);
    } else {
      // Quick tap -> keep recording in bar mode with pause/cancel/send.
      setRecordingTapMode(true);
    }
  };

  const handleBack = () => {
    if (recordingRef.current) {
      clearInterval(recordTimerRef.current);
      stopVoiceHeartbeat();
      if (recordingNativeRef.current) {
        NextextNative.cancelVoiceRecording().catch(() => {});
        recordingNativeRef.current = false;
      } else if (mediaRecorderRef.current) {
        try { if (mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop(); } catch {}
        mediaRecorderRef.current.stream?.getTracks?.().forEach((tr) => tr.stop());
        mediaRecorderRef.current = null;
      }
      resetRecordingUi();
    } else {
      stopVoiceHeartbeat();
    }
    onBack();
  };

  const openCamera = async () => {
    closeAttach();
    setCameraError("");
    const blocked = parentalBlockedType("image");
    if (blocked) { setSendError(blocked); return; }
    try {
      const stream = await getMicrophoneStream({ video: { facingMode: cameraFacing } });
      cameraStreamRef.current = stream;
      setShowCamera(true);
      setTimeout(() => {
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          cameraVideoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setCameraError("Camera access denied or unavailable. Allow Camera for NexText in your device settings, then try again.");
    }
  };

  const flipChatCamera = async () => {
    const next = cameraFacing === "environment" ? "user" : "environment";
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
        cameraStreamRef.current = null;
      }
      setCameraFacing(next);
      const stream = await getMicrophoneStream({ video: { facingMode: next } });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        cameraVideoRef.current.play().catch(() => {});
      }
    } catch {
      setCameraFacing((f) => (f === "environment" ? "user" : "environment"));
      setCameraError("Couldn't switch camera. Check the Camera permission in your device settings.");
    }
  };

  const capturePhoto = async () => {
    if (!cameraVideoRef.current || !chatId) return;
    const video = cameraVideoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      const thumbnailUrl = URL.createObjectURL(blob);
      setCapturedPhotos((prev) => [...prev, { file, thumbnailUrl, sending: false }]);
    }, "image/jpeg", 0.92);
  };

  const closeCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
      cameraStreamRef.current = null;
    }
    setCapturedPhotos([]);
    setShowCamera(false);
  };

  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });

  const isSelfChat = otherUid === myUid;
  const isMuted = chatMeta?.mutedBy?.[myUid] && (chatMeta.mutedBy[myUid] === "forever" || chatMeta.mutedBy[myUid]?.toMillis?.() > Date.now());
  const isFavorite = chatMeta?.favoritedBy?.includes(myUid);
  const isLocked = chatMeta?.lockedBy?.[myUid];

  // Parental controls: drop incoming voice notes when "block voice notes" is
  // enabled. Filtering here (not just in renderBubble) removes them from the
  // DOM and from autoplay chains entirely, so notes sent BEFORE the block was
  // enabled are hidden too, not just new ones.
  const isBlockedVoice = (m) =>
    m.type === "voice" && !m.deletedForEveryone &&
    restrictions?.blockVoiceNotes === true && m.senderId !== myUid;
  // Also block if blockMedia is enabled (covers all media types including voice)
  const isMediaBlocked = (m) =>
    m.type === "voice" && !m.deletedForEveryone &&
    (restrictions?.blockVoiceNotes === true || restrictions?.blockMedia === true) && m.senderId !== myUid;

  // Client-side mirror of the firestore.rules `mediaAllowed` check. The rules
  // already block these sends server-side, but without a client gate the user
  // records/uploads the media and only hits the confusing Firestore "permission
  // denied" at the very end (leaving an orphaned blob in storage). Gating here
  // prevents the send and explains WHY. Returns an error message or null.
  const parentalBlockedType = (type) => {
    const r = restrictions;
    if (!r) return null;
    if (type === "voice" && (r.blockMedia === true || r.blockVoiceNotes === true))
      return "Voice notes are blocked by parental controls.";
    if (type === "image" && (r.blockMedia === true || r.blockIncomingPhotos === true))
      return "Photos are blocked by parental controls.";
    if (type === "video" && (r.blockMedia === true || r.blockIncomingVideos === true))
      return "Videos are blocked by parental controls.";
    return null;
  };

  const visibleMessages = (searchQuery.trim()
    ? messages.filter((m) => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages
  ).filter((m) => !isMediaBlocked(m));

  const replyToSenderName = (senderId) => {
    if (senderId === myUid) return "You";
    if (isGroup) return memberNames[senderId] || "…";
    return getContactDisplayName(contact);
  };

  // When a voice note finishes, auto-advance to the next note — but only if
  // it's the IMMEDIATELY following message (2+ messages apart = stop). A
  // regular chime plays after EVERY note (restored: v1.1.25 had silenced
  // single notes by only pinging on 3+ runs), and a distinct end-of-burst
  // chime plays once when a run of 2+ consecutive notes finishes.
  const handleVoiceEnded = (msgId) => {
    const idx = visibleMessages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    voiceChainRef.current += 1;
    voiceChainLastIdxRef.current = idx;
    playVoicePing();
    const next = visibleMessages[idx + 1];
    if (next && next.type === "voice" && !next.deletedForEveryone && next.mediaURL) {
      setVoiceAutoPlayId(next.id);
      setVoiceAutoPlayNonce((n) => n + 1);
      return;
    }
    // Run over — burst chime for a run of 2+, then reset the chain.
    if (voiceChainRef.current >= 2) playVoiceEndChime();
    voiceChainRef.current = 0;
    voiceChainLastIdxRef.current = -1;
  };

  const handleVoicePlayStart = (msgId) => {
    // onPlayStart(null) fires when a note STOPS (the player pauses/ends) —
    // that's not a new play and must not touch the burst chain.
    if (msgId == null) { setNowPlayingId(null); return; }
    const idx = visibleMessages.findIndex((m) => m.id === msgId);
    // A play that isn't the immediate next note starts a fresh run, so notes
    // played far apart never accumulate into a burst.
    if (voiceChainLastIdxRef.current !== -1 && idx !== voiceChainLastIdxRef.current + 1) {
      voiceChainRef.current = 0;
    }
    setNowPlayingId(msgId);
  };

  // Transcribes a voice note via Groq Whisper. The result is saved to the
  // message doc (so it survives the audio-expiry window) and mirrored into
  // local state. If the Firestore write is rejected by rules, it still shows
  // in-memory/localStorage for the current device.
  const transcribeVoice = async (m) => {
    if (transcribingId || !m?.id) return;
    if (voiceTranscripts[m.id] || m.transcript) return;
    if (!m.mediaURL) {
      setTranscriptErrors((e) => ({ ...e, [m.id]: "This note's audio has expired." }));
      return;
    }
    setTranscribingId(m.id);
    setTranscriptErrors((e) => { const n = { ...e }; delete n[m.id]; return n; });
    try {
      const res = await fetch(m.mediaURL);
      const blob = await res.blob();
      const text = await transcribeVoiceNote(myUid, blob);
      try {
        await updateDoc(doc(db, "chats", chatId, "messages", m.id), { transcript: text });
      } catch { /* rules may reject non-owner writes — in-memory copy still works */ }
      setVoiceTranscripts((prev) => ({ ...prev, [m.id]: text }));
    } catch (err) {
      setTranscriptErrors((prev) => ({ ...prev, [m.id]: err?.message || "Transcription failed. Check your connection and try again." }));
    } finally {
      setTranscribingId(null);
    }
  };

  const hideTranscript = (m) => setHiddenTranscripts((prev) => ({ ...prev, [m.id]: true }));
  const unhideTranscript = (m) => setHiddenTranscripts((prev) => { const n = { ...prev }; delete n[m.id]; return n; });
  // Transcription shown for a message comes from the message doc first
  // (persists past audio expiry) with the local copy as fallback.
  const transcriptTextFor = (m) => m.transcript || voiceTranscripts[m.id] || null;

  const TranscriptBlock = ({ m }) => {
    const text = transcriptTextFor(m);
    const hidden = hiddenTranscripts[m.id] === true;
    if (!text) return null;
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6, maxWidth: 230 }}>
        <div style={{ fontSize: 12.5 * chatTextScale, color: m.senderId === myUid ? "rgba(255,255,255,0.85)" : t.textMuted, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", fontStyle: "italic", flex: 1 }}>
          {hidden ? (
            <button
              onClick={(e) => { e.stopPropagation(); unhideTranscript(m); }}
              style={{ background: "transparent", border: "none", padding: 0, color: m.senderId === myUid ? "rgba(255,255,255,0.75)" : t.primary, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontStyle: "normal" }}
            >
              Show transcript
            </button>
          ) : (
            <span>"{text}"</span>
          )}
        </div>
        {!hidden && (
          <button
            onClick={(e) => { e.stopPropagation(); hideTranscript(m); }}
            title="Hide transcription"
            style={{ background: "transparent", border: "none", padding: 2, color: m.senderId === myUid ? "rgba(255,255,255,0.7)" : t.textMuted, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}
          >
            <EyeOff size={13} />
          </button>
        )}
      </div>
    );
  };

  const renderBubble = (m) => {
    const expiryText = getMediaExpiryText(m.sentAt, globalSettings?.mediaExpiryDays);
    if (m.deletedForEveryone) return <div style={{ fontSize: 13, fontStyle: "italic", opacity: 0.6 }}>This message was deleted</div>;
    if (m.type === "poll") return <PollBubble t={t} mine={m.senderId === myUid} poll={m.poll} myUid={myUid} onVote={(optId) => handleVote(m, optId)} textScale={chatTextScale} />;

    if (["image", "video", "voice", "file"].includes(m.type) && isMediaExpired(m, globalSettings?.mediaExpiryDays)) {
      const ExpiredIcon = m.type === "image" ? ImageOff : m.type === "video" ? VideoOff : m.type === "voice" ? MicOff : FileX;
      return (
        <div>
          <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: m.senderId === myUid ? "rgba(255,255,255,0.12)" : t.primaryLight }}>
            <ExpiredIcon size={16} color={t.textMuted} />
            <span style={{ fontSize: 13, fontStyle: "italic", color: t.textMuted }}>Expired</span>
          </div>
          {m.type === "voice" && transcriptTextFor(m) && (
            <TranscriptBlock m={m} />
          )}
        </div>
      );
    }

    // Parental controls: intercept incoming blocked media before it renders.
    if (restrictions && m.senderId !== myUid) {
      const blockMedia = restrictions.blockMedia || restrictions.blockIncomingPhotos || restrictions.blockIncomingVideos;
      const isBlockedMedia =
        (m.type === "image" && (restrictions.blockMedia || restrictions.blockIncomingPhotos)) ||
        (m.type === "video" && (restrictions.blockMedia || restrictions.blockIncomingVideos)) ||
        (m.type === "voice" && (restrictions.blockMedia || restrictions.blockVoiceNotes)) ||
        (m.type === "file" && (restrictions.blockMedia || restrictions.blockIncomingPhotos || restrictions.blockIncomingVideos));
      if (isBlockedMedia || (blockMedia && (m.type === "image" || m.type === "video"))) {
        return (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "#FFE5E5", color: "#B00020", fontSize: 13.5, fontWeight: 600 }}>
            <Lock size={15} />
            <span>[Blocked by parental controls]</span>
          </div>
        );
      }
    }

    const { text: displayText, blocked } = filterTextByParentalControls(m.text, restrictions?.customFilterLists);

    if (m.type === "location") {
      const liveMs = m.liveUntil?.toMillis ? m.liveUntil.toMillis() : (typeof m.liveUntil === "number" ? m.liveUntil : 0);
      const isLive = liveMs > Date.now();
      const mapsUrl = m.lat != null && m.lng != null ? `https://maps.google.com/maps?q=${m.lat},${m.lng}&z=16&output=embed` : null;
      return (
        <div>
          <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
          <div style={{ width: 220, overflow: "hidden", borderRadius: 8, background: "rgba(0,0,0,0.05)" }}>
            {mapsUrl ? (
              <iframe
                title="Shared location"
                src={mapsUrl}
                loading="lazy"
                style={{ width: "100%", height: 150, border: "none", pointerEvents: "none", display: "block" }}
              />
            ) : (
              <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: t.textMuted, fontSize: 12 }}>📍 Map unavailable</div>
            )}
            <div
              onClick={(e) => { e.stopPropagation(); if (m.lat != null && m.lng != null) window.open(`https://maps.google.com/maps?q=${m.lat},${m.lng}&z=16`, "_blank"); }}
              style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              {isLive && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#FF3B30", borderRadius: 6, padding: "2px 6px", flexShrink: 0 }}>LIVE</span>}
              <span style={{ fontSize: 12.5 * chatTextScale, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isLive ? "Live location" : (m.label || "Shared location")}
              </span>
            </div>
          </div>
          {expiryText && <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2, fontStyle: "italic" }}>{expiryText}</div>}
        </div>
      );
    }
    if (m.type === "contact") {
      const alreadySaved = m.contactUid && m.contactUid !== myUid && (convoContacts || []).some((c) => c.uid === m.contactUid && c.status === "accepted");
      const isMe = m.contactUid === myUid;
      return (
        <div>
          <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
          <div style={{ width: 240, borderRadius: 10, overflow: "hidden", border: `1px solid ${t.border}`, background: t.bubbleOtherBg }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px" }}>
              <Avatar photoURL={m.contactPhotoURL} name={m.contactName || "Contact"} uid={m.contactUid} size={44} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.contactName || "Contact"}</div>
                {m.contactUsername && <div style={{ fontSize: 12, color: t.textMuted }}>@{m.contactUsername}</div>}
              </div>
            </div>
            <div style={{ display: "flex", borderTop: `1px solid ${t.border}` }}>
              <div onClick={(e) => { e.stopPropagation(); openSharedContactChat(m); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", cursor: onOpenChat ? "pointer" : "default", borderRight: `1px solid ${t.border}`, color: t.primary, fontSize: 12.5, fontWeight: 700 }}>
                <MessageSquare size={14} /> Message
              </div>
              <div onClick={(e) => { e.stopPropagation(); saveSharedContact(m); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", cursor: isMe ? "default" : "pointer", color: alreadySaved ? "#28A745" : t.primary, fontSize: 12.5, fontWeight: 700, opacity: isMe ? 0.5 : 1 }}>
                <UserPlus size={14} /> {isMe ? "You" : alreadySaved ? "Saved" : "Save"}
              </div>
            </div>
          </div>
          {expiryText && <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2, fontStyle: "italic" }}>{expiryText}</div>}
        </div>
      );
    }
    if (m.type === "image") return (
      <div>
        <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
        <div onClick={(e) => { e.stopPropagation(); setFullscreenImage(m.mediaURL); }} style={{ cursor: "pointer", width: 220, height: 220, overflow: "hidden", borderRadius: 8, background: "rgba(0,0,0,0.05)" }}>
          <img src={m.mediaURL} alt="Sent photo" className="nx-media-img" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
        {m.text && <div style={{ fontSize: 14.5 * chatTextScale, lineHeight: 1.35, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>}
        {expiryText && <div style={{ fontSize: 10, opacity: 0.55, marginTop: 3, fontStyle: "italic" }}>{expiryText}</div>}
      </div>
    );
    if (m.type === "video") return (
      <div>
        <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
          <div style={{ width: 220, height: 220, overflow: "hidden", borderRadius: 8, background: "rgba(0,0,0,0.05)", position: "relative" }}>
            <video src={m.mediaURL} controls className="nx-media-img" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
        {m.text && <div style={{ fontSize: 14.5 * chatTextScale, lineHeight: 1.35, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>}
        {expiryText && <div style={{ fontSize: 10, opacity: 0.55, marginTop: 3, fontStyle: "italic" }}>{expiryText}</div>}
      </div>
    );
    if (m.type === "voice") return (
      <div>
        <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
        <VoicePlayer url={m.mediaURL} duration={m.mediaDurationSeconds} mine={m.senderId === myUid} t={t} msgId={m.id} onEnded={handleVoiceEnded} autoPlayToken={voiceAutoPlayNonce} isAutoPlayTarget={m.id === voiceAutoPlayId} nowPlayingId={nowPlayingId} onPlayStart={handleVoicePlayStart} />
        {transcriptTextFor(m) ? (
          <TranscriptBlock m={m} />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); transcribeVoice(m); }}
            disabled={transcribingId === m.id}
            style={{ marginTop: 5, padding: "5px 10px", borderRadius: 8, border: `1px solid ${m.senderId === myUid ? "rgba(255,255,255,0.35)" : t.border}`, background: "transparent", color: m.senderId === myUid ? "rgba(255,255,255,0.9)" : t.primary, fontSize: 12, fontWeight: 600, cursor: transcribingId === m.id ? "default" : "pointer" }}
          >
            {transcribingId === m.id ? "Transcribing…" : "Transcribe"}
          </button>
        )}
        {transcriptErrors[m.id] && <div style={{ fontSize: 11, color: "#FF3B30", marginTop: 3, maxWidth: 230, lineHeight: 1.3 }}>{transcriptErrors[m.id]}</div>}
        {expiryText && <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2, fontStyle: "italic" }}>{expiryText}</div>}
      </div>
    );
    if (m.type === "file") return (
      <div>
        <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
        <a href={m.mediaURL} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
          <FileText size={26} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5 * chatTextScale, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{m.fileName || "File"}</div>
            <div style={{ fontSize: 11 * chatTextScale, opacity: 0.7 }}>{m.fileSizeBytes ? `${(m.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}</div>
          </div>
        </a>
        {expiryText && <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2, fontStyle: "italic" }}>{expiryText}</div>}
      </div>
    );
    const emojiOnly = emojiBigOn && emojiAnimations && !blocked && !m.isScheduled && isEmojiOnly(m.text);
    if (emojiOnly) {
      const emojiText = displayText || m.text;
      return (
        <div>
          <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
          <div className={`nextext-emoji-big ${emojiAnimClass(emojiText)}`} style={{ fontSize: Math.max(44, 62 * chatTextScale), lineHeight: 1.1, whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "none" }}>
            {emojiText}
          </div>
        </div>
      );
    }
    return (
      <div>
        <StatusReplyBlock statusRef={m.statusRef} mine={m.senderId === myUid} t={t} />
        <div style={{ fontSize: 14.5 * chatTextScale, lineHeight: 1.35, color: blocked ? "#FF3B30" : undefined, fontStyle: blocked ? "italic" : undefined }}>
          {m.isScheduled && m.scheduledFor && m.scheduledFor.toMillis?.() > Date.now() && (
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 3, fontStyle: "italic" }}>
              ⏱ Scheduled for {m.scheduledFor.toDate ? m.scheduledFor.toDate().toLocaleString() : ""}
            </div>
          )}
          {displayText || m.text}
          {m.editedAt && !blocked && <span style={{ fontSize: 10, opacity: 0.55, marginLeft: 4 }}>edited</span>}
          {isLinkPreviewEnabled() && !blocked && <LinkPreviewCard text={m.text} mine={m.senderId === myUid} t={t} textScale={chatTextScale} />}
          {!blocked && translations[m.id] && !hiddenTranslations[m.id] && (
            <div style={{ borderTop: `1px solid ${m.senderId === myUid ? "rgba(255,255,255,0.25)" : t.border}`, marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 14.5 * chatTextScale, lineHeight: 1.35 }}>{translations[m.id].text}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.65, textTransform: "uppercase" }}>Translated · {getLanguageLabel(translations[m.id].lang)}</span>
                <span onClick={(e) => { e.stopPropagation(); setHiddenTranslations((prev) => ({ ...prev, [m.id]: true })); }} style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.8, cursor: "pointer", textDecoration: "underline" }}>Hide</span>
              </div>
            </div>
          )}
          {translationErrors[m.id] && (
            <div style={{ fontSize: 11.5, color: "#FF3B30", marginTop: 3, lineHeight: 1.3, maxWidth: 260 }}>{translationErrors[m.id]}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(14px + var(--safe-top)) 12px 14px", background: "#111B21", position: "relative", flexShrink: 0 }}>
        <ChevronLeft size={22} color="#fff" onClick={handleBack} style={{ cursor: "pointer" }} />
        <div onClick={onOpenProfile} style={{ cursor: "pointer" }}>
          {isGroup && chatMeta?.groupPhotoURL ? (
            <img src={chatMeta.groupPhotoURL} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setFullscreenImage(chatMeta.groupPhotoURL); }} />
          ) : (
            <Avatar
              photoURL={isGroup ? null : (contact?.profile?.photoURL || otherUserPhoto)}
              name={isGroup ? (myGroupNickname || chatMeta?.groupName || "Group") : (getContactDisplayName(contact) || "…")}
              uid={isGroup ? null : otherUid}
              size={38}
              hasActiveStatus={!isGroup && hasOtherActiveStatus}
              statusViewed={otherStatusViewed}
              onViewProfile={onOpenProfile}
              onViewPicture={() => { const effective = getLocalPhotoOverride(otherUid) || contact?.profile?.photoURL || otherUserPhoto; if (effective) setFullscreenImage(effective); }}
            />
          )}
        </div>
          <div onClick={onOpenProfile} style={{ flex: 1, cursor: "pointer" }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 6 }}>
            {isSelfChat ? "Message Yourself" : isGroup ? (myGroupNickname || contact?.groupName || chatMeta?.groupName || "Group") : (getContactDisplayName(contact) || "…")}
            {isLocked && <Lock size={13} color="rgba(255,255,255,0.8)" />}
            {isMuted && <BellOff size={13} color="rgba(255,255,255,0.7)" />}
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, minHeight: 16, display: "flex", alignItems: "center", gap: 5 }}>
            {theyRecordingVoice ? (
              <>
                <Mic size={13} className="nextext-mic-waver" color="#7EE2B8" />
                <span>recording voice note…</span>
              </>
            ) : theyTyping ? "typing…" : isGroup ? (
              `${chatMeta?.participants?.length || "…"} members`
            ) : isSelfChat ? "Your private space" : !presence.visible ? "" : presence.isOnline ? "online" : formatLastSeen(presence.lastSeen)}
          </div>
        </div>
        <Search size={19} color="#fff" style={{ cursor: "pointer", marginRight: 4 }} onClick={() => setShowSearch(!showSearch)} />
        <MoreVertical size={19} color="#fff" style={{ cursor: "pointer" }} onClick={() => setShowOverflow(!showOverflow)} />

        {showOverflow && (
          <>
          <div onClick={() => setShowOverflow(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
          <div style={{ position: "absolute", top: 52, right: 10, background: t.surface, borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", overflow: "hidden", zIndex: 40, minWidth: 190 }}>
            <div onClick={() => { scrollToTop(); setShowOverflow(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
              <ArrowUp size={16} color={t.text} />
              <span style={{ fontSize: 14, color: t.text }}>Go to top</span>
            </div>
            <div onClick={() => { scrollToBottom(); setShowOverflow(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <ArrowDown size={16} color={t.text} />
              <span style={{ fontSize: 14, color: t.text }}>Go to bottom</span>
            </div>
            {isGroup && onOpenGroupInfo && (
              <div onClick={() => { setShowOverflow(false); onOpenGroupInfo({ id: chatId, groupName: chatMeta?.groupName }); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                <Users size={16} color={t.text} />
                <span style={{ fontSize: 14, color: t.text }}>Group Info</span>
              </div>
            )}
            <div onClick={async () => { if (isMuted) await clearMute(chatId, myUid); else await setMute(chatId, myUid, "forever"); setShowOverflow(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              {isMuted ? <Bell size={16} /> : <BellOff size={16} />}
              <span style={{ fontSize: 14, color: t.text }}>{isMuted ? "Unmute" : "Mute"}</span>
            </div>
            <div onClick={async () => { await toggleFavorite(chatId, myUid, isFavorite); setShowOverflow(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Star size={16} fill={isFavorite ? t.accent : "none"} color={isFavorite ? t.accent : t.text} />
              <span style={{ fontSize: 14, color: t.text }}>{isFavorite ? "Remove from Favorites" : "Add to Favorites"}</span>
            </div>
            <div onClick={() => { wallpaperInputRef.current?.click(); setShowOverflow(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <span style={{ fontSize: 14, color: t.text }}>Set chat background…</span>
            </div>
            {wallpaper && (
              <div onClick={() => { clearWallpaper(); setShowOverflow(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                <span style={{ fontSize: 14, color: "#FF3B30" }}>Remove background</span>
              </div>
            )}
            <div onClick={async () => { await toggleLocked(chatId, myUid, !!isLocked); setShowOverflow(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
              <Lock size={16} color={isLocked ? t.accent : t.text} />
              <span style={{ fontSize: 14, color: isLocked ? t.accent : t.text }}>{isLocked ? "Unlock chat" : "Lock chat"}</span>
            </div>
            <div onClick={async () => { await toggleArchive(chatId, myUid, false); setShowOverflow(false); handleBack(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
              <Archive size={16} color={t.text} />
              <span style={{ fontSize: 14, color: t.text }}>Archive chat</span>
            </div>

            <div onClick={async () => { if (window.confirm("Are you sure? This will permanently delete this chat history forever.")) { await deleteChatCompletely(chatId).catch(() => {}); setShowOverflow(false); handleBack(); } }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
              <Trash2 size={16} color="#FF3B30" />
              <span style={{ fontSize: 14, color: "#FF3B30" }}>Delete chat</span>
            </div>
          </div>
          </>
        )}
        <input ref={wallpaperInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleWallpaperUpload} />
      </div>

      {showSearch && (
        <div style={{ padding: "8px 12px", background: t.surface, borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: "flex", alignItems: "center", background: t.bg, borderRadius: 10, padding: "8px 12px", gap: 8 }}>
            <Search size={14} color={t.textMuted} />
            <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search in this chat…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13.5, color: t.text }} />
            {searchQuery && <X size={14} color={t.textMuted} onClick={() => setSearchQuery("")} style={{ cursor: "pointer" }} />}
          </div>
          {searchQuery && <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6 }}>{visibleMessages.length} match{visibleMessages.length !== 1 ? "es" : ""}</div>}
        </div>
      )}

      {chatSetupError && <div style={{ padding: "8px 16px", background: "#FFE5E5", color: "#B00020", fontSize: 12.5 }}>{chatSetupError}</div>}
      {sendError && <div style={{ padding: "8px 16px", background: "#FFE5E5", color: "#B00020", fontSize: 12.5 }}>{sendError}</div>}

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
        <div ref={scrollRef} onScroll={handleScroll} onTouchStart={onMessagesTouchStart} onTouchMove={onMessagesTouchMove} onTouchEnd={onMessagesTouchEnd} style={{
          flex: 1, overflowY: "auto", overflowX: "hidden", padding: "14px 10px", display: "flex", flexDirection: "column",
          touchAction: pinchEnabled() ? "pan-y" : "auto",
          backgroundImage: wallpaper ? `url(${wallpaper})` : "none", backgroundSize: "cover", backgroundPosition: "center",
        }}>
          {visibleMessages.map((m, i) => {
            const prev = visibleMessages[i - 1];
            const next = visibleMessages[i + 1];
            const groupedWithPrev = prev && prev.senderId === m.senderId && !prev.deletedForEveryone;
            const groupedWithNext = next && next.senderId === m.senderId && !next.deletedForEveryone;
            const isMine = m.senderId === myUid;
            const mDate = msgDisplayDate(m);
            const prevDate = msgDisplayDate(prev);
            const newDay = mDate && (!prevDate || prevDate.toDateString() !== mDate.toDateString());
            return (
            <React.Fragment key={m.id}>
              {newDay && (
                <div style={{ display: "flex", justifyContent: "center", margin: "16px 0 4px", flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: "4px 12px", boxShadow: "0 1px 2px rgba(0,0,0,0.08)", textTransform: "capitalize" }}>{formatDayLabel(mDate)}</span>
                </div>
              )}
              <div className="nextext-message-in" style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start", marginTop: groupedWithPrev ? 2 : 12 }}>
                <div onClick={() => !m.deletedForEveryone && setActiveMsg(m)} style={{
                  position: "relative", maxWidth: (messageWidth === "compact" ? "58%" : messageWidth === "standard" ? "74%" : "90%"), padding: "8px 12px", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                  background: isMine ? t.bubbleMe : t.bubbleThem, color: isMine ? t.bubbleMeText : t.bubbleThemText,
                  borderRadius: `${groupedWithPrev ? 6 : 14}px ${groupedWithPrev ? 6 : 14}px ${groupedWithNext ? 6 : 14}px ${groupedWithNext ? 6 : 14}px`,
                }}>
                  {isGroup && !isMine && !groupedWithPrev && (
                    <div onClick={(e) => { e.stopPropagation(); const memberInfo = { uid: m.senderId, name: m.senderName || memberNames[m.senderId] || "…" }; setContactCardMember(memberInfo); }} style={{ fontSize: 12, fontWeight: 700, color: t.primary, marginBottom: 2, cursor: "pointer" }}>{m.senderName || memberNames[m.senderId] || "…"}</div>
                  )}
                  {(m.forwardedFrom || m.forwardedCount > 0) && (
                    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.55, marginBottom: 2 }}>
                      {m.forwardedFrom
                        ? (m.forwardedCount > 0 && !globalSettings?.hideForwardedCount ? `Forwarded · ${m.forwardedCount}×` : "Forwarded")
                        : (m.forwardedCount > 0 && !globalSettings?.hideForwardedCount ? `Forwarded ${m.forwardedCount} time${m.forwardedCount === 1 ? "" : "s"}` : "Forwarded")}
                    </div>
                  )}
                  {m.replyTo && (
                  <div style={{ background: m.senderId === myUid ? "rgba(255,255,255,0.15)" : t.primaryLight, borderLeft: `3px solid ${m.senderId === myUid ? "rgba(255,255,255,0.6)" : t.primary}`, borderRadius: 6, padding: "5px 8px", marginBottom: 6, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, opacity: 0.85, fontSize: 11, marginBottom: 1 }}>
                      {replyToSenderName(m.replyTo.senderId)}
                    </div>
                    <div style={{ opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.replyTo.previewText}</div>
                  </div>
                )}
                {renderBubble(m)}
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 7, marginTop: 3 }}>
                  {canForward(m) && (
                    <Forward size={13} onClick={(e) => { e.stopPropagation(); setForwardMsg(m); }} style={{ cursor: "pointer", opacity: 0.6 }} />
                  )}
                  <span style={{ fontSize: 10.5, opacity: 0.65 }}>
                    {msgDisplayDate(m) ? msgDisplayDate(m).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "sending…"}
                  </span>
                  <StatusTicks mine={m.senderId === myUid} deliveredTo={m.deliveredTo} readBy={m.readBy} otherParticipants={otherParticipants} />
                </div>
                {m.reactions && Object.keys(m.reactions).length > 0 && (
                  <div style={{ display: "flex", gap: 3, marginTop: 3, justifyContent: isMine ? "flex-end" : "flex-start" }}>
                    <div style={{ display: "flex", gap: 3, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "2px 5px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                      {Object.values(m.reactions).map((e, i) => <span key={i} style={{ fontSize: 12 }}>{e}</span>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
            </React.Fragment>
            );
          })}
          {(theyRecordingVoice || theyTyping) && (
            <div className="nextext-message-in" style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "10px 14px", borderRadius: 14, background: t.bubbleThem, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 7 }}>
                {theyRecordingVoice ? (
                  <>
                    <Mic size={14} className="nextext-mic-waver" color="#2BB579" />
                    <span style={{ fontSize: 12.5, color: t.textMuted }}>recording voice note…</span>
                  </>
                ) : (
                  <TypingDots color={t.textMuted} />
                )}
              </div>
            </div>
          )}
        </div>

        {showScrollDownSetting && showScrollDown && (
          <button onClick={scrollToBottom} style={{ position: "absolute", bottom: 12, left: scrollDownPos === "left" ? 12 : scrollDownPos === "right" ? undefined : "50%", right: scrollDownPos === "right" ? 12 : undefined, transform: scrollDownPos === "center" ? "translateX(-50%)" : "none", display: "flex", alignItems: "center", justifyContent: "center", padding: newMsgBadge > 0 ? "8px 16px" : "0", height: newMsgBadge > 0 ? "auto" : Math.max(36, Math.round(scrollDownSize + 14)), borderRadius: newMsgBadge > 0 ? 18 : "50%", border: `1px solid ${t.border}`, background: newMsgBadge > 0 ? t.primary : t.surface, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.18)", transition: "all 0.2s", minWidth: Math.max(36, Math.round(scrollDownSize + 14)) }}>
            {newMsgBadge > 0 ? (
              <>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>{newMsgBadge} new message{newMsgBadge > 1 ? "s" : ""} 👇</span>
              </>
            ) : (
              <ArrowDown size={scrollDownSize} color={t.primary} strokeWidth={2.4} />
            )}
          </button>
        )}
      </div>

      {replyingTo && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: t.surface, borderTop: `1px solid ${t.border}` }}>
          <CornerUpLeft size={16} color={t.primary} />
          <div style={{ flex: 1, fontSize: 12, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{replyingTo.previewText}</div>
          <X size={16} color={t.textMuted} onClick={() => setReplyingTo(null)} style={{ cursor: "pointer" }} />
        </div>
      )}
      {editingMsg && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: t.primaryLight, borderTop: `1px solid ${t.border}` }}>
          <span style={{ fontSize: 12, color: t.primary, fontWeight: 600, flex: 1 }}>Editing message</span>
          <X size={16} color={t.textMuted} onClick={() => { setEditingMsg(null); setInput(""); }} style={{ cursor: "pointer" }} />
        </div>
      )}

      <div ref={composerBarRef} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 8px", paddingBottom: "calc(10px + var(--safe-bottom))", background: t.bg, position: "relative", flexShrink: 0, minWidth: 0 }}>
        {isBlockedByMe ? (
          <div style={{ flex: 1, textAlign: "center", padding: "12px", color: t.textMuted, fontSize: 13 }}>
            You've blocked this contact — unblock from their profile to send messages.
          </div>
        ) : recording ? (
          <>
            {recordingHold && !recordingSlideCancel && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: Math.max(6, Math.round(10 * rs)), background: t.surface, borderRadius: 24, padding: `${Math.max(8, Math.round(10 * rs))}px ${Math.max(12, Math.round(16 * rs))}px` }}>
                <div style={{ width: Math.max(8, Math.round(10 * rs)), height: Math.max(8, Math.round(10 * rs)), borderRadius: "50%", background: "#FF3B30", flexShrink: 0, animation: "nextext-rec-pulse 1s ease-in-out infinite" }} />
                <span style={{ fontSize: Math.max(12, Math.round(14 * rs)), fontWeight: 600, color: t.text }}>{Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}</span>
                <LiveWave level={recLevel} active color={t.accent} height={Math.max(16, Math.round(20 * rs))} count={22} />
                <span style={{ marginLeft: "auto", fontSize: Math.max(11, Math.round(12 * rs)), color: t.textMuted, flexShrink: 0 }}>‹ Slide to cancel</span>
              </div>
            )}
            {recordingHold && recordingSlideCancel && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: Math.max(6, Math.round(10 * rs)), background: "#FF3B30", borderRadius: 24, padding: `${Math.max(8, Math.round(10 * rs))}px ${Math.max(12, Math.round(16 * rs))}px` }}>
                <X size={Math.max(14, Math.round(16 * rs))} color="#fff" />
                <span style={{ fontSize: Math.max(12, Math.round(14 * rs)), fontWeight: 700, color: "#fff" }}>Release to cancel</span>
              </div>
            )}
            {recordingHold && (
              <button
                onPointerDown={micPointerDown}
                onPointerMove={micPointerMove}
                onPointerUp={micPointerUp}
                onPointerCancel={() => cancelVoiceRecording()}
                onContextMenu={(e) => e.preventDefault()}
                style={{ width: Math.max(36, Math.round(42 * composerHeight)), height: Math.max(36, Math.round(42 * composerHeight)), borderRadius: "50%", background: "#FF3B30", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, touchAction: "none", animation: "nextext-rec-pulse 1s ease-in-out infinite" }}>
                <Mic size={Math.max(16, Math.round(18 * composerHeight))} color="#fff" />
              </button>
            )}
            {recordingTapMode && (
              <>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: Math.max(6, Math.round(8 * rs)), background: t.surface, borderRadius: 24, padding: `${Math.max(5, Math.round(6 * rs))}px ${Math.max(8, Math.round(10 * rs))}px`, minWidth: 0 }}>
                  <div style={{ width: Math.max(8, Math.round(10 * rs)), height: Math.max(8, Math.round(10 * rs)), borderRadius: "50%", background: recordingPaused ? "#F5A623" : "#FF3B30", flexShrink: 0, animation: recordingPaused ? "none" : "nextext-rec-pulse 1s ease-in-out infinite" }} />
                  <span style={{ fontSize: Math.max(12, Math.round(14 * rs)), fontWeight: 600, color: t.text, minWidth: 40, fontVariantNumeric: "tabular-nums" }}>{Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}</span>
                  <LiveWave level={recLevel} active={!recordingPaused} color={recordingPaused ? "#F5A623" : t.accent} height={Math.max(12, Math.round(16 * rs))} count={14} />
                  <div onClick={recordingPaused ? resumeVoiceRecording : pauseVoiceRecording} style={{ width: Math.max(24, Math.round(30 * rs)), height: Math.max(24, Math.round(30 * rs)), borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    {recordingPaused ? <Play size={Math.max(11, Math.round(13 * rs))} color={t.primary} /> : <Pause size={Math.max(11, Math.round(13 * rs))} color={t.primary} />}
                  </div>
                  <div onClick={restartVoiceRecording} title="Restart" style={{ width: Math.max(24, Math.round(30 * rs)), height: Math.max(24, Math.round(30 * rs)), borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    <RotateCcw size={Math.max(11, Math.round(13 * rs))} color={t.primary} />
                  </div>
                  <div onClick={() => stopVoiceRecordingToPreview()} title="Stop" style={{ width: Math.max(24, Math.round(30 * rs)), height: Math.max(24, Math.round(30 * rs)), borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    <Square size={Math.max(11, Math.round(13 * rs))} color={t.primary} />
                  </div>
                  <span onClick={() => cancelVoiceRecording()} style={{ marginLeft: "auto", color: t.textMuted, fontSize: Math.max(11, Math.round(12.5 * rs)), cursor: "pointer", flexShrink: 0 }}>Cancel</span>
                </div>
                <button onClick={() => stopVoiceRecording(true)} style={{ width: Math.max(34, Math.round(42 * rs)), height: Math.max(34, Math.round(42 * rs)), borderRadius: "50%", background: t.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                  <Send size={Math.max(14, Math.round(17 * rs))} color={t.bubbleMeText} />
                </button>
              </>
            )}
          </>
        ) : uploading ? (
          <div style={{ flex: 1, textAlign: "center", padding: "12px", color: t.textMuted, fontSize: 13 }}>Uploading…</div>
        ) : recordedPreview ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: Math.max(6, Math.round(10 * rs)), background: t.surface, borderRadius: 24, padding: `${Math.max(5, Math.round(6 * rs))}px ${Math.max(10, Math.round(14 * rs))}px`, minWidth: 0 }}>
            <audio ref={previewAudioRef} src={recordedPreview.url} preload="metadata" onEnded={() => setPreviewPlaying(false)} onPause={() => setPreviewPlaying(false)} onPlay={() => setPreviewPlaying(true)} />
            <div onClick={togglePreviewPlayback} title={previewPlaying ? "Pause" : "Listen"} style={{ width: Math.max(32, Math.round(40 * rs)), height: Math.max(32, Math.round(40 * rs)), borderRadius: "50%", background: previewPlaying ? t.primary : t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              {previewPlaying ? <Pause size={Math.max(15, Math.round(18 * rs))} color={t.bubbleMeText} /> : <Headphones size={Math.max(15, Math.round(18 * rs))} color={t.primary} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: Math.max(11, Math.round(13 * rs)), fontWeight: 700, color: t.text }}>Recording preview</span>
              <span style={{ fontSize: Math.max(10.5, Math.round(12 * rs)), color: t.textMuted }}>{Math.floor(recordedPreview.duration / 60)}:{String(recordedPreview.duration % 60).padStart(2, "0")} — tap the button to listen</span>
            </div>
            <span onClick={() => discardRecordedPreview()} style={{ color: t.textMuted, fontSize: Math.max(11, Math.round(12.5 * rs)), cursor: "pointer", flexShrink: 0, textDecoration: "underline" }}>Discard</span>
            <button onClick={sendRecordedPreview} style={{ width: Math.max(34, Math.round(42 * rs)), height: Math.max(34, Math.round(42 * rs)), borderRadius: "50%", background: t.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              <Send size={Math.max(14, Math.round(17 * rs))} color={t.bubbleMeText} />
            </button>
          </div>
        ) : (
          <>
            {showEmojiPicker && (
              <>
                <div onClick={() => setShowEmojiPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 29 }} />
                <div style={{ position: "absolute", bottom: 64, left: 10, right: 10, background: t.surface, borderRadius: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", padding: "10px 12px", zIndex: 30, maxHeight: 200, overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>Emoji</span>
                    <X size={17} color={t.textMuted} onClick={() => setShowEmojiPicker(false)} style={{ cursor: "pointer" }} />
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {EMOJI_PICKER_SET.map((emoji) => (
                      <span key={emoji} onClick={(e) => { e.stopPropagation(); setInput((prev) => prev + emoji); autoResizeComposer(); }} style={{ fontSize: 22, cursor: "pointer", padding: "4px 5px", borderRadius: 6, textAlign: "center" }}>{emoji}</span>
                    ))}
                  </div>
                </div>
              </>
            )}
            {attachRendered && createPortal(
              <>
              <div onClick={closeAttach} style={{ position: "fixed", inset: 0, zIndex: 2147481000, opacity: attachClosing ? 0 : 1, transition: "opacity 0.15s ease" }} />
              <div style={{ position: "fixed", left: 10, bottom: composerBarRef.current ? (window.innerHeight - composerBarRef.current.getBoundingClientRect().top) + 6 + navInset : 96, background: t.surface, borderRadius: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", overflow: "hidden", zIndex: 2147481001, minWidth: 190, opacity: attachClosing ? 0 : 1, transform: attachClosing ? "translateY(8px) scale(0.97)" : "translateY(0) scale(1)", transition: "opacity 0.15s ease, transform 0.18s ease", transformOrigin: "bottom left" }}>
                <div onClick={() => { closeAttach(); setShowPoll(true); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer" }}>
                  <BarChart2 size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Poll</span>
                </div>
                {!(parentalBlockedType("image") && parentalBlockedType("video")) && (
                  <div onClick={() => { closeAttach(); photoInputRef.current?.click(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                    <ImageIcon size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Photo or video</span>
                  </div>
                )}
                <div onClick={() => { closeAttach(); fileInputRef.current?.click(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <Paperclip size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>File (max 50MB)</span>
                </div>
                <div onClick={openLocationSheet} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <MapPin size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Share location</span>
                </div>
                <div onClick={() => { closeAttach(); setShowContactShare(true); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <UserPlus size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Contact</span>
                </div>
                {!parentalBlockedType("image") && (
                  <div onClick={() => { closeAttach(); openCamera(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                    <Camera size={17} color={t.primary} /><span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Camera</span>
                  </div>
                )}
              </div>
              </>,
              document.body
            )}
            {showLocationSheet && createPortal(
              <>
              <style>{`@keyframes nextext-spin { to { transform: rotate(360deg); } }`}</style>
              <div onClick={() => setShowLocationSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 2147481200, background: "rgba(0,0,0,0.45)" }} />
              <div style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(330px, 90vw)", background: t.surface, borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 2147481201, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: t.text }}>Share location</div>
                  <button onClick={() => setShowLocationSheet(false)} style={{ width: 28, height: 28, borderRadius: "50%", background: "transparent", border: "none", color: t.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <X size={18} />
                  </button>
                </div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 12, lineHeight: 1.5 }}>Send a one-time pin of where you are, or share your live location that updates automatically for a set time.</div>
                {locPosition && (
                  <div style={{ height: 140, borderRadius: 10, overflow: "hidden", marginBottom: 12, position: "relative" }}>
                    <iframe title="Your location" src={`https://maps.google.com/maps?q=${locPosition.lat},${locPosition.lng}&z=16&output=embed`} style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }} />
                  </div>
                )}
                {locBusy && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: t.textMuted, marginBottom: 12 }}><span style={{ width: 14, height: 14, border: "2px solid rgba(0,0,0,0.15)", borderTopColor: t.primary, borderRadius: "50%", animation: "nextext-spin 0.8s linear infinite" }} /> Getting your location…</div>}
                {locError && <div style={{ color: "#FF3B30", fontSize: 12.5, marginBottom: 12 }}>{locError}</div>}
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => sendLocation(0)} disabled={!locPosition || locBusy} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: locPosition && !locBusy ? "pointer" : "not-allowed", opacity: locPosition && !locBusy ? 1 : 0.5 }}>
                    Send current location
                  </button>
                  <button onClick={() => setShowLiveDurations((v) => !v)} disabled={!locPosition || locBusy} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${showLiveDurations ? t.primary : t.border}`, background: showLiveDurations ? t.primaryLight : "transparent", color: showLiveDurations ? t.primary : t.text, fontWeight: 700, fontSize: 13, cursor: locPosition && !locBusy ? "pointer" : "not-allowed", opacity: locPosition && !locBusy ? 1 : 0.5 }}>
                    Share live location
                  </button>
                </div>
                {showLiveDurations && (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {[[15, "15 min"], [60, "1 hour"], [480, "8 hours"]].map(([mins, label]) => (
                        <button key={mins} onClick={() => sendLocation(mins)} disabled={!locPosition || locBusy} style={{ flex: 1, minWidth: "30%", padding: "10px 0", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 12.5, cursor: locPosition && !locBusy ? "pointer" : "not-allowed", opacity: locPosition && !locBusy ? 1 : 0.5 }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                      <input
                        type="number"
                        min="1"
                        max="1440"
                        value={liveCustomMinutes}
                        onChange={(e) => setLiveCustomMinutes(e.target.value)}
                        placeholder="Custom minutes"
                        style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, minWidth: 0 }}
                      />
                      <button
                        onClick={() => {
                          const mins = Math.min(1440, Math.max(1, Math.round(Number(liveCustomMinutes)) || 15));
                          sendLocation(mins);
                        }}
                        disabled={!locPosition || locBusy || !liveCustomMinutes.trim()}
                        style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: locPosition && !locBusy && liveCustomMinutes.trim() ? "pointer" : "not-allowed", opacity: locPosition && !locBusy && liveCustomMinutes.trim() ? 1 : 0.5 }}
                      >
                        Start
                      </button>
                    </div>
                  </>
                )}
              </div>
              </>,
              document.body
            )}
            <input ref={photoInputRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={handlePhotoOrVideoPick} onCancel={() => setGalleryActive(false)} />
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFilePick} />
            <div style={{ flex: 1, display: "flex", alignItems: "center", background: t.surface, borderRadius: 24, padding: `${Math.round(8 * composerHeight)}px 6px ${Math.round(8 * composerHeight)}px 10px`, gap: 2, minWidth: 0 }}>
              <div
                onClick={() => { if (showEmojiPicker) setShowEmojiPicker(false); else { closeAttach(); setShowEmojiPicker(true); } }}
                style={{ width: Math.max(30, Math.round(32 * composerHeight)), height: Math.max(30, Math.round(32 * composerHeight)), borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, background: showEmojiPicker ? t.primaryLight : "transparent" }}
              >
                <Smile size={Math.max(22, Math.round(25 * composerHeight))} color={showEmojiPicker ? t.primary : t.textMuted} />
              </div>
              {!(parentalBlockedType("image") && parentalBlockedType("video")) && (
                <div
                  onClick={() => { setGalleryActive(true); setShowEmojiPicker(false); photoInputRef.current?.click(); }}
                  style={{ width: Math.max(30, Math.round(32 * composerHeight)), height: Math.max(30, Math.round(32 * composerHeight)), borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, background: galleryActive ? t.primaryLight : "transparent" }}
                >
                  <ImageIcon size={Math.max(22, Math.round(25 * composerHeight))} color={galleryActive ? t.primary : t.textMuted} />
                </div>
              )}
              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (editingMsg) saveEdit(); else send(); } }}
                placeholder={editingMsg ? "Edit message…" : "Message"}
                rows={1}
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: Math.max(14, Math.round(16.5 * composerHeight * 10) / 10), color: t.text, resize: "none", maxHeight: Math.round((42 + composerHeight * 42) * composerHeight), lineHeight: 1.4, paddingTop: Math.round(7 * composerHeight), paddingBottom: Math.round(7 * composerHeight), fontFamily: "inherit", minWidth: 0 }}
              />
              <div
                onClick={() => { if (showAttach) closeAttach(); else { setShowEmojiPicker(false); openAttach(); } }}
                style={{ width: Math.max(30, Math.round(32 * composerHeight)), height: Math.max(30, Math.round(32 * composerHeight)), borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, background: showAttach ? t.primaryLight : "transparent", transform: `rotate(${showAttach ? 45 : 0}deg)`, transition: "transform 0.2s ease" }}
              >
                <Plus size={Math.max(22, Math.round(25 * composerHeight))} color={showAttach ? t.primary : t.textMuted} />
              </div>
            </div>
            {input.trim() || editingMsg ? (
              <button
                onClick={editingMsg ? saveEdit : send}
                onMouseDown={() => { if (!editingMsg && input.trim()) longPressTimer.current = setTimeout(() => setShowSchedule(true), 500); }}
                onMouseUp={() => clearTimeout(longPressTimer.current)}
                onMouseLeave={() => clearTimeout(longPressTimer.current)}
                onTouchStart={() => { if (!editingMsg && input.trim()) longPressTimer.current = setTimeout(() => setShowSchedule(true), 500); }}
                onTouchEnd={() => clearTimeout(longPressTimer.current)}
                style={{ width: Math.round(42 * composerHeight), height: Math.round(42 * composerHeight), borderRadius: "50%", background: t.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <Send size={Math.max(16, Math.round(17 * composerHeight))} color={t.bubbleMeText} />
              </button>
            ) : parentalBlockedType("voice") ? (
              <div
                title="Voice notes are blocked by parental controls"
                style={{ width: Math.max(36, Math.round(42 * composerHeight)), height: Math.max(36, Math.round(42 * composerHeight)), borderRadius: "50%", background: t.border, border: "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "not-allowed", opacity: 0.55, touchAction: "none" }}>
                <Mic size={Math.max(16, Math.round(18 * composerHeight))} color={t.textMuted} />
              </div>
            ) : (
              <button
                onPointerDown={micPointerDown}
                onPointerMove={micPointerMove}
                onPointerUp={micPointerUp}
                onPointerCancel={() => cancelVoiceRecording()}
                onContextMenu={(e) => e.preventDefault()}
                title="Hold to record, release to send. Tap to record with controls."
                style={{ width: Math.max(36, Math.round(42 * composerHeight)), height: Math.max(36, Math.round(42 * composerHeight)), borderRadius: "50%", background: t.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, touchAction: "none", WebkitTapHighlightColor: "transparent" }}>
                <Mic size={Math.max(16, Math.round(18 * composerHeight))} color={t.bubbleMeText} />
              </button>
            )}
          </>
        )}
      </div>

      {activeMsg && (() => {
        const sentMs = activeMsg.sentAt?.toMillis?.() || Date.now();
        const ageMs = Date.now() - sentMs;
        const canEdit = ageMs < 15 * 60 * 1000;
        const canDeleteEveryone = ageMs < 60 * 60 * 60 * 1000;
        return (
          <div className="nextext-overlay-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 55, display: "flex", alignItems: "flex-end" }} onClick={() => { setActiveMsg(null); setShowCustomEmoji(false); setCustomEmoji(""); }}>
            <div className="nextext-overlay-sheet" style={{ background: t.surface, width: "100%", borderRadius: "18px 18px 0 0", padding: "16px 20px 24px" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Message actions</span>
                <X size={20} color={t.textMuted} onClick={() => { setActiveMsg(null); setShowCustomEmoji(false); setCustomEmoji(""); }} style={{ cursor: "pointer" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", marginBottom: 16 }}>
                {QUICK_REACTIONS.map((e) => <span key={e} onClick={() => handleReact(e)} style={{ fontSize: 26, cursor: "pointer" }}>{e}</span>)}
                <div onClick={() => setShowCustomEmoji(!showCustomEmoji)} style={{ width: 30, height: 30, borderRadius: "50%", border: `1.5px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <span style={{ fontSize: 15, color: t.textMuted }}>+</span>
                </div>
              </div>
              {showCustomEmoji && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${t.border}` }}>
                  <input
                    autoFocus value={customEmoji} onChange={(e) => setCustomEmoji(e.target.value)}
                    placeholder="Type or paste any emoji…"
                    onKeyDown={(e) => { if (e.key === "Enter" && customEmoji.trim()) { handleReact(customEmoji.trim()); setCustomEmoji(""); setShowCustomEmoji(false); } }}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 16 }}
                  />
                  <button
                    disabled={!customEmoji.trim()}
                    onClick={() => { handleReact(customEmoji.trim()); setCustomEmoji(""); setShowCustomEmoji(false); }}
                    style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: customEmoji.trim() ? t.primary : t.border, color: customEmoji.trim() ? t.bubbleMeText : t.textMuted, fontWeight: 700, cursor: customEmoji.trim() ? "pointer" : "not-allowed" }}
                  >
                    Add
                  </button>
                </div>
              )}
              <div onClick={handleReply} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                <CornerUpLeft size={17} color={t.text} /><span style={{ fontSize: 15, color: t.text }}>Reply</span>
              </div>
              {activeMsg.text && (
                <div onClick={handleCopyText} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 15, color: t.text }}>Copy text</span>
                </div>
              )}
              {canForward(activeMsg) && (
                <div onClick={handleForward} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <Forward size={17} color={t.text} /><span style={{ fontSize: 15, color: t.text }}>Forward</span>
                </div>
              )}
              {activeMsg.text && sysConfig?.translateDisabled !== true && (
                <div onClick={() => { setTranslateMsg(activeMsg); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <Languages size={17} color={t.text} /><span style={{ fontSize: 15, color: t.text }}>Translate</span>
                </div>
              )}
              {activeMsg.senderId === myUid && activeMsg.type === "text" && canEdit && (
                <div onClick={handleEdit} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 15, color: t.text }}>Edit <span style={{ fontSize: 11.5, color: t.textMuted }}>(within 15 min)</span></span>
                </div>
              )}
              <div onClick={handleDeleteSelf} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                <span style={{ fontSize: 15, color: "#FF3B30" }}>Delete for me</span>
              </div>
              {activeMsg.senderId === myUid && canDeleteEveryone && (
                <div onClick={handleDeleteEveryone} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 15, color: "#FF3B30" }}>Delete for everyone <span style={{ fontSize: 11.5, color: t.textMuted }}>(within 60 hrs)</span></span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {translateMsg && (
        <div className="nextext-overlay-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 56, display: "flex", alignItems: "flex-end" }} onClick={() => { if (!translatingLang) { setTranslateMsg(null); setActiveMsg(null); } }}>
          <div className="nextext-overlay-sheet" style={{ background: t.surface, width: "100%", borderRadius: "18px 18px 0 0", padding: "16px 20px 24px", maxHeight: "72%", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Translate to…</span>
              <X size={20} color={t.textMuted} onClick={() => { if (!translatingLang) { setTranslateMsg(null); setActiveMsg(null); } }} style={{ cursor: "pointer" }} />
            </div>
            {translatingLang && (
              <div style={{ fontSize: 13, color: t.primary, fontWeight: 600, padding: "10px 0", flexShrink: 0 }}>Translating…</div>
            )}
            <div style={{ overflowY: "auto", flex: 1, minHeight: 0, maxHeight: "calc(72vh - 120px)" }}>
              {LANGUAGES.map((l) => (
                <div key={l.code} onClick={() => { if (!translatingLang) handleTranslateSelect(l.code); }} style={{ padding: "11px 4px", cursor: "pointer", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10, opacity: translatingLang ? 0.5 : 1 }}>
                  <Languages size={15} color={t.textMuted} />
                  <span style={{ fontSize: 14.5, color: t.text, fontWeight: translatingLang === l.code ? 700 : 500 }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {showPoll && <PollCreateSheet t={t} onClose={() => setShowPoll(false)} onCreate={createPoll} />}
      {showContactShare && (
        <ContactSharePicker
          t={t}
          myUid={myUid}
          contacts={convoContacts}
          mode="pick-contact"
          onClose={() => setShowContactShare(false)}
          onShare={(c) => { shareContactIntoChat(c); }}
        />
      )}
      {forwardMsg && (
        <ForwardPicker
          t={t}
          myUid={myUid}
          contacts={convoContacts}
          myProfile={userDoc}
          onClose={() => { if (!forwardBusy) setForwardMsg(null); }}
          onForward={handleForwardTo}
        />
      )}
      {showSchedule && <ScheduleSendSheet t={t} onClose={() => setShowSchedule(false)} onSchedule={sendScheduled} />}

      {contactCardMember && (
        <div onClick={() => setContactCardMember(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: 18, width: "100%", maxWidth: 280, overflow: "hidden" }}>
            <div style={{ padding: "24px 20px", textAlign: "center", background: t.primaryLight }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                <span style={{ color: "#fff", fontWeight: 800, fontSize: 24 }}>{(contactCardMember.name || "?")[0]}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: t.text }}>{contactCardMember.name}</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Group member</div>
            </div>
            <div style={{ padding: "14px 20px 16px" }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div onClick={async () => {
                  setContactCardMember(null);
                  try {
                    await getOrCreateDirectChat(myUid, contactCardMember.uid);
                    onBack();
                    setTimeout(() => { onBack(); }, 10);
                  } catch { /* silent */ }
                }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                  <MessageSquare size={18} color={t.primary} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: t.primary }}>Start Chat</span>
                </div>
                <div onClick={() => {
                  setContactCardMember(null);
                  import("../firebase/contacts").then(({ sendContactRequest }) => {
                    sendContactRequest(myUid, contactCardMember.uid).catch(() => {});
                  });
                }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 10, background: t.primaryLight, cursor: "pointer" }}>
                  <UserPlus size={18} color={t.primary} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: t.primary }}>Add Contact</span>
                </div>
              </div>
            </div>
            <div onClick={() => setContactCardMember(null)} style={{ padding: "14px", textAlign: "center", borderTop: `1px solid ${t.border}`, cursor: "pointer", fontWeight: 700, fontSize: 14, color: t.textMuted }}>
              Close
            </div>
          </div>
        </div>
      )}

      {showCamera && createPortal(
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#000", zIndex: 2147482000, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", minHeight: 48 }}>
            <span onClick={closeCamera} style={{ color: "#fff", fontSize: 15, cursor: "pointer" }}>Cancel</span>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Camera</span>
            <div onClick={flipChatCamera} style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <RefreshCw size={20} color="#fff" />
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
            <video ref={cameraVideoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          {cameraError && <div style={{ color: "#FF3B30", fontSize: 13, textAlign: "center", padding: 8 }}>{cameraError}</div>}
          {capturedPhotos.length > 0 && (
            <div style={{ display: "flex", gap: 8, padding: "8px 16px", overflowX: "auto", flexShrink: 0 }}>
              {capturedPhotos.map((p, i) => (
                <div key={i} onClick={async () => {
                  if (p.sending) return;
                  setCapturedPhotos((prev) => prev.map((x, j) => j === i ? { ...x, sending: true } : x));
                  setUploading(true);
                  try {
                    const result = await uploadChatFile(chatId, myUid, p.file, { compress: true });
                    await sendMediaMessage(chatId, myUid, "image", result, otherParticipants);
                    setCapturedPhotos((prev) => prev.filter((_, j) => j !== i));
                  } catch (err) {
                    setSendError("Couldn't send photo: " + err.message);
                    setCapturedPhotos((prev) => prev.map((x, j) => j === i ? { ...x, sending: false } : x));
                  }
                  setUploading(false);
                }} style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 8, overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", cursor: p.sending ? "wait" : "pointer", position: "relative" }}>
                  <img src={p.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  {p.sending && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff" }}>Sending…</div>}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `10px 16px ${20 + navInset}px`, flexShrink: 0, gap: 16 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, overflowX: "auto", paddingBottom: 8, maxWidth: "60%" }}>
              {acceptedContacts.slice(0, 8).map((c) => (
                <div key={c.uid} onClick={async () => {
                  if (capturedPhotos.length === 0) return;
                  const last = capturedPhotos[capturedPhotos.length - 1];
                  setCapturedPhotos((prev) => prev.map((x, j) => j === prev.length - 1 ? { ...x, sending: true } : x));
                  setUploading(true);
                  try {
                    const result = await uploadChatFile(chatId, myUid, last.file, { compress: true });
                    await sendMediaMessage(chatId, myUid, "image", result, otherParticipants);
                    setCapturedPhotos((prev) => prev.filter((_, j) => j !== prev.length - 1));
                  } catch (err) {
                    setSendError("Couldn't send photo: " + err.message);
                    setCapturedPhotos((prev) => prev.map((x, j) => j === prev.length - 1 ? { ...x, sending: false } : x));
                  }
                  setUploading(false);
                }} style={{ flexShrink: 0, width: 48, height: 48, borderRadius: "50%", overflow: "hidden", border: capturedPhotos.length > 0 ? "2px solid #00A884" : "2px solid rgba(255,255,255,0.3)", cursor: capturedPhotos.length > 0 ? "pointer" : "default", background: t.primaryLight, opacity: capturedPhotos.length > 0 ? 1 : 0.5 }}>
                  <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={40} />
                </div>
              ))}
            </div>
            <div onClick={capturePhoto} style={{ width: 64, height: 64, borderRadius: "50%", border: "4px solid #fff", background: "rgba(255,255,255,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#fff" }} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {fullscreenImage && createPortal(
        <div className="nextext-overlay-backdrop" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.95)", zIndex: 999999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }} onClick={() => setFullscreenImage(null)}>
          <div style={{ position: "absolute", top: 14, right: 14, display: "flex", gap: 14, zIndex: 61 }}>
            <div onClick={async (e) => { e.stopPropagation(); try { const res = await fetch(fullscreenImage); const blob = await res.blob(); const blobUrl = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = blobUrl; a.download = `nextext-image-${Date.now()}.jpg`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(blobUrl); } catch { window.open(fullscreenImage, "_blank"); } }} style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </div>
            <div onClick={(e) => { e.stopPropagation(); setFullscreenImage(null); }} style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={18} color="#fff" />
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 16px 30px", boxSizing: "border-box" }}>
            <img src={fullscreenImage} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", borderRadius: 8 }} />
          </div>
        </div>,
        document.body
      )}

      {pendingMedia && createPortal(
        <div className="nextext-overlay-backdrop" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.92)", zIndex: 999999, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(12px + var(--safe-top)) 14px 8px", flexShrink: 0 }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Send {pendingMedia.isImage ? "photo" : "video"}</div>
            <div onClick={() => !captionBusy && cancelPendingMedia()} style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={18} color="#fff" />
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 12px", overflow: "hidden" }}>
            {pendingMedia.isImage ? (
              <img src={pendingMedia.previewUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 10 }} />
            ) : (
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
                <video src={pendingMedia.previewUrl} controls playsInline style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, padding: "10px 12px calc(16px + var(--safe-bottom))" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, background: t.surface, borderRadius: 24, padding: "6px 6px 6px 16px", border: `1px solid ${t.border}` }}>
              <textarea
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                placeholder="Add a caption…"
                rows={1}
                style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: t.text, fontSize: 15, lineHeight: 1.4, maxHeight: 90, padding: "8px 0" }}
                autoFocus
              />
              <button
                onClick={sendPendingMedia}
                disabled={captionBusy}
                style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: captionBusy ? t.border : t.primary, color: "#fff", cursor: captionBusy ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <Send size={18} color="#fff" />
              </button>
            </div>
            {sendError && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 6, textAlign: "center" }}>{sendError}</div>}
          </div>
        </div>,
        document.body
      )}

      {reactionFx && createPortal(
        <div style={{ position: "fixed", left: 0, right: 0, bottom: "35%", zIndex: 2147481500, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
          <div key={reactionFx.nonce} className="nextext-react-burst">
            <div className="nextext-react-ring" />
            <div className="nextext-react-emoji">{reactionFx.emoji}</div>
          </div>
        </div>,
        document.body
      )}
     </div>
  );
}
