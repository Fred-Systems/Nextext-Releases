import { useSyncExternalStore } from "react";

// Shared AI assistant icon style. Set by the admin (globalSettings.aiIconStyle)
// and mirrored to localStorage so it survives process death. Avatar components
// subscribe via useAIIconStyle() and re-render when it changes.
let style = (typeof localStorage !== "undefined" && localStorage.getItem("nextext_ai_icon_style")) || "default";
const listeners = new Set();

export function getAIIconStyle() {
  return style;
}

export function setAIIconStyle(next) {
  style = next || "default";
  try { localStorage.setItem("nextext_ai_icon_style", style); } catch { /* best-effort */ }
  listeners.forEach((l) => l());
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAIIconStyle() {
  return useSyncExternalStore(subscribe, getAIIconStyle, getAIIconStyle);
}
