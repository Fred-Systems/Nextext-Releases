// Lock screen in front of the Admin Panel. The admin IDENTITY persists
// server-side (users/{uid}.role === "admin") across refresh/restart — this gate
// only asks for the admin's PIN (stored hashed in Firestore) when one is set.
import React, { useState, useEffect } from "react";
import { Lock } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { getAdminPanelPinHash, verifyAdminPanelPin } from "../firebase/adminPanelPin";

const UNLOCK_KEY = "nextext_admin_panel_unlocked";
const UNLOCK_TTL = 15 * 60 * 1000; // re-lock after 15 minutes

function stillUnlocked() {
  try {
    const raw = localStorage.getItem(UNLOCK_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < UNLOCK_TTL;
  } catch { return false; }
}

export default function AdminPanelGate({ children }) {
  const { t } = useTheme();
  const [checking, setChecking] = useState(true);
  const [pinRequired, setPinRequired] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const hash = await getAdminPanelPinHash().catch(() => null);
      if (!alive) return;
      if (!hash) { setPinRequired(false); setUnlocked(true); }
      else if (stillUnlocked()) { setPinRequired(true); setUnlocked(true); }
      else { setPinRequired(true); setUnlocked(false); }
      setChecking(false);
    })();
    return () => { alive = false; };
  }, []);

  const tryUnlock = async () => {
    setBusy(true); setErr("");
    try {
      const ok = await verifyAdminPanelPin(pin);
      if (ok) {
        try { localStorage.setItem(UNLOCK_KEY, String(Date.now())); } catch { /* noop */ }
        setUnlocked(true);
      } else {
        setErr("Incorrect PIN. Try again.");
        setPin("");
      }
    } catch {
      setErr("Couldn't verify PIN. Check your connection.");
    } finally { setBusy(false); }
  };

  if (checking) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: t.textMuted, fontSize: 13 }}>Checking…</div>;
  if (unlocked) return children;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: t.bg }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <Lock size={26} color={t.primary} />
      </div>
      <div style={{ fontWeight: 800, fontSize: 17, color: t.text, marginBottom: 4 }}>Admin Panel Locked</div>
      <div style={{ fontSize: 12.5, color: t.textMuted, textAlign: "center", marginBottom: 18, maxWidth: 260 }}>
        Enter your admin PIN to open the panel. You stay signed in as an admin — this is just the panel lock.
      </div>
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && pin && !busy) tryUnlock(); }}
        placeholder="Admin PIN"
        style={{ width: "100%", maxWidth: 240, boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 15, textAlign: "center", letterSpacing: 4, color: t.text, background: t.surface, outline: "none", marginBottom: 8 }}
      />
      {err && <div style={{ color: "#FF3B30", fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div
        onClick={() => { if (pin && !busy) tryUnlock(); }}
        style={{ width: "100%", maxWidth: 240, textAlign: "center", padding: "12px 0", borderRadius: 10, background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: busy ? "wait" : "pointer", opacity: busy || !pin ? 0.6 : 1 }}
      >
        {busy ? "Checking…" : "Unlock"}
      </div>
    </div>
  );
}
