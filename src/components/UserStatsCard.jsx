import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Users } from "lucide-react";
import { BarChart2, RefreshCw, Share, MessagesSquare, Image, Film, Mic, MapPin, Paperclip, Contact, Clock, Timer, ArrowDownUp } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { useGlobalSettings } from "../firebase/config-settings";
import { getUserMessageStats, formatMembershipDuration, formatActiveTime, formatDuration, formatBytes } from "../firebase/stats";

const ROWS = [
  { key: "text", label: "Text messages", icon: MessagesSquare },
  { key: "image", label: "Photos", icon: Image },
  { key: "video", label: "Videos", icon: Film },
  { key: "voice", label: "Voice notes", icon: Mic },
  { key: "location", label: "Locations", icon: MapPin },
  { key: "file", label: "Files", icon: Paperclip },
  { key: "contact", label: "Contact cards", icon: Contact },
];

// Personal message statistics: total + per-type sent/received counts across
// every chat the user is in, membership age + total active time, plus media
// volumes (video/voice playtime and total media size, each split sent/recv).
// Hidden for everyone when the admin enables the `hideUserStats` setting.
export default function UserStatsCard({ myUid, createdAt, activeTimeMs = 0, contacts = [] }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copiedShare, setCopiedShare] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState("");
  const [shareMode, setShareMode] = useState("sheet"); // "sheet" | "contacts"

  const load = () => {
    setLoading(true);
    setError(false);
    setStats(null);
    getUserMessageStats(myUid)
      .then((s) => { setStats(s); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  useEffect(() => { if (myUid) { setLoading(true); setError(false); setStats(null); getUserMessageStats(myUid).then((s) => { setStats(s); setLoading(false); }).catch(() => { setError(true); setLoading(false); }); } }, [myUid]);

  // Live ticking "Time spent in app" counter — declared as hooks BEFORE any
  // early return so the hook call order stays stable across renders.
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLiveTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (globalSettings?.hideUserStats) return null;

  const duration = formatMembershipDuration(createdAt);
  const liveActiveMs = activeTimeMs + (liveTick * 1000);
  const active = formatActiveTime(error ? 0 : liveActiveMs, true);
  const num = (v) => loading ? "…" : error ? "—" : (v ?? 0);

  // Copy helper that works even where navigator.clipboard is unavailable
  // (non-secure WebView contexts): falls back to a hidden textarea + the
  // legacy document.execCommand("copy") path.
  const copyText = async (text) => {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
    } catch { /* fall through */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    document.execCommand("copy");
    document.body.removeChild(ta);
  };

  const buildShareText = () => {
    const lines = ["📊 My NexText statistics"];
    lines.push(`Member for ${duration}`);
    lines.push(`Active time: ${active}`);
    // Per-type message counts are a nice-to-have; if they failed to load we
    // still share the always-available membership + active-time figures.
    if (stats && !error) {
      lines.push(`${stats.total} total messages (${stats.sent} sent / ${stats.received} received)`);
      lines.push(`${stats.chats} chats`);
      ROWS.forEach(({ key, label }) => {
        lines.push(`${label}: ↑${stats.perType?.[key]?.sent ?? 0} ↓${stats.perType?.[key]?.recv ?? 0}`);
      });
    }
    return lines.join("\n");
  };

  const shareStats = () => {
    // Always open the in-app share sheet (it has Copy + Send-to-contact and
    // works everywhere, including inside the Capacitor WebView where
    // navigator.share is unreliable). Previously this early-returned when the
    // per-chat message stats failed to load — but those stats are independent
    // of the active-time figure the card already shows, so the button appeared
    // dead. Now it always opens.
    const text = buildShareText();
    setShareText(text);
    setShareOpen(true);
    setShareMode("sheet");
  };

  const shareWithContact = async (contact) => {
    try {
      const text = shareText;
      if (!text) return;
      // Send statistics as a message to the contact's chat
      const { getOrCreateDirectChat, sendTextMessage } = await import("../firebase/chats");
      const chatId = getOrCreateDirectChat(myUid, contact.uid);
      await sendTextMessage(chatId, myUid, text);
      setShareOpen(false);
      setShareMode("sheet");
    } catch (err) {
      console.error("Failed to share stats with contact:", err);
    }
  };

  const copyShareText = async () => {
    try {
      await copyText(shareText);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div style={{ background: t.surface, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <BarChart2 size={18} color={t.primary} />
        <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Your statistics</span>
        {!loading && !error && (
          <button onClick={shareStats} style={{ marginLeft: "auto", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: t.primary, fontWeight: 600, marginRight: 12, background: "none", border: "none", padding: 0 }}>
            <Share size={13} /> {copiedShare ? "Copied!" : "Share"}
          </button>
        )}
        {!loading && !error && (
          <button onClick={load} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: t.primary, fontWeight: 600, background: "none", border: "none", padding: 0 }}>
            <RefreshCw size={13} /> Refresh
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, background: t.primaryLight, borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.primary, lineHeight: 1.1 }}>{num(stats?.total)}</div>
          <div style={{ fontSize: 11.5, color: t.textMuted, fontWeight: 600, marginTop: 3 }}>total messages</div>
        </div>
        <div style={{ flex: 1, background: t.bg, borderRadius: 12, padding: "12px 10px", textAlign: "center", border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.text, lineHeight: 1.1 }}>{num(stats?.chats)}</div>
          <div style={{ fontSize: 11.5, color: t.textMuted, fontWeight: 600, marginTop: 3 }}>chats</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, background: t.bg, borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: t.primary, lineHeight: 1.1 }}>{num(stats?.sent)}</div>
          <div style={{ fontSize: 10.5, color: t.textMuted, fontWeight: 600, marginTop: 2 }}>sent</div>
        </div>
        <div style={{ flex: 1, background: t.bg, borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: t.text, lineHeight: 1.1 }}>{num(stats?.received)}</div>
          <div style={{ fontSize: 10.5, color: t.textMuted, fontWeight: 600, marginTop: 2 }}>received</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}`, marginBottom: 6 }}>
        <Clock size={15} color={t.textMuted} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>Time on NexText</div>
          <div style={{ fontSize: 13, color: t.text, fontWeight: 600, marginTop: 1 }}>{duration}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: `1px solid ${t.border}`, marginBottom: 8 }}>
        <Timer size={15} color={t.textMuted} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>Time spent in app</div>
          <div style={{ fontSize: 13, color: t.text, fontWeight: 600, marginTop: 1 }}>{error ? "—" : active}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <ArrowDownUp size={13} color={t.textMuted} />
        <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 700 }}>Sent vs received</span>
      </div>
      {ROWS.map(({ key, label, icon: Icon }) => {
        const b = stats?.perType?.[key] || { sent: 0, recv: 0 };
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px" }}>
            <Icon size={15} color={t.textMuted} />
            <span style={{ flex: 1, fontSize: 13.5, color: t.text }}>{label}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: t.primary }}>↑{num(b.sent)}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>↓{num(b.recv)}</span>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, marginBottom: 4, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
        <Film size={13} color={t.textMuted} />
        <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 700 }}>Media playtime (sent / received)</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px" }}>
        <span style={{ flex: 1, fontSize: 13.5, color: t.text }}>Videos</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.primary }}>{error ? "—" : formatDuration(stats?.mediaDurationMs?.video?.sent || 0)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>/</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>{error ? "—" : formatDuration(stats?.mediaDurationMs?.video?.recv || 0)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px" }}>
        <span style={{ flex: 1, fontSize: 13.5, color: t.text }}>Voice notes</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.primary }}>{error ? "—" : formatDuration(stats?.mediaDurationMs?.voice?.sent || 0)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>/</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>{error ? "—" : formatDuration(stats?.mediaDurationMs?.voice?.recv || 0)}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, marginBottom: 4, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
        <Image size={13} color={t.textMuted} />
        <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 700 }}>Media data (sent / received)</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px" }}>
        <span style={{ flex: 1, fontSize: 13.5, color: t.text }}>All photos, videos, notes &amp; files</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.primary }}>{error ? "—" : formatBytes(stats?.mediaSizeBytes?.sent || 0)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>/</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted }}>{error ? "—" : formatBytes(stats?.mediaSizeBytes?.recv || 0)}</span>
      </div>

      {error && <div style={{ fontSize: 12.5, color: "#FF3B30", marginTop: 8 }}>Couldn't load stats — check your connection and try Refresh.</div>}

      {shareOpen && createPortal(
        <div onClick={() => { setShareOpen(false); setShareMode("sheet"); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2147482000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 320, background: t.surface, borderRadius: 16, padding: 18, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: t.text }}>Share your statistics</span>
              <X size={20} color={t.textMuted} onClick={() => { setShareOpen(false); setShareMode("sheet"); }} style={{ cursor: "pointer" }} />
            </div>
            {shareMode === "sheet" ? (
              <>
                <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10, padding: 12, fontSize: 12.5, color: t.text, whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto", lineHeight: 1.6, userSelect: "text" }}>
                  {shareText}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => { setShareOpen(false); setShareMode("sheet"); }} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Close</button>
                  <button onClick={copyShareText} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Copy size={14} /> {copiedShare ? "Copied!" : "Copy"}
                  </button>
                  <button onClick={() => setShareMode("contacts")} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: t.primaryLight, color: t.primary, fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Users size={14} /> Send to contact
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8 }}>Select a contact to send stats to:</div>
                <div style={{ maxHeight: 260, overflowY: "auto" }}>
                  {contacts.filter(c => c.status === "accepted").map((c) => (
                    <div key={c.uid} onClick={() => shareWithContact(c)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", background: t.bg, border: `1px solid ${t.border}`, marginBottom: 6 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 14 }}>{c.profile?.displayName?.charAt(0) || "?"}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.profile?.displayName || "Unknown"}</div>
                        <div style={{ fontSize: 12, color: t.textMuted }}>@{c.profile?.username || c.uid.slice(0, 6)}</div>
                      </div>
                    </div>
                  ))}
                  {contacts.filter(c => c.status === "accepted").length === 0 && (
                    <div style={{ textAlign: "center", padding: 20, color: t.textMuted }}>No contacts available</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => setShareMode("sheet")} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Back</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
