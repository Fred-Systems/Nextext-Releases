import React, { useState, useEffect } from "react";
import { useGlobalSettings } from "../firebase/config-settings";
import { Megaphone, ChevronLeft } from "lucide-react";

export default function AnnouncementsScreen({ theme, onBack }) {
  const settings = useGlobalSettings();
  const t = theme || {};
  const announcements = (settings && Array.isArray(settings.announcements) ? settings.announcements : [])
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg || "#0B141A", color: t.text || "#fff", zIndex: 30, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(14px + var(--safe-top)) 12px 14px", background: t.primary || "#10B981", color: t.bubbleMeText || "#fff", flexShrink: 0 }}>
        <ChevronLeft size={22} color={t.bubbleMeText || "#fff"} onClick={onBack} style={{ cursor: "pointer" }} />
        <Megaphone size={18} color={t.bubbleMeText || "#fff"} />
        <span style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>Announcements</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {announcements.length === 0 ? (
          <div style={{ textAlign: "center", color: t.textMuted || "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 40 }}>No announcements yet.</div>
        ) : (
          announcements.map((a) => (
            <div key={a.id} style={{ background: t.surface || "#1C2B33", borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: t.text || "#fff", marginBottom: 6 }}>{a.title}</div>
              <div style={{ fontSize: 13.5, color: t.text || "#fff", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{a.body}</div>
              <div style={{ fontSize: 11, color: t.textMuted || "rgba(255,255,255,0.5)", marginTop: 10 }}>
                {a.authorName ? a.authorName + " · " : ""}
                {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
