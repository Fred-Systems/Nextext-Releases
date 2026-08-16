// Inline "Ask AI about this message" panel. Opened from a regular chat's
// message action menu (when the user has AI access). Shows the message the
// user asked about plus up to 10 messages before and after as read-only
// context, then lets the user chat with the AI about that context. The
// context is passed to sendAIMessage as chat history so the AI "sees" it.
import React, { useState, useEffect, useRef } from "react";
import { X, Send, Bot } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { sendAIMessage, AI_CONTACT_UID } from "../firebase/ai";

export default function AskAIPanel({ myUid, otherName, contextMessages, onClose }) {
  const { t } = useTheme();
  const [aiMessages, setAiMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [aiMessages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    const userMsg = { id: `u${Date.now()}`, senderId: myUid, text };
    const next = [...aiMessages, userMsg];
    setAiMessages(next);
    try {
      const history = [...contextMessages, ...next];
      const aiResponse = await sendAIMessage(myUid, text, history);
      setAiMessages([...next, { id: `a${Date.now()}`, senderId: AI_CONTACT_UID, text: aiResponse }]);
    } catch (err) {
      setAiMessages([...next, { id: `a${Date.now()}`, senderId: AI_CONTACT_UID, text: `Error: ${err?.message || "request failed"}` }]);
    }
    setSending(false);
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
            <div style={{ fontSize: 11, fontWeight: 700, color: t.primary, marginBottom: 2 }}>{otherName || "Them"}</div>
          )}
          {isAI && (
            <div style={{ fontSize: 11, fontWeight: 700, color: t.primary, marginBottom: 2 }}>🤖 NexText AI</div>
          )}
          {m.text}
        </div>
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: t.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 18 }}>🤖</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: t.text, fontWeight: 700, fontSize: 15 }}>Ask AI about this</div>
          <div style={{ color: t.textMuted, fontSize: 11.5 }}>AI sees {contextMessages.length} message{contextMessages.length === 1 ? "" : "s"} of context</div>
        </div>
        <X size={22} color={t.text} onClick={onClose} style={{ cursor: "pointer" }} />
      </div>

      <div style={{ flexShrink: 0, borderBottom: `1px solid ${t.border}`, background: t.surface }}>
        <div onClick={() => setShowContext((s) => !s)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", cursor: "pointer" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted }}>Context the AI can see ({contextMessages.length})</span>
          <span style={{ fontSize: 12, color: t.primary }}>{showContext ? "Hide" : "Show"}</span>
        </div>
        {showContext && (
          <div style={{ maxHeight: "28vh", overflowY: "auto", padding: "0 14px 12px" }}>
            {contextMessages.map((m) => renderBubble(m, true))}
          </div>
        )}
      </div>

      <div ref={chatScrollRef} style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {aiMessages.length === 0 && (
          <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, marginTop: 24, padding: "0 24px", lineHeight: 1.5 }}>
            Ask the AI anything about the selected message and the conversation around it.
          </div>
        )}
        {aiMessages.map((m) => renderBubble(m, false))}
        {sending && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
            <div style={{ background: t.surface, color: t.textMuted, padding: "8px 12px", borderRadius: 14, fontSize: 14 }}>🤖 typing…</div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: `1px solid ${t.border}`, background: t.surface, flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask about this message…"
          style={{ flex: 1, padding: "10px 14px", borderRadius: 20, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, outline: "none" }}
        />
        <button
          disabled={!input.trim() || sending}
          onClick={handleSend}
          style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: input.trim() && !sending ? t.primary : t.border, color: t.bubbleMeText, display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !sending ? "pointer" : "not-allowed" }}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
