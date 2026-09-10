import React, { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { useAuth } from "../firebase/useAuth";
import { listenToCallHistory } from "../firebase/calls";
import { useCall } from "./CallContext";

export default function MissedCallBanner() {
  const { user } = useAuth();
  const myUid = user?.uid;
  const { startCall } = useCall();
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!myUid) return;
    return listenToCallHistory(myUid, setHistory);
  }, [myUid]);

  const missed = history.filter(c => c.state === "missed" && c.calleeUid === myUid)
    .sort((a,b)=> (b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0))[0];

  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`nextext_missed_ack_${myUid}`) || "[]"); } catch { return []; }
  });

  useEffect(() => {
    if (!myUid) return;
    try { setDismissed(JSON.parse(localStorage.getItem(`nextext_missed_ack_${myUid}`) || "[]")); } catch {}
  }, [myUid]);

  if (!missed) return null;
  if (dismissed.includes(missed.id)) return null;
  // Only show if missed within last 48h
  const age = Date.now() - (missed.createdAt?.toMillis?.() || 0);
  if (age > 48*3600*1000) return null;

  const ack = () => {
    const list = [...dismissed, missed.id];
    try { localStorage.setItem(`nextext_missed_ack_${myUid}`, JSON.stringify(list)); } catch {}
    setDismissed(list);
  };

  return (
    <div style={{ position:"fixed", top:"calc(12px + var(--safe-top))", left:12, right:12, zIndex:2147483640, background:"#1a1a1a", color:"#fff", borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 8px 24px rgba(0,0,0,0.4)", border:"1px solid rgba(255,255,255,0.12)" }}>
      <div style={{ width:36, height:36, borderRadius:"50%", background:"#FF3B30", display:"flex", alignItems:"center", justifyContent:"center" }}><Phone size={16} color="#fff"/></div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, fontSize:13 }}>Missed {missed.type==="video"?"video":"voice"} call from {missed.callerName||"Unknown"}</div>
        <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.7)" }}>Tap Call Back to return the call</div>
      </div>
      <button onClick={async ()=>{ ack(); try{ await startCall({ calleeUid: missed.callerUid, calleeName: missed.callerName, calleePhoto: missed.callerPhoto, type: missed.type||"voice"});}catch{} }} style={{ padding:"8px 14px", borderRadius:9, border:"none", background:"#34C759", color:"#fff", fontWeight:700, fontSize:12.5, cursor:"pointer" }}>Call Back</button>
      <span onClick={ack} style={{ cursor:"pointer", fontSize:18, padding:"0 4px", color:"rgba(255,255,255,0.6)" }}>×</span>
    </div>
  );
}
