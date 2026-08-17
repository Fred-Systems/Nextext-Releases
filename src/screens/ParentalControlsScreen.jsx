import React, { useState, useEffect } from "react";
import { ChevronLeft, Shield, Clock, KeyRound, Plus, X, List, Search } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useContacts } from "../firebase/contacts";

function Toggle({ t, on, onClick }) {
  return (
    <div onClick={onClick} style={{ width: 46, height: 26, borderRadius: 13, background: on ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 0.15s" }} />
    </div>
  );
}

async function simpleHash(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function PinPad({ t, title, subtitle, onSubmit, error }) {
  const [pin, setPin] = useState("");
  const press = (k) => {
    if (k === "⌫") { setPin((p) => p.slice(0, -1)); return; }
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) { onSubmit(next); setPin(""); }
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30 }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
        <KeyRound size={28} color={t.primary} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 6 }}>{title}</div>
      <div style={{ color: t.textMuted, fontSize: 13, marginBottom: 24, textAlign: "center" }}>{subtitle}</div>
      <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: pin.length > i ? (error ? "#FF3B30" : t.primary) : t.border }} />)}
      </div>
      <div style={{ color: "#FF3B30", fontSize: 12, height: 16, marginBottom: 20 }}>{error || ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, width: 220 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((k, i) => (
          <button key={i} disabled={k === ""} onClick={() => press(k)} style={{ padding: "14px 0", borderRadius: 12, border: `1px solid ${t.border}`, background: k === "" ? "transparent" : t.surface, color: t.text, fontSize: 18, fontWeight: 600, cursor: k === "" ? "default" : "pointer" }}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ParentalControlsScreen({ myUid, onBack }) {
  const { t } = useTheme();
  const { contacts } = useContacts(myUid);
  const acceptedContacts = contacts.filter((c) => c.status === "accepted");
  const [restrictions, setRestrictions] = useState(null);
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [pinError, setPinError] = useState("");
  const [settingUpPin, setSettingUpPin] = useState(false);
  const [firstPinEntry, setFirstPinEntry] = useState(null);
  const [newFilterName, setNewFilterName] = useState("");
  const [showNewFilter, setShowNewFilter] = useState(false);
  const [editingFilterIdx, setEditingFilterIdx] = useState(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [privacySearch, setPrivacySearch] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      setRestrictions(snap.data()?.restrictions || {
        allowedContacts: "all", blockMedia: false, blockIncomingPhotos: false, blockIncomingVideos: false,
        blockVoiceNotes: false,
        blockStatus: false, blockGroups: false, blockLinks: false, disableSignOut: false,
        dailyTimeLimitMinutes: null, pinHash: null,
        customFilterLists: [], privacyWhitelist: [], privacyBlacklist: [],
      });
    });
    return unsub;
  }, [myUid]);

  const update = async (patch) => {
    setError("");
    try {
      const merged = { ...restrictions, ...patch };
      await updateDoc(doc(db, "users", myUid), { restrictions: merged, accountType: "child" });
    } catch (e) {
      setError("Couldn't save: " + e.message);
    }
  };

  const handlePinCheck = async (entered) => {
    const hash = await simpleHash(entered);
    if (hash === restrictions.pinHash) {
      setUnlocked(true);
      setPinError("");
    } else {
      setPinError("Incorrect PIN");
    }
  };

  const handlePinSetup = async (entered) => {
    if (firstPinEntry === null) {
      setFirstPinEntry(entered);
      return;
    }
    if (entered !== firstPinEntry) {
      setPinError("PINs didn't match — try again");
      setFirstPinEntry(null);
      return;
    }
    const hash = await simpleHash(entered);
    await update({ pinHash: hash });
    setSettingUpPin(false);
    setFirstPinEntry(null);
    setUnlocked(true);
  };

  const addKeywordToFilter = (filterIdx) => {
    const kw = newKeyword.trim().toLowerCase();
    if (!kw) return;
    const lists = [...(restrictions.customFilterLists || [])];
    if (lists[filterIdx]?.keywords?.includes(kw)) { setNewKeyword(""); return; }
    lists[filterIdx] = { ...lists[filterIdx], keywords: [...(lists[filterIdx].keywords || []), kw] };
    update({ customFilterLists: lists });
    setNewKeyword("");
  };

  const removeKeywordFromFilter = (filterIdx, kwIdx) => {
    const lists = [...(restrictions.customFilterLists || [])];
    lists[filterIdx] = { ...lists[filterIdx], keywords: lists[filterIdx].keywords.filter((_, i) => i !== kwIdx) };
    update({ customFilterLists: lists });
  };

  const togglePrivacyList = (uid, listType) => {
    const otherType = listType === "privacyWhitelist" ? "privacyBlacklist" : "privacyWhitelist";
    const currentList = [...(restrictions[listType] || [])];
    const otherList = [...(restrictions[otherType] || [])];
    const idx = currentList.indexOf(uid);
    if (idx >= 0) {
      currentList.splice(idx, 1);
    } else {
      currentList.push(uid);
      const otherIdx = otherList.indexOf(uid);
      if (otherIdx >= 0) otherList.splice(otherIdx, 1);
    }
    update({ [listType]: currentList, [otherType]: otherList });
  };

  const filteredPrivacyContacts = acceptedContacts.filter((c) => {
    if (!privacySearch.trim()) return true;
    const q = privacySearch.toLowerCase();
    return (c.profile?.displayName || "").toLowerCase().includes(q);
  });

  if (!restrictions) return null;

  if (!restrictions.pinHash && !settingUpPin) {
    return (
      <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <Shield size={18} color={t.text} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>Parental Controls</span>
      </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
          <Shield size={40} color={t.primary} style={{ marginBottom: 16 }} />
          <div style={{ fontWeight: 700, fontSize: 17, color: t.text, marginBottom: 8 }}>Set up a PIN first</div>
          <div style={{ color: t.textMuted, fontSize: 13, marginBottom: 24, lineHeight: 1.5 }}>
            A PIN protects these settings so the restrictions can't just be turned off from this device.
          </div>
          <button onClick={() => setSettingUpPin(true)} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            Set Up PIN
          </button>
        </div>
      </div>
    );
  }

  if (settingUpPin || (restrictions.pinHash && !unlocked)) {
    return (
      <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <Shield size={18} color={t.text} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>Parental Controls</span>
      </div>
        {settingUpPin ? (
          <PinPad t={t} title={firstPinEntry === null ? "Choose a PIN" : "Confirm your PIN"} subtitle={firstPinEntry === null ? "Enter a 4-digit PIN" : "Enter it again to confirm"} onSubmit={handlePinSetup} error={pinError} />
        ) : (
          <PinPad t={t} title="Enter PIN" subtitle="Enter your PIN to manage restrictions" onSubmit={handlePinCheck} error={pinError} />
        )}
      </div>
    );
  }

  const Row = ({ title, sub, on, onClick }) => (
    <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ paddingRight: 12 }}><div style={{ fontWeight: 700, color: t.text, fontSize: 14 }}>{title}</div><div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>{sub}</div></div>
      <Toggle t={t} on={on} onClick={onClick} />
    </div>
  );

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
          <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
          <Shield size={18} color={t.text} />
          <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>Parental Controls</span>
        </div>
      <div className="nx-scroll" style={{ padding: 16 }}>
        <div style={{ color: t.textMuted, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
          Media/voice/status blocks are enforced server-side. Unlocked with your PIN for this session.
        </div>
        {error && <div style={{ color: "#FF3B30", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

        <Row title="Block incoming photos" sub="No images can be received" on={restrictions.blockIncomingPhotos || restrictions.blockMedia} onClick={() => update({ blockIncomingPhotos: !(restrictions.blockIncomingPhotos || restrictions.blockMedia) })} />
        <Row title="Block incoming videos" sub="No videos can be received" on={restrictions.blockIncomingVideos || restrictions.blockMedia} onClick={() => update({ blockIncomingVideos: !(restrictions.blockIncomingVideos || restrictions.blockMedia) })} />
        <Row title="Block voice notes" sub="No voice messages can be sent or received" on={restrictions.blockVoiceNotes} onClick={() => update({ blockVoiceNotes: !restrictions.blockVoiceNotes })} />
        <Row title="Block Status" sub="Can't post or view status updates" on={restrictions.blockStatus} onClick={() => update({ blockStatus: !restrictions.blockStatus })} />
        <Row title="Remove Account Sign-Out Capabilities" sub="Children can't sign out of the account" on={restrictions.disableSignOut} onClick={() => update({ disableSignOut: !restrictions.disableSignOut })} />
<Row title="Block group chats" sub="Can't create or be added to groups" on={restrictions.blockGroups} onClick={() => update({ blockGroups: !restrictions.blockGroups })} />
<Row title="Disable Calculator/Notes disguise" sub="Prevents choosing the hidden Calculator/Notes launcher icon" on={!!restrictions.disableDisguise} onClick={() => update({ disableDisguise: !restrictions.disableDisguise })} />
<Row title="Disable all links" sub="Links appear as plain text, can't be tapped" on={restrictions.blockLinks} onClick={() => update({ blockLinks: !restrictions.blockLinks })} />

        <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><Clock size={16} color={t.text} /><div style={{ fontWeight: 700, color: t.text, fontSize: 14 }}>Daily time limit</div></div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="range" min="0" max="240" step="15" value={restrictions.dailyTimeLimitMinutes || 0} onChange={(e) => update({ dailyTimeLimitMinutes: Number(e.target.value) || null })} style={{ flex: 1, accentColor: t.primary }} />
            <span style={{ color: t.primary, fontWeight: 700, fontSize: 14, minWidth: 70, textAlign: "right" }}>
              {!restrictions.dailyTimeLimitMinutes ? "No limit" : `${restrictions.dailyTimeLimitMinutes} min`}
            </span>
          </div>
        </div>

        <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><List size={16} color={t.text} /><div style={{ fontWeight: 700, color: t.text, fontSize: 14 }}>Custom filter lists</div></div>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.4 }}>Save named keyword filters to auto-block messages containing those terms.</div>
          {(restrictions.customFilterLists || []).map((filter, idx) => (
            <div key={idx} style={{ background: t.bg, borderRadius: 10, padding: 12, marginBottom: 8, border: `1px solid ${t.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: editingFilterIdx === idx ? 8 : 0 }}>
                <span style={{ flex: 1, fontSize: 13, color: t.text, fontWeight: 600 }}>{filter.name}</span>
                <span style={{ fontSize: 11, color: t.textMuted }}>{(filter.keywords || []).length} word{(filter.keywords || []).length !== 1 ? "s" : ""}</span>
                <div onClick={() => setEditingFilterIdx(editingFilterIdx === idx ? null : idx)} style={{ fontSize: 11, color: t.primary, fontWeight: 600, cursor: "pointer" }}>
                  {editingFilterIdx === idx ? "Done" : "Edit"}
                </div>
                <X size={14} color="#FF3B30" style={{ cursor: "pointer" }} onClick={() => {
                  const updated = (restrictions.customFilterLists || []).filter((_, i) => i !== idx);
                  update({ customFilterLists: updated });
                  if (editingFilterIdx === idx) setEditingFilterIdx(null);
                }} />
              </div>
              {editingFilterIdx === idx && (
                <div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {(filter.keywords || []).map((kw, kwIdx) => (
                      <span key={kwIdx} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: t.primaryLight, color: t.primary, fontSize: 11.5, fontWeight: 600 }}>
                        {kw}
                        <X size={10} style={{ cursor: "pointer" }} onClick={() => removeKeywordFromFilter(idx, kwIdx)} />
                      </span>
                    ))}
                    {(!filter.keywords || filter.keywords.length === 0) && (
                      <span style={{ fontSize: 11.5, color: t.textMuted }}>No keywords yet</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addKeywordToFilter(idx); }} placeholder="Type a word to block…" style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 12.5, boxSizing: "border-box", background: t.surface, color: t.text }} />
                    <button disabled={!newKeyword.trim()} onClick={() => addKeywordToFilter(idx)} style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: newKeyword.trim() ? t.primary : t.border, color: newKeyword.trim() ? t.bubbleMeText : t.textMuted, fontSize: 12, fontWeight: 700, cursor: newKeyword.trim() ? "pointer" : "not-allowed" }}>Add</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div onClick={() => setShowNewFilter(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 0", cursor: "pointer", color: t.primary, fontSize: 13, fontWeight: 600 }}>
            <Plus size={14} /> Add custom filter list
          </div>
          {showNewFilter && (
            <div style={{ marginTop: 4, padding: 10, borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg }}>
              <input value={newFilterName} onChange={(e) => setNewFilterName(e.target.value)} placeholder="Filter name (e.g. profanity)" autoFocus style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, boxSizing: "border-box", background: t.surface, color: t.text, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setShowNewFilter(false); setNewFilterName(""); }} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button disabled={!newFilterName.trim()} onClick={() => {
                  const lists = [...(restrictions.customFilterLists || []), { name: newFilterName.trim(), keywords: [] }];
                  update({ customFilterLists: lists });
                  setNewFilterName("");
                  setShowNewFilter(false);
                }} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: newFilterName.trim() ? t.primary : t.border, color: newFilterName.trim() ? t.bubbleMeText : t.textMuted, fontSize: 12, fontWeight: 700, cursor: newFilterName.trim() ? "pointer" : "not-allowed" }}>Add List</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 6 }}>Contact privacy matrix</div>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.4 }}>
            Whitelist: contacts who can always reach you. Blacklist: contacts who are always blocked. Overrides general settings.
          </div>
          <div style={{ display: "flex", alignItems: "center", background: t.bg, borderRadius: 8, padding: "7px 10px", gap: 6, marginBottom: 10, border: `1px solid ${t.border}` }}>
            <Search size={14} color={t.textMuted} />
            <input value={privacySearch} onChange={(e) => setPrivacySearch(e.target.value)} placeholder="Search contacts…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 12.5, color: t.text }} />
            {privacySearch && <X size={13} color={t.textMuted} onClick={() => setPrivacySearch("")} style={{ cursor: "pointer" }} />}
          </div>
          {filteredPrivacyContacts.length === 0 && (
            <div style={{ fontSize: 12.5, color: t.textMuted, textAlign: "center", padding: "10px 0" }}>
              {acceptedContacts.length === 0 ? "No contacts yet." : "No matching contacts."}
            </div>
          )}
          {filteredPrivacyContacts.map((c) => {
            const isWhitelisted = (restrictions.privacyWhitelist || []).includes(c.uid);
            const isBlacklisted = (restrictions.privacyBlacklist || []).includes(c.uid);
            return (
              <div key={c.uid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.profile?.displayName || "Unknown"}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <div onClick={() => togglePrivacyList(c.uid, "privacyWhitelist")} style={{ padding: "4px 10px", borderRadius: 8, background: isWhitelisted ? t.primary : "transparent", border: `1px solid ${isWhitelisted ? t.primary : t.border}`, cursor: "pointer", fontSize: 11, fontWeight: 600, color: isWhitelisted ? t.bubbleMeText : t.textMuted }}>
                    Allow
                  </div>
                  <div onClick={() => togglePrivacyList(c.uid, "privacyBlacklist")} style={{ padding: "4px 10px", borderRadius: 8, background: isBlacklisted ? "#FF3B30" : "transparent", border: `1px solid ${isBlacklisted ? "#FF3B30" : t.border}`, cursor: "pointer", fontSize: 11, fontWeight: 600, color: isBlacklisted ? "#fff" : t.textMuted }}>
                    Block
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div onClick={() => { setSettingUpPin(true); setUnlocked(false); }} style={{ color: t.primary, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center", marginTop: 10 }}>
          Change PIN
        </div>
      </div>
    </div>
  );
}
