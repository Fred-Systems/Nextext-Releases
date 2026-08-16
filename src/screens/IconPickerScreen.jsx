// Settings → "App icon & name" picker.
//
// Shows all 8 launcher profiles (default + icon1..icon7) as a grid of tiles.
// Each tile has a live preview of the icon at the resolution it'll appear at
// in the launcher, plus the label and a brief description of the disguise
// behaviour. Picking a tile:
//   1. Updates local state immediately (the tile gets a "selected" ring).
//   2. Calls setActiveProfile(id), which writes localStorage and asks the
//      native plugin to swap the launcher icon. The native plugin then kills
//      the process, so the user is briefly kicked back to the Android home
//      screen and the launcher re-renders the new icon. Tapping the icon
//      again brings the app right back, now wearing the new disguise.
//
// Until the app comes back from process death, this screen is no longer
// mounted, so we don't need any local "saved!" toast — the act of picking
// IS the save.

import React, { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { ICON_PROFILES, getActiveProfileId, setActiveProfile } from "../services/iconManager";

const PROFILE_BLURBS = {
  default: "Same as icon 1. The original NexText look.",
  icon1:   "NexText with the first wallpaper variant.",
  icon2:   "NexText with the second wallpaper variant.",
  icon3:   "NexText with the third wallpaper variant.",
  icon4:   "NexText with the fourth wallpaper variant.",
  icon5:   "NexText with the fifth wallpaper variant.",
  icon6:   "Disguises the app as a Calculator. Enter your PIN on the keypad to open NexText. Default PIN: 1234.",
  icon7:   "Disguises the app as a Notes editor. Type your unlock keyword in a note to open NexText. Default keyword: open.",
};

export default function IconPickerScreen({ onBack }) {
  const [activeId, setActiveId] = useState(getActiveProfileId);
  const [pendingId, setPendingId] = useState(null);
  // If a preview image fails to load we fall back to an emoji/letter so the
  // tile is never blank.
  const [failed, setFailed] = useState({});

  // If the user backgrounds and re-enters the app, the icon profile is
  // already saved in localStorage (and on the native side) so this effect
  // just refreshes the active-id indicator.
  useEffect(() => { setActiveId(getActiveProfileId()); }, []);

  const onPick = async (id) => {
    if (id === activeId || pendingId) return;
    setPendingId(id);
    try {
      await setActiveProfile(id);
      // Successful path: the native side kills the process. The user is taken
      // back to the home screen and the launcher re-renders with the new
      // icon. This screen never gets to update its state — the WebView dies
      // before this promise resolves.
    } catch {
      setPendingId(null);
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#121B22", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
        <button onClick={onBack} aria-label="Back" style={{ background: "transparent", border: "none", color: "#fff", padding: 6, marginRight: 6, cursor: "pointer" }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ fontSize: 18, fontWeight: 600 }}>App icon & name</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 32px" }}>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", marginBottom: 14, lineHeight: 1.4 }}>
          Pick a launcher icon and label. Disguises (Calculator and Notes) hide the chat list behind a PIN or keyword.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {ICON_PROFILES.map((p) => {
            const isActive = p.id === activeId;
            const isPending = p.id === pendingId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                disabled={!!pendingId && !isPending}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: isActive ? "2px solid #10B981" : "2px solid rgba(255,255,255,0.08)",
                  borderRadius: 16,
                  padding: 12,
                  cursor: pendingId ? "default" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "center",
                  opacity: pendingId && !isPending ? 0.4 : 1,
                  transition: "border-color 0.15s ease, transform 0.15s ease",
                  transform: isPending ? "scale(0.97)" : "scale(1)",
                }}
              >
                <div style={{
                  position: "relative",
                  width: 72, height: 72, borderRadius: 16, overflow: "hidden",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
                }}>
                  {/* Always-visible base preview so a tile can never look blank,
                      even if the real icon image is missing or fails to load. */}
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 32,
                    background: p.kind === "calculator" ? "#1C1C1E" : p.kind === "notes" ? "#FFF8E1" : "#10B981",
                    color: p.kind === "calculator" || p.kind === "notes" ? "#FFD60A" : "#fff",
                  }}>
                    {p.kind === "calculator" ? "🧮" : p.kind === "notes" ? "📝" : "N"}
                  </div>
                  {/* Real launcher icon overlaid on top; hidden if it errors so
                      the base preview shows through. */}
                  {!failed[p.id] && (
                    <img
                      src={p.iconPath}
                      alt={p.label}
                      onError={() => setFailed((f) => ({ ...f, [p.id]: true }))}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.35, minHeight: 30 }}>
                  {isActive ? "Currently active" : PROFILE_BLURBS[p.id] || ""}
                </div>
                {isActive && (
                  <div style={{
                    fontSize: 11, color: "#10B981", fontWeight: 600,
                    padding: "2px 8px", borderRadius: 99,
                    background: "rgba(16,185,129,0.15)",
                  }}>
                    Active
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 24, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
          Picking a profile swaps the launcher icon and (for Calculator / Notes) the app name. After the swap, NexText will restart so the launcher can pick up the change — tap the icon again to come back.
        </div>
      </div>
    </div>
  );
}
