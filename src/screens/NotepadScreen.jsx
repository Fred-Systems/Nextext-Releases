// Disguise screen: a working notepad text editor with light/dark toggle.
// Looks and behaves like a stock notes app — multi-line plain-text editing
// with autosave to localStorage. Defaults to dark theme (matching the app),
// with a small toggle to switch to light. The unlock check is invisible: the
// saved "unlock keyword" must appear as a whole word (case-insensitive) somewhere
// in the note text. The keyword is chosen in Settings before the icon is
// applied, so the disguise screen never exposes that it's a disguise.

import React, { useState, useEffect, useRef, useCallback } from "react";
import { getNotepadKeyword, getActiveProfile } from "../services/iconManager";

const NOTES_KEY = "nextext_disguise_notes";
const WORD_COUNT_KEY = "nextext_disguise_notes_words";
const THEME_KEY = "nextext_notes_theme";

const DARK = {
  bg: "#000000", ink: "#E5E5EA", surface: "#1C1C1E", muted: "rgba(255,255,255,0.55)",
  border: "rgba(255,255,255,0.15)", inputBg: "#1C1C1E",
};
const LIGHT = {
  bg: "#FFFFFF", ink: "#1C1C1E", surface: "#F2F2F7", muted: "rgba(0,0,0,0.5)",
  border: "rgba(0,0,0,0.12)", inputBg: "#F2F2F7",
};

export default function NotepadScreen({ onUnlock }) {
  const profile = getActiveProfile();
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light") return false;
      return true;
    } catch {
      return true;
    }
  });
  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const next = !d;
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch {}
      return next;
    });
  }, []);
  const t = dark ? DARK : LIGHT;

  const [text, setText] = useState(() => {
    try { return localStorage.getItem(NOTES_KEY) || ""; } catch { return ""; }
  });
  const [savedAt, setSavedAt] = useState(() => Date.now());
  const unlockRef = useRef(onUnlock);
  const lastSavedRef = useRef(text);

  useEffect(() => { unlockRef.current = onUnlock; }, [onUnlock]);

  useEffect(() => {
    if (text === lastSavedRef.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(NOTES_KEY, text);
        const wc = (text.trim().match(/\S+/g) || []).length;
        localStorage.setItem(WORD_COUNT_KEY, String(wc));
        lastSavedRef.current = text;
        setSavedAt(Date.now());
      } catch { /* best-effort */ }
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (!text) return;
    const kw = getNotepadKeyword();
    if (!kw) return;
    let re;
    try {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      re = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i");
      if (!re.test(text)) return;
    } catch {
      if (!text.toLowerCase().includes(kw.toLowerCase())) return;
      re = null;
    }
    const timer = setTimeout(() => {
      try {
        const scrubbed = re
          ? text.replace(re, (m) => m.replace(new RegExp(kw, "i"), "").trim())
          : text.replace(new RegExp(kw, "gi"), "");
        const cleaned = scrubbed.replace(/\s{2,}/g, " ").trim();
        try {
          localStorage.setItem(NOTES_KEY, cleaned);
          const wc = (cleaned.match(/\S+/g) || []).length;
          localStorage.setItem(WORD_COUNT_KEY, String(wc));
          lastSavedRef.current = cleaned;
        } catch { /* best-effort */ }
        setText(cleaned);
      } catch { /* best-effort */ }
      try { unlockRef.current && unlockRef.current(); } catch { /* best-effort */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [text]);

  const wordCount = (text.trim().match(/\S+/g) || []).length;
  const charCount = text.length;

  const onClear = useCallback(() => {
    if (!text) return;
    if (typeof window !== "undefined" && window.confirm) {
      if (!window.confirm("Clear all note text?")) return;
    }
    setText("");
  }, [text]);

  return (
    <div
      style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        width: "100%", height: "100dvh",
        background: t.bg, color: t.ink,
        display: "flex", flexDirection: "column",
        fontFamily: "-apple-system, system-ui, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          paddingTop: "max(env(safe-area-inset-top), 16px)",
          padding: "max(env(safe-area-inset-top), 16px) 16px 8px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: `1px solid ${t.border}`,
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600 }}>{profile?.label || "Notes"}</span>
        <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {text && (
            <span
              role="button"
              aria-label="Clear notes"
              onClick={onClear}
              style={{ fontSize: 14, color: t.muted, cursor: "pointer", padding: 4 }}
            >
              Clear
            </span>
          )}
          <span
            role="button"
            aria-label="Toggle theme"
            onClick={toggleTheme}
            style={{ cursor: "pointer", padding: "4px 6px", userSelect: "none", fontSize: 14 }}
          >
            {dark ? "☀️" : "🌙"}
          </span>
        </span>
      </div>

      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing…"
        spellCheck
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          outline: "none",
          resize: "none",
          padding: "16px 18px",
          fontSize: 16,
          lineHeight: 1.5,
          color: t.ink,
          background: t.bg,
          fontFamily: "inherit",
        }}
      />

      <div
        style={{
          padding: "8px 18px max(env(safe-area-inset-bottom), 12px)",
          fontSize: 12,
          color: t.muted,
          display: "flex",
          justifyContent: "space-between",
          borderTop: `1px solid ${t.border}`,
        }}
      >
        <span>{wordCount} {wordCount === 1 ? "word" : "words"} · {charCount} {charCount === 1 ? "character" : "characters"}</span>
        <span style={{ color: t.muted }}>Saved</span>
      </div>
    </div>
  );
}