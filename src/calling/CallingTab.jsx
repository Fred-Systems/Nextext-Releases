import React, { useState, useEffect } from "react";
import { Phone, Video, PhoneMissed, PhoneIncoming, PhoneOutgoing, Clock, Search, X, Settings } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { useCall } from "./CallContext";
import { listenToCallHistory } from "../firebase/calls";
import { useAuth } from "../firebase/useAuth";
import { useContacts } from "../firebase/contacts";
import Avatar from "../components/Avatar";
import { useGlobalSettings } from "../firebase/config-settings";

function formatTime(ts) {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function formatDuration(sec) {
  if (!sec && sec !== 0) return "";
  const s = Math.floor(sec);
  const m = Math.floor(s/60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}:${String(r).padStart(2,"0")}`;
}
function statusMeta(call, myUid) {
  const isOutgoing = call.callerUid === myUid;
  const s = call.state;
  if (s === "missed") return { label: "Missed", icon: PhoneMissed, color: "#FF3B30", dir: isOutgoing ? "out" : "in" };
  if (s === "declined") return { label: "Declined", icon: PhoneMissed, color: "#FF3B30", dir: isOutgoing ? "out" : "in" };
  if (s === "busy") return { label: "Busy", icon: PhoneMissed, color: "#FF9500", dir: "out" };
  if (s === "cancelled") return { label: "Cancelled", icon: PhoneMissed, color: "#8E8E93", dir: "out" };
  if (s === "failed") return { label: "Failed", icon: PhoneMissed, color: "#FF3B30", dir: isOutgoing ? "out" : "in" };
  if (s === "ended") {
    const dur = call.duration;
    return { label: dur ? formatDuration(dur) : "Ended", icon: isOutgoing ? PhoneOutgoing : PhoneIncoming, color: "#34C759", dir: isOutgoing ? "out" : "in" };
  }
  return { label: s, icon: Phone, color: "#8E8E93", dir: isOutgoing ? "out" : "in" };
}

export default function CallingTab({ myUid: propUid, onOpenSettings }) {
  const { t } = useTheme();
  const { user } = useAuth();
  const myUid = propUid || user?.uid;
  const globalSettings = useGlobalSettings();
  const { startCall } = useCall();
  const { contacts } = useContacts(myUid);
  const [history, setHistory] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [pickerType, setPickerType] = useState("voice");
  const [filter, setFilter] = useState("recent"); // recent | missed

  useEffect(() => {
    if (!myUid) return;
    return listenToCallHistory(myUid, setHistory);
  }, [myUid]);

  const callingEnabled = globalSettings?.calling?.enabled === true;
  if (!callingEnabled) return null;

  const filteredContacts = (contacts || []).filter((c) => c.status === "accepted" && c.uid !== myUid).filter((c) => {
    if (!pickerQ.trim()) return true;
    const q = pickerQ.toLowerCase();
    const name = (c.profile?.displayName || c.profile?.username || "").toLowerCase();
    return name.includes(q) || c.uid.toLowerCase().includes(q);
  }).slice(0, 30);

  const handleCall = async (uid, type, name, photo) => {
    try { await startCall({ calleeUid: uid, calleeName: name, calleePhoto: photo, type }); setShowPicker(false); } catch (e) { /* error shown in overlay */ }
  };

  return (
    <div style={{ position: "relative", height: "100%", background: t.bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "18px 16px 14px", background: t.surface, borderBottom: `1px solid ${t.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.text, letterSpacing: 0.2 }}>Calling</div>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 2 }}>Voice & video calls</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); try { onOpenSettings?.(); } catch {} }} onTouchStart={(e) => e.stopPropagation()} aria-label="Open Settings" style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", flexShrink: 0 }}>
          <Settings size={22} color="#fff" />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", minHeight: 0, overscrollBehavior: "contain", touchAction: "pan-y" }} className="noPagerSwipe" onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
        <div style={{ display:"flex", gap:8, padding:"8px 16px 6px" }}>
          {[["recent","Recent Calls"],["missed","Missed Calls"]].map(([k,label])=>(
            <div key={k} onClick={()=>setFilter(k)} style={{ padding:"6px 12px", borderRadius:16, fontSize:12.5, fontWeight:600, cursor:"pointer", background: filter===k ? t.primary : t.primaryLight, color: filter===k ? t.bubbleMeText : t.primary }}>{label}</div>
          ))}
        </div>
        {(filter==="missed" ? history.filter(c=>c.state==="missed") : history).length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", gap: 14, textAlign: "center" }}>
              <div style={{ width: 72, height: 72, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Phone size={28} color={t.primary} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{filter==="missed"?"No missed calls":"No calls yet"}</div>
              <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5, maxWidth: 260 }}>{filter==="missed"?"All caught up.":"Start a voice or video call with someone from your contacts."}</div>
            </div>
          ) : (filter==="missed" ? history.filter(c=>c.state==="missed") : history).map((c) => {
          const otherUid = c.callerUid === myUid ? c.calleeUid : c.callerUid;
          const otherName = c.callerUid === myUid ? (c.calleeName || otherUid.slice(0,6)) : (c.callerName || otherUid.slice(0,6));
          const otherPhoto = c.callerUid === myUid ? c.calleePhoto : c.callerPhoto;
          const meta = statusMeta(c, myUid);
          const Icon = meta.icon;
          const isVideo = c.type === "video";
          return (
            <div key={c.id} onClick={() => handleCall(otherUid, c.type, otherName, otherPhoto)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
              <Avatar photoURL={otherPhoto} name={otherName} uid={otherUid} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: t.text, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{otherName}</span>
                  {isVideo ? <Video size={12} color={t.textMuted} /> : <Phone size={12} color={t.textMuted} />}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: meta.color }}>
                  <Icon size={12} color={meta.color} />
                  <span>{meta.dir === "out" ? "Outgoing" : "Incoming"} {isVideo ? "video" : "voice"} • {meta.label}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 11.5, color: t.textMuted, display: "flex", alignItems: "center", gap: 4 }}><Clock size={10} />{formatTime(c.createdAt)}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={(e) => { e.stopPropagation(); handleCall(otherUid, "voice", otherName, otherPhoto); }} aria-label="Call back voice" style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Phone size={14} color={t.primary} /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleCall(otherUid, "video", otherName, otherPhoto); }} aria-label="Call back video" style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Video size={14} color={t.primary} /></button>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ padding: "8px 16px 6px", fontSize: 12, fontWeight: 700, color: t.textMuted, letterSpacing: 0.4, textTransform: "uppercase", marginTop: 8 }}>Contacts</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 16px 8px", background: t.bg, borderRadius: 10, padding: "8px 12px", border: `1px solid ${t.border}` }}>
          <Search size={14} color={t.textMuted} />
          <input value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="Search contacts…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13.5, color: t.text }} />
          {pickerQ && <X size={14} color={t.textMuted} onClick={() => setPickerQ("")} style={{ cursor: "pointer" }} />}
        </div>
        {filteredContacts.length === 0 ? (
          <div style={{ padding: "12px 16px", textAlign: "center", color: t.textMuted, fontSize: 13 }}>{pickerQ ? "No contacts match" : "No contacts"}</div>
        ) : filteredContacts.map((c) => (
          <div key={c.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${t.border}` }}>
            <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.profile?.displayName || c.profile?.username || c.uid.slice(0,6)}</div>
              <div style={{ fontSize: 12, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{c.profile?.username || c.uid.slice(0,8)}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); handleCall(c.uid, "voice", c.profile?.displayName || c.profile?.username, c.profile?.photoURL); }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} aria-label={`Voice call ${c.profile?.displayName || c.uid}`} style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", touchAction: "manipulation", pointerEvents: "auto" }}><Phone size={16} color={t.primary} /></button>
            <button onClick={(e) => { e.stopPropagation(); handleCall(c.uid, "video", c.profile?.displayName || c.profile?.username, c.profile?.photoURL); }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} aria-label={`Video call ${c.profile?.displayName || c.uid}`} style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", touchAction: "manipulation", pointerEvents: "auto" }}><Video size={16} color="#fff" /></button>
          </div>
        ))}
      </div>
      {showPicker && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 500, display: "flex", alignItems: "flex-end" }} onClick={() => setShowPicker(false)}>
          <div style={{ background: t.surface, width: "100%", borderRadius: "18px 18px 0 0", maxHeight: "78%", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 10px", borderBottom: `1px solid ${t.border}` }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: t.text }}>{pickerType === "video" ? "Video call" : "Voice call"} — choose contact</span>
              <X size={20} color={t.textMuted} onClick={() => setShowPicker(false)} style={{ cursor: "pointer" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 16px", background: t.bg, borderRadius: 10, padding: "8px 12px" }}>
              <Search size={14} color={t.textMuted} />
              <input autoFocus value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="Search contacts…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13.5, color: t.text }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
              {filteredContacts.map((c) => (
                <div key={c.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${t.border}` }}>
                  <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.profile?.displayName || c.profile?.username || c.uid.slice(0,6)}</div>
                    <div style={{ fontSize: 12, color: t.textMuted }}>@{c.profile?.username || c.uid.slice(0,6)}</div>
                  </div>
                  <button onClick={() => handleCall(c.uid, "voice", c.profile?.displayName || c.profile?.username, c.profile?.photoURL)} aria-label={`Voice call ${c.profile?.displayName || c.uid}`} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Phone size={15} color={t.primary} /></button>
                  <button onClick={() => handleCall(c.uid, "video", c.profile?.displayName || c.profile?.username, c.profile?.photoURL)} aria-label={`Video call ${c.profile?.displayName || c.uid}`} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Video size={15} color="#fff" /></button>
                </div>
              ))}
              {filteredContacts.length === 0 && <div style={{ padding: "24px 16px", textAlign: "center", color: t.textMuted, fontSize: 13 }}>No contacts found</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
