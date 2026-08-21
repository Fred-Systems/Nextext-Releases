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
import { ArrowLeft, Pencil } from "lucide-react";
import { ICON_PROFILES, getActiveProfileId, setActiveProfile, hasCustomCalculatorPin, setCalculatorPin, hasCustomNotepadKeyword, setNotepadKeyword } from "../services/iconManager";
import { useGlobalSettings, updateGlobalSettings } from "../firebase/config-settings";

const PROFILE_BLURBS = {
  default: "Same as icon 1. The original NexText look.",
  icon1:   "NexText with the first wallpaper variant.",
  icon2:   "NexText with the second wallpaper variant.",
  icon3:   "NexText with the third wallpaper variant.",
  icon4:   "NexText with the fourth wallpaper variant.",
  icon5:   "NexText with the fifth wallpaper variant.",
  icon6:   "Disguises the app as a Calculator. Enter your PIN on the keypad to open NexText. Default PIN: 1234.",
  icon7:   "Disguises the app as a Notes editor. Type your unlock keyword in a note to open NexText. Default keyword: open.",
  icon8:   "NexText with the eighth wallpaper variant.",
  icon9:   "NexText with the ninth wallpaper variant.",
  icon10:  "NexText with the tenth wallpaper variant.",
  icon11:  "NexText with the eleventh wallpaper variant.",
  icon12:  "Disguises the app as a Calculator. Enter your PIN on the keypad to open NexText. Default PIN: 1234.",
  icon13:  "Disguises the app as a Notes editor. Type your unlock keyword in a note to open NexText. Default keyword: open.",
};

