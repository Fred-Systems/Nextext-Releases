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

let adminStyle = (typeof localStorage !== "undefined" && localStorage.getItem(LS_ADMIN)) || "default";
let userStyle = (typeof localStorage !== "undefined" && localStorage.getItem(LS_USER)) || null;
const listeners = new Set();

export function getAIIconStyle() {
  return userStyle || adminStyle || "default";
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
