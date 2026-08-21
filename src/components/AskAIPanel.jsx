// Inline "Ask AI about this message" panel. Opened from a regular chat's
// message action menu (when the user has AI access). Shows the message the
// user asked about plus up to 10 messages before and after as read-only
// context, then lets the user chat with the AI about that context. The
// context is passed to sendAIMessage as chat history so the AI "sees" it.
//
// Rendered through a portal on document.body so position:fixed is resolved
// against the real viewport (not a transformed ancestor inside the phone
// shell), which keeps the panel full-height and scrollable instead of
// growing with its content.
import React, { useState, useEffect, useRef } from "react";
import { X, Send, Bot, Mic, UserPlus } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { sendAIMessage, AI_CONTACT_UID } from "../firebase/ai";
import { db } from "../firebase/config";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import VoiceToTextButton from "../components/VoiceToTextButton";

export default function AskAIPanel({ myUid, otherName, contextMessages, contacts = [], onClose }) {
  const { t, composerButtonOrder } = useTheme();
  const sttEnabled = localStorage.getItem("nextext_stt_enabled") !== "off";
  const sttAutoSend = localStorage.getItem("nextext_stt_autosend") !== "off";
  const [aiMessages, setAiMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [context, setContext] = useState(() => [...(contextMessages || [])]);
  const [showContext, setShowContext] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addingContext, setAddingContext] = useState(false);
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
      const history = [...context, ...next];
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

  const addContactContext = async (contact) => {
    if (!contact?.uid || addingContext) return;
    setAddingContext(true);
    try {
      const chatId = [myUid, contact.uid].sort().join("_");
      const q = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("sentAt", "desc"),
        limit(10)
      );
      const snap = await getDocs(q);
      const msgs = snap.docs
        .map((d) => ({ id: `ctx-${d.id}`, senderId: d.data().senderId, text: d.data().text || "", name: d.data().senderId === myUid ? "You" : (contact.displayName || contact.username || "Them") }))
        .filter((m) => m.text)
        .reverse();
      if (msgs.length) {
        setContext((prev) => [...prev, ...msgs]);
      }
    } catch {
      /* non-fatal */
    }
    setAddingContext(false);
    setShowAdd(false);
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
          <div style={{ color: t.textMuted, fontSize: 11.5 }}>AI sees {context.length} message{context.length === 1 ? "" : "s"} of context</div>
        </div>
        <X size={22} color={t.text} onClick={onClose} style={{ cursor: "pointer" }} />
      </div>

      <div style={{ flexShrink: 0, borderBottom: `1px solid ${t.border}`, background: t.surface }}>
        <div onClick={() => setShowContext((s) => !s)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", cursor: "pointer" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted }}>Context the AI can see ({context.length})</span>
          <span style={{ fontSize: 12, color: t.primary }}>{showContext ? "Hide" : "Show"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px 10px" }}>
          <div onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 16, background: t.bg, border: `1px solid ${t.primary}`, color: t.primary, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            <UserPlus size={14} /> Add context
          </div>
        </div>
        {showContext && (
          <div style={{ maxHeight: "28vh", overflowY: "auto", padding: "0 14px 12px" }}>
            {context.map((m) => renderBubble(m, true))}
          </div>
        )}
      </div>

      <div ref={chatScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
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

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2147483001, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: 18, width: "100%", maxWidth: 320, maxHeight: "70%", overflowY: "auto" }}>
            <div style={{ padding: "16px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, color: t.text, fontSize: 15 }}>Add chat context</div>
              <X size={20} color={t.text} onClick={() => setShowAdd(false)} style={{ cursor: "pointer" }} />
            </div>
            <div style={{ padding: 8 }}>
              {contacts.length === 0 && <div style={{ padding: 16, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No contacts to add.</div>}
              {contacts.map((c) => {
                const name = c.profile?.displayName || c.profile?.username || c.displayName || c.username || "Contact";
                return (
                  <div key={c.uid} onClick={() => addContactContext(c)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: c.avatarColor || c.color || t.primary, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14 }}>
                      {(name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, color: t.text, fontSize: 14 }}>{name}</div>
                  </div>
                );
              })}
            </div>
            {addingContext && <div style={{ textAlign: "center", color: t.textMuted, fontSize: 12, paddingBottom: 12 }}>Loading…</div>}
          </div>
        </div>
      )}
    </div>
  );

  return panel;
}
