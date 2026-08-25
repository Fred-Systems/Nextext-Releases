import { useSyncExternalStore } from "react";

// Shared AI assistant icon style.
//
// Two layers:
//   - adminStyle: set by the admin (globalSettings.aiIconStyle), the default
//     applied to everyone unless a user overrides it.
//   - userStyle: a per-user override (stored in localStorage) so each person
//     can pick their own AI icon look in AI controls. The user value wins.
//
// Both are mirrored to localStorage so they survive process death. Avatar
// components subscribe via useAIIconStyle() and re-render when either changes.
const LS_ADMIN = "nextext_ai_icon_style_admin";
const LS_USER = "nextext_ai_icon_style_user";

let adminStyle = (typeof localStorage !== "undefined" && localStorage.getItem(LS_ADMIN)) || "neon";
let userStyle = (typeof localStorage !== "undefined" && localStorage.getItem(LS_USER)) || null;
const listeners = new Set();

// Pure helper: returns the inner visual (style + label) for a given AI icon
// style. Used by Avatar and the AI sidebar widget so they stay in sync.
export function aiAvatarInner(aiStyle, size, fontSize) {
  const base = {
    width: size, height: size, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize, fontWeight: 800, color: "#fff", userSelect: "none",
  };
  switch (aiStyle) {
    case "ai-letters":
      return { style: { ...base, background: "#0B141A", color: "#10B981", letterSpacing: 1, fontStyle: "italic" }, label: "AI" };
    case "neon":
      return { style: { ...base, background: "#06141A", color: "#39FF14", textShadow: "0 0 8px #39FF14, 0 0 16px #39FF14" }, label: "AI" };
    case "gradient":
      return { style: { ...base, background: "linear-gradient(135deg, #10B981, #00A884 60%, #25D366)", color: "#fff" }, label: "AI" };
    case "mono":
      return { style: { ...base, background: "#111111", color: "#EDEDED" }, label: "AI" };
    default:
      return { style: { ...base, background: "#10B981", color: "#fff" }, label: "AI" };
  }
}

export function getAIIconStyle() {
  return userStyle || adminStyle || "neon";
}

export function setAdminAIIconStyle(next) {
  adminStyle = next || "default";
  try { localStorage.setItem(LS_ADMIN, adminStyle); } catch { /* best-effort */ }
  listeners.forEach((l) => l());
}

// Backwards-compatible alias: admin layer.
export function setAIIconStyle(next) {
  setAdminAIIconStyle(next);
}

export function setUserAIIconStyle(next) {
  // Passing "default"/null/"off" clears the per-user override so the admin
  // (global) style applies again.
  userStyle = next && next !== "default" && next !== "off" ? next : null;
  try {
    if (userStyle) localStorage.setItem(LS_USER, userStyle);
    else localStorage.removeItem(LS_USER);
  } catch { /* best-effort */ }
  listeners.forEach((l) => l());
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAIIconStyle() {
  return useSyncExternalStore(subscribe, getAIIconStyle, getAIIconStyle);
}
