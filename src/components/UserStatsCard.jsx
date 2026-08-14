import React, { useEffect, useState } from "react";
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
export default function UserStatsCard({ myUid, createdAt, activeTimeMs = 0 }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copiedShare, setCopiedShare] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    setStats(null);
    getUserMessageStats(myUid)
      .then((s) => { setStats(s); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  useEffect(() => { if (myUid) { setLoading(true); setError(false); setStats(null); getUserMessageStats(myUid).then((s) => { setStats(s); setLoading(false); }).catch(() => { setError(true); setLoading(false); }); } }, [myUid]);

  if (globalSettings?.hideUserStats) return null;

  const duration = formatMembershipDuration(createdAt);
  const active = formatActiveTime(activeTimeMs);
  const num = (v) => loading ? "…" : error ? "—" : (v ?? 0);

  const shareStats = async () => {
    if (!stats || error) return;
    const lines = [
      "📊 My NexText statistics",
      `${stats.total} total messages (${stats.sent} sent / ${stats.received} received)`,
      `${stats.chats} chats`,
      `Member for ${duration}`,
      `Active time: ${active}`,
      ...ROWS.map(({ key, label }) => `${label}: ↑${stats.perType?.[key]?.sent ?? 0} ↓${stats.perType?.[key]?.recv ?? 0}`),
    ];
    const text = lines.join("\n");
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    } catch { /* user cancelled */ }
  };

  return (
    <div style={{ background: t.surface, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <BarChart2 size={18} color={t.primary} />
        <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>Your statistics</span>
        {!loading && !error && (
          <span onClick={shareStats} style={{ marginLeft: "auto", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: t.primary, fontWeight: 600, marginRight: 12 }}>
            <Share size={13} /> {copiedShare ? "Copied!" : "Share"}
          </span>
        )}
        {!loading && !error && (
          <span onClick={load} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: t.primary, fontWeight: 600 }}>
            <RefreshCw size={13} /> Refresh
          </span>
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
    </div>
  );
}