export default function IconPickerScreen({ onBack, restrictions, isAdmin, myUid }) {
  const [activeId, setActiveId] = useState(getActiveProfileId);
  const [pendingId, setPendingId] = useState(null);
  // If a preview image fails to load we fall back to an emoji/letter so the
  // tile is never blank.
  const [failed, setFailed] = useState({});
  // If the user backgrounds and re-enters the app, the icon profile is
  // already saved in localStorage (and on the native side) so this effect
  // just refreshes the active-id indicator.
  useEffect(() => { setActiveId(getActiveProfileId()); }, []);

  // First-time disguise setup: when the user picks Calculator / Notes and
  // hasn't configured a custom PIN / keyword yet, we open a setup sheet
  // (instead of immediately swapping the icon) so they can choose their secret
  // and learn how to unlock the disguise later.
  const [setupFor, setSetupFor] = useState(null); // null | "icon6" | "icon7"
  const [setupDraft, setSetupDraft] = useState("");
  const [setupFeedback, setSetupFeedback] = useState("");

  const isDisguiseProfile = (id) => id === "icon6" || id === "icon7" || id === "icon12" || id === "icon13";

  const applyProfile = async (id) => {
    if (id === activeId || pendingId) return;
    if (isDisguiseProfile(id) && restrictions?.disableDisguise) {
      alert("Calculator/Notes disguise is disabled by parental controls.");
      setPendingId(null);
      return;
    }
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

  const globalSettings = useGlobalSettings();
  // Admins can override the built-in disguise descriptions (e.g. make them less
  // obvious). Falls back to the hardcoded PROFILE_BLURBS when no override exists.
  const blurb = (id) => (globalSettings?.iconDescriptions && globalSettings.iconDescriptions[id]) || PROFILE_BLURBS[id] || "";
  const editBlurb = (id, label) => {
    if (!isAdmin || !myUid) return;
    const current = (globalSettings?.iconDescriptions && globalSettings.iconDescriptions[id]) || PROFILE_BLURBS[id] || "";
    const next = window.prompt("Edit description for " + label + ":", current);
    if (next == null) return;
    updateGlobalSettings({ iconDescriptions: { ...(globalSettings?.iconDescriptions || {}), [id]: next } }, myUid);
  };

  const onPick = (id) => {
    if (id === activeId || pendingId) return;
    if (isDisguiseProfile(id) && restrictions?.disableDisguise) {
      alert("Calculator/Notes disguise is disabled by parental controls.");
      return;
    }
    if (id === "icon6" && !hasCustomCalculatorPin()) {
      setSetupDraft(""); setSetupFeedback(""); setSetupFor("icon6");
      return;
    }
    if (id === "icon7" && !hasCustomNotepadKeyword()) {
      setSetupDraft(""); setSetupFeedback(""); setSetupFor("icon7");
      return;
    }
    if (id === "icon12" && !hasCustomCalculatorPin()) {
      setSetupDraft(""); setSetupFeedback(""); setSetupFor("icon12");
      return;
    }
    if (id === "icon13" && !hasCustomNotepadKeyword()) {
      setSetupDraft(""); setSetupFeedback(""); setSetupFor("icon13");
      return;
    }
    applyProfile(id);
  };

  const saveSetup = () => {
    if (setupFor === "icon6" || setupFor === "icon12") {
      if (setupDraft.length < 4) { setSetupFeedback("PIN must be at least 4 digits."); return; }
      setCalculatorPin(setupDraft);
    } else if (setupFor === "icon7" || setupFor === "icon13") {
      const kw = setupDraft.trim();
      if (!kw) { setSetupFeedback("Keyword can't be empty."); return; }
      setNotepadKeyword(kw);
    }
    const id = setupFor;
    setSetupFor(null);
    applyProfile(id);
  };

  // Change the Calculator disguise unlock code. The user must first prove they
  // know the existing code (entering it), then set a new one (confirmed twice)
  // before it is written. This prevents someone else from silently changing
  // the code on a locked device.
  const [changePinFor, setChangePinFor] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [changeFeedback, setChangeFeedback] = useState("");

  const saveChangePin = () => {
    if (!calculatorPinMatches(oldPin)) { setChangeFeedback("Old code is incorrect."); return; }
    if (newPin.length < 4) { setChangeFeedback("New code must be at least 4 digits."); return; }
    if (newPin !== confirmPin) { setChangeFeedback("New codes don't match."); return; }
    setCalculatorPin(newPin);
    setChangeFeedback("✓ Code changed");
    setTimeout(() => { setChangePinFor(false); setOldPin(""); setNewPin(""); setConfirmPin(""); setChangeFeedback(""); }, 900);
  };

  return (
      <div style={{ position: "absolute", inset: 0, zIndex: 40, background: "#121B22", color: "#fff", pointerEvents: "auto", overflowY: "auto", WebkitOverflowScrolling: "touch", touchAction: "pan-y", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
        <button onClick={onBack} aria-label="Back" style={{ background: "transparent", border: "none", color: "#fff", padding: 6, marginRight: 6, cursor: "pointer" }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ fontSize: 18, fontWeight: 600 }}>App icon & name</div>
      </div>

      <div style={{ padding: "12px 14px 32px" }}>
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
                  {isActive ? "Currently active" : blurb(p.id)}
                </div>
                {isAdmin && (
                  <div
                    onClick={(e) => { e.stopPropagation(); editBlurb(p.id, p.label); }}
                    title="Edit description"
                    style={{ marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#FFD60A", cursor: "pointer", opacity: 0.85 }}
                  >
                    <Pencil size={11} /> edit
                  </div>
                )}
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

        {(activeId === "icon6" || activeId === "icon12" || hasCustomCalculatorPin()) && (
          <button
            onClick={() => { setOldPin(""); setNewPin(""); setConfirmPin(""); setChangeFeedback(""); setChangePinFor(true); }}
            style={{ marginTop: 16, width: "100%", padding: "13px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Change Calculator unlock code
          </button>
        )}
      </div>

      {setupFor && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 60 }}>
          <div style={{ width: "100%", maxWidth: 320, background: "#1E2A32", borderRadius: 18, padding: 22 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
              {setupFor === "icon6" ? "Set Calculator unlock PIN" : "Set Notes unlock keyword"}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, marginBottom: 16 }}>
              {(setupFor === "icon6" || setupFor === "icon12")
                ? "After applying, NexText will appear as a Calculator. Open it by typing this PIN anywhere on the keypad — e.g. just press 1 2 3 4. Default is 1234."
                : "After applying, NexText will appear as Notes. Open it by typing this word anywhere in a note. Default is \"open\"."}
            </div>
            <input
              autoFocus
              inputMode={setupFor === "icon6" ? "numeric" : "text"}
              maxLength={setupFor === "icon6" ? 6 : 32}
              value={setupDraft}
              onChange={(e) => {
                const v = setupFor === "icon6" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value;
                setSetupDraft(v); setSetupFeedback("");
              }}
              placeholder={setupFor === "icon6" ? "1234" : "open"}
              style={{
                width: "100%", padding: "10px 12px", fontSize: 18, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)", background: "#121B22", color: "#fff",
                letterSpacing: setupFor === "icon6" ? 6 : 0, textAlign: "center", marginBottom: 10,
              }}
            />
            {setupFeedback && (
              <div style={{ fontSize: 13, color: setupFeedback.startsWith("✓") ? "#10B981" : "#FF453A", marginBottom: 10 }}>{setupFeedback}</div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setSetupFor(null)} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={saveSetup} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none", background: "#10B981", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                Save & apply
              </button>
            </div>
          </div>
        </div>
      )}

      {changePinFor && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 60 }}>
          <div style={{ width: "100%", maxWidth: 320, background: "#1E2A32", borderRadius: 18, padding: 22 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Change Calculator unlock code</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, marginBottom: 14 }}>
              Enter your current code first, then choose a new one.
            </div>
            <input
              inputMode="numeric" maxLength={6} value={oldPin}
              onChange={(e) => { setOldPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setChangeFeedback(""); }}
              placeholder="Current code"
              style={{ width: "100%", padding: "10px 12px", fontSize: 18, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "#121B22", color: "#fff", letterSpacing: 6, textAlign: "center", marginBottom: 10 }}
            />
            <input
              inputMode="numeric" maxLength={6} value={newPin}
              onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setChangeFeedback(""); }}
              placeholder="New code"
              style={{ width: "100%", padding: "10px 12px", fontSize: 18, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "#121B22", color: "#fff", letterSpacing: 6, textAlign: "center", marginBottom: 10 }}
            />
            <input
              inputMode="numeric" maxLength={6} value={confirmPin}
              onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setChangeFeedback(""); }}
              placeholder="Confirm new code"
              style={{ width: "100%", padding: "10px 12px", fontSize: 18, borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "#121B22", color: "#fff", letterSpacing: 6, textAlign: "center", marginBottom: 10 }}
            />
            {changeFeedback && (
              <div style={{ fontSize: 13, color: changeFeedback.startsWith("✓") ? "#10B981" : "#FF453A", marginBottom: 10 }}>{changeFeedback}</div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setChangePinFor(false)} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={saveChangePin} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none", background: "#10B981", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
