// Side-panel "Ask AI about this message". Slides in from right.
// Shows: (1) chat context (last ~20 messages), (2) user-typed context,
// (3) "+" button to pull extra context from other chats.
// Fixed-height panel with independently scrollable sections.
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
  // User-typed context/explanation for the AI
  const [userContext, setUserContext] = useState("");
  const [showUserContext, setShowUserContext] = useState(false);
  // Chat context from the current conversation (last ~20 messages)
  const [chatContext, setChatContext] = useState(() => contextMessages || []);
  const [showChatContext, setShowChatContext] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);

  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const userContextRef = useRef(null);
  const chatContextRef = useRef(null);

  useEffect(() => { setPanelMounted(true); }, []);
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [aiMessages]);

  const buildHistory = () => {
    const history = [];
    if (userContext.trim()) history.push({ id: "ctx-user", senderId: myUid, text: `Context: ${userContext.trim()}` });
    if (chatContext.length) chatContext.forEach((m) => history.push({ id: m.id, senderId: m.senderId, text: m.text || "" }));
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

  const panelWidth = 360; // px

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 2147483000, display: panelMounted ? "block" : "none" }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: panelWidth,
          maxWidth: "100%",
          zIndex: 2147483001,
          background: t.bg,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
          transform: panelMounted ? "translateX(0)" : `translateX(${panelWidth}px)`,
          transition: "transform 0.25s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 18 }}>🤖</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: t.text, fontWeight: 700, fontSize: 15 }}>Ask AI about this</div>
            <div style={{ color: t.textMuted, fontSize: 11.5 }}>Type context + AI sees chat history</div>
          </div>
          <X size={22} color={t.text} onClick={onClose} style={{ cursor: "pointer" }} />
        </div>

        {/* Context sections — each independently scrollable, fixed heights */}
        <div style={{ flexShrink: 0, borderBottom: `1px solid ${t.border}`, background: t.surface, display: "flex", flexDirection: "column" }}>
          {/* Chat Context (from current conversation) */}
          <div onClick={() => setShowChatContext((s) => !s)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", cursor: "pointer" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted }}>Chat context ({chatContext.length} msgs)</span>
            <span style={{ fontSize: 12, color: t.primary }}>{showChatContext ? "Hide" : "Show"}</span>
          </div>
          {showChatContext && (
            <div ref={chatContextRef} style={{ maxHeight: "30vh", overflowY: "auto", padding: "0 14px 10px" }}>
              {chatContext.length === 0 ? (
                <div style={{ textAlign: "center", color: t.textMuted, fontSize: 12, padding: "16px 0" }}>No chat history available</div>
              ) : (
                chatContext.map((m) => renderBubble(m, true))
              )}
            </div>
          )}

          {/* User-typed Context */}
          <div onClick={() => setShowUserContext((s) => !s)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", cursor: "pointer", borderTop: `1px solid ${t.border}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted }}>Your context for the AI</span>
            <span style={{ fontSize: 12, color: t.primary }}>{showUserContext ? "Hide" : "Show"}</span>
          </div>
          {showUserContext && (
            <div style={{ padding: "0 14px 10px", minHeight: 60 }}>
              <textarea
                ref={userContextRef}
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
                  {userContext.trim().length} characters
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
    </>
  );
}