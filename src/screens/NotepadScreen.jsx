// Disguise screen: a working notepad text editor.
//
// Looks and behaves like a stock notes app — multi-line plain-text editing
// with autosave to localStorage. The unlock check is invisible: the saved
// "unlock keyword" must appear as a whole word (case-insensitive) somewhere
// in the note text. Typing it in any context — even mid-sentence — unlocks
// the app. This makes the disguise genuinely usable (the user can save real
// notes) while still routing them into NexText when the magic word appears.
//
// Long-tap the title to open the keyword-change sheet. Default keyword is
// "open".

import React, { useState, useEffect, useRef, useCallback } from "react";
import { getNotepadKeyword, setNotepadKeyword, hasCustomNotepadKeyword, getActiveProfile } from "../services/iconManager";

const NOTES_KEY = "nextext_disguise_notes";
const WORD_COUNT_KEY = "nextext_disguise_notes_words";

export default function NotepadScreen({ onUnlock }) {
  const profile = getActiveProfile();
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(NOTES_KEY) || ""; } catch { return ""; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [savedAt, setSavedAt] = useState(() => Date.now());
  const unlockRef = useRef(onUnlock);
  const lastSavedRef = useRef(text);

  useEffect(() => { unlockRef.current = onUnlock; }, [onUnlock]);

  // Debounced autosave. The notes text can be large so we don't re-render /
  // re-write on every keystroke — 250ms is the sweet spot between snappy
  // feel and thrashing localStorage.
  useEffect(() => {
    if (text === lastSavedRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(NOTES_KEY, text);
        const wordCount = (text.trim().match(/\S+/g) || []).length;
        localStorage.setItem(WORD_COUNT_KEY, String(wordCount));
        lastSavedRef.current = text;
        setSavedAt(Date.now());
      } catch { /* best-effort */ }
    }, 250);
    return () => clearTimeout(t);
  }, [text]);

  // Live keyword detection. We don't fire unlock until the user STOPS typing
  // for 600ms — otherwise hitting "o" in a long note would briefly unlock on
  // any word that started with "o", which feels broken. Coalescing edits
  // keeps the unlock from triggering mid-stream.
  //
  // On unlock we SCRUB the keyword out of the saved note. Otherwise the word
  // stays in the note text and the very next cold start would auto-unlock the
  // moment the (keyword-containing) note loads — defeating the disguise.
  // Stripping it means the notepad genuinely behaves like a notes app and the
  // user has to type the keyword again to re-open NexText.
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
    const t = setTimeout(() => {
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
    return () => clearTimeout(t);
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

  const accent = profile?.id === "icon7" ? "#FFD60A" : "#10B981";
  const bg = "#FFFFFF";
  const ink = "#1C1C1E";

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: bg, color: ink,
        display: "flex", flexDirection: "column",
        fontFamily: "-apple-system, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          paddingTop: "max(env(safe-area-inset-top), 16px)",
          padding: "max(env(safe-area-inset-top), 16px) 16px 8px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600 }}>{profile?.label || "Notes"}</span>
        <span style={{ display: "flex", gap: 14 }}>
          {text && (
            <span
              role="button"
              aria-label="Clear notes"
              onClick={onClear}
              style={{ fontSize: 14, color: "#8E8E93", cursor: "pointer", padding: 4 }}
            >
              Clear
            </span>
          )}
          <span
            role="button"
            aria-label="Settings"
            onClick={() => { setKeywordDraft(""); setFeedback(""); setSettingsOpen(true); }}
            style={{ fontSize: 18, color: "#8E8E93", cursor: "pointer", padding: 4 }}
          >
            ⚙︎
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
          color: ink,
          background: "transparent",
          fontFamily: "inherit",
        }}
      />

      <div
        style={{
          padding: "8px 18px max(env(safe-area-inset-bottom), 12px)",
          fontSize: 12,
          color: "#8E8E93",
          display: "flex",
          justifyContent: "space-between",
          borderTop: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <span>{wordCount} {wordCount === 1 ? "word" : "words"} · {charCount} {charCount === 1 ? "character" : "characters"}</span>
        <span>Saved</span>
      </div>

      {settingsOpen && (
        <div style={modalOverlay} onClick={() => setSettingsOpen(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Set unlock keyword</div>
            <div style={{ fontSize: 13, color: "#3C3C43", marginBottom: 14, lineHeight: 1.45 }}>
              Type this word anywhere in your notes to open NexText. Default is "open".
              {!hasCustomNotepadKeyword() && ""}
            </div>
            <input
              autoFocus
              maxLength={32}
              value={keywordDraft}
              onChange={(e) => { setKeywordDraft(e.target.value); setFeedback(""); }}
              placeholder="open"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 16, borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.18)", background: "#F2F2F7", color: "#1C1C1E",
                marginBottom: 10,
              }}
            />
            {feedback && <div style={{ fontSize: 13, color: feedback.startsWith("✓") ? accent : "#FF3B30", marginBottom: 10 }}>{feedback}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setSettingsOpen(false)} style={modalBtn("secondary")}>Cancel</button>
              <button
                onClick={() => {
                  const clean = String(keywordDraft || "").trim();
                  if (!clean) { setFeedback("Keyword can't be empty."); return; }
                  setNotepadKeyword(clean);
                  setFeedback("✓ Saved");
                  setTimeout(() => setSettingsOpen(false), 600);
                }}
                style={modalBtn("primary", accent)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const modalOverlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
};
const modalCard = {
  background: "#FFFFFF", color: "#1C1C1E", borderRadius: 18, padding: 22,
  width: "min(360px, calc(100% - 32px))",
  boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
};
function modalBtn(kind, color) {
  return {
    flex: 1,
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: kind === "primary" ? color : "#E5E5EA",
    color: kind === "primary" ? "#1C1C1E" : "#3C3C43",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  };
}
