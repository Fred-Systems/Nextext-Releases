// Inline "Ask AI about this message" panel. Opened from a regular chat's
// message action menu. The user types their own context/explanation for the AI
// instead of auto-pulling nearby messages. Rendered at App shell level so
// position:fixed resolves to the fixed phone frame (no portal, no growth).
import React, { useState, useEffect, useRef } from "react";
import { X, Send, Bot, Mic } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { sendAIMessage, AI_CONTACT_UID } from "../firebase/ai";
import VoiceToTextButton from "../components/VoiceToTextButton";

export default function AskAIPanel({ myUid, otherName, contextMessages, onClose }) {
  const { t, composerButtonOrder } = useTheme();
  const sttEnabled = localStorage.getItem("nextext_stt_enabled") !== "off";
  const sttAutoSend = localStorage.getItem("nextext_stt_autosend") !== "off";
  const [aiMessages, setAiMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // User-typed context/explanation for the AI (replaces auto-pulled nearby messages)
  const [userContext, setUserContext] = useState("");
  const [showContext, setShowContext] = useState(true);
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const contextRef = useRef(null);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [aiMessages]);

  // Build the history sent to the AI: user's typed context + the conversation so far
  const buildHistory = () => {
    const ctx = userContext.trim();
    const history = [];
    if (ctx) history.push({ id: "ctx-user", senderId: myUid, text: `Context: ${ctx}` });
    if (contextMessages && contextMessages.length) {
      // Optionally include the original tapped message as reference
      contextMessages.forEach((m) => history.push({ id: m.id, senderId: m.senderId, text: m.text || "" }));
    }
    history.push(...aiMessages);
    return history;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    const userMsg = { id: `u${Date.now()}`, senderId: myUid, text };
    const next = [...aiMessages, userMsg];
    setAiMessages(next);
    try {
      const history = buildHistory();
      const aiResponse = await sendAIMessage(myUid, text, history);
      setAiMessages([...next, { id: `a${Date.now()}`, senderId: AI_CONTACT_UID, text: aiResponse }]);
    } catch (err) {
      setAiMessages([...next, { id: `a${Date.now()}`, senderId: AI_CONTACT_UID, text: `Error: ${err?.message || "request failed"}` }]);
    }
    setSending(false);
  };

  const handleSttResult = (text, { autoSend } = {}) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    setInput((prev) => (prev ? (prev.endsWith(" ") ? prev : prev + " ") : "") + trimmed);
    if (autoSend) handleSend(trimmed);
  };

  const renderBubble = (m, isContext) => {
    const mine = m.senderId === myUid;
    const isAI = m.senderId === AI_CONTACT_UID;
    return (
      <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 8 }}>
        <div style={{
          maxWidth: "82%",
          background: isAI ? t.surface : mine ? t.primary : t.surface,
          color: isAI ? t.text : mine ? t.bubbleMeText : t.text,
          padding: "8px 12px",
          borderRadius: 14,
          fontSize: 14,
          lineHeight: 1.45,
          border: isContext ? `1px dashed ${t.border}` : "none",
          opacity: isContext ? 0.85 : 1,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {!isContext && !mine && !isAI && (
            <div style={{ fontSize: 11, fontWeight: 700, color: t.primary, marginBottom: 2 }}>{m.name || otherName || "Them"}</div>
          )}
          {isContext && !mine && !isAI && m.name && (
            <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, marginBottom: 2 }}>{m.name}</div>
          )}
          {isAI && (
            <div style={{ fontSize: 11, fontWeight: 700, color: t.primary, marginBottom: 2 }}>🤖 NexText AI</div>
          )}
          {m.text}
        </div>
      </div>
    );
  };

  const panel = (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: t.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 18 }}>🤖</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: t.text, fontWeight: 700, fontSize: 15 }}>Ask AI about this</div>
          <div style={{ color: t.textMuted, fontSize: 11.5 }}>Type context below for the AI</div>
        </div>
        <X size={22} color={t.text} onClick={onClose} style={{ cursor: "pointer" }} />
      </div>

      {/* User-typed context section — scrollable like the chat area */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${t.border}`, background: t.surface, display: "flex", flexDirection: "column" }}>
        <div onClick={() => setShowContext((s) => !s)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", cursor: "pointer" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted }}>Your context for the AI</span>
          <span style={{ fontSize: 12, color: t.primary }}>{showContext ? "Hide" : "Show"}</span>
        </div>
        {showContext && (
          <div style={{ padding: "0 14px 10px", minHeight: 60 }}>
            <textarea
              ref={contextRef}
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              placeholder="Explain the situation, what you want the AI to know, any details…"
              style={{
                width: "100%",
                minHeight: 80,
                maxHeight: 200,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${t.border}`,
                background: t.bg,
                color: t.text,
                fontSize: 13.5,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
                lineHeight: 1.4,
                boxSizing: "border-box",
              }}
            />
            {userContext.trim() && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: t.textMuted }}>
                {userContext.trim().length} characters — this is what the AI will see as context
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat area — scrollable */}
      <div ref={chatScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
        {aiMessages.length === 0 && (
          <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, marginTop: 24, padding: "0 24px", lineHeight: 1.5 }}>
            Type context above, then ask the AI anything.
          </div>
        )}
        {aiMessages.map((m) => renderBubble(m, false))}
        {sending && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
            <div style={{ background: t.surface, color: t.textMuted, padding: "8px 12px", borderRadius: 14, fontSize: 14 }}>🤖 typing…</div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: `1px solid ${t.border}`, background: t.surface, flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask about this message…"
          style={{ flex: 1, padding: "10px 14px", borderRadius: 20, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, outline: "none" }}
        />
        {composerButtonOrder === "voice-stt" ? (
          <>
            {sttEnabled ? (
              <VoiceToTextButton myUid={myUid} onResult={handleSttResult} onAutoSend={(text) => { if (text && text.trim()) handleSend(text.trim()); }} autoSend={sttAutoSend} size={38} useRealtime />
            ) : null}
            <button
              disabled={!input.trim() || sending}
              onClick={handleSend}
              style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: input.trim() && !sending ? t.primary : t.border, color: t.bubbleMeText, display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !sending ? "pointer" : "not-allowed" }}
            >
              <Send size={18} />
            </button>
          </>
        ) : (
          <>
            <button
              disabled={!input.trim() || sending}
              onClick={handleSend}
              style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: input.trim() && !sending ? t.primary : t.border, color: t.bubbleMeText, display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !sending ? "pointer" : "not-allowed" }}
            >
              <Send size={18} />
            </button>
            {sttEnabled ? (
              <VoiceToTextButton myUid={myUid} onResult={handleSttResult} onAutoSend={(text) => { if (text && text.trim()) handleSend(text.trim()); }} autoSend={sttAutoSend} size={38} useRealtime />
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  return panel;
}