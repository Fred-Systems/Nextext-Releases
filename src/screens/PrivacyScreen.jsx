import React, { useState, useEffect } from "react";
import { ChevronLeft, EyeOff, Lock, Users } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useContacts } from "../firebase/contacts";
import { updateSearchVisibility } from "../firebase/names";
import Avatar from "../components/Avatar";

function OptionGroup({ t, value, setValue, options }) {
  return (
    <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
      {options.map(([val, label, sub]) => (
        <div key={val} onClick={() => setValue(val)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", cursor: "pointer" }}>
          <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${t.primary}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
            {value === val && <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.primary }} />}
          </div>
          <div><div style={{ color: t.text, fontSize: 14, fontWeight: 600 }}>{label}</div>{sub && <div style={{ color: t.textMuted, fontSize: 12, marginTop: 1 }}>{sub}</div>}</div>
        </div>
      ))}
    </div>
  );
}

function CheckRow({ t, title, sub, on, onClick, disabled }) {
  return (
    <div onClick={() => { if (!disabled) onClick(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}>
      <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${on ? t.primary : t.border}`, background: on ? t.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {on && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ToggleRow({ t, title, sub, on, onClick }) {
  return (
    <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ paddingRight: 12 }}>
        <div style={{ fontWeight: 700, color: t.text, fontSize: 14 }}>{title}</div>
        <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>{sub}</div>
      </div>
      <div onClick={onClick} style={{ width: 46, height: 26, borderRadius: 13, background: on ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0 }}>
        <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 0.15s" }} />
      </div>
    </div>
  );
}

export default function PrivacyScreen({ myUid, onBack }) {
  const { t } = useTheme();
  const [privacy, setPrivacy] = useState(null);
  const [searchVis, setSearchVis] = useState({ displayName: false, email: false, number: false, exactUsername: false });
  const [savingVis, setSavingVis] = useState(false);
  const [saveError, setSaveError] = useState("");
  const { contacts } = useContacts(myUid);
  const [showExceptList, setShowExceptList] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "users", myUid), (snap) => {
      const d = snap.data() || {};
      setPrivacy(d.privacy || {});
      setSearchVis({
        displayName: !!d.searchVisibility?.displayName,
        email: !!d.searchVisibility?.email,
        number: !!d.searchVisibility?.number,
        exactUsername: !!d.searchVisibility?.exactUsername,
      });
    });
    return unsub;
  }, [myUid]);

  const updateSearchVis = async (patch) => {
    setSavingVis(true);
    setSaveError("");
    try {
      const next = await updateSearchVisibility(myUid, { ...searchVis, ...patch });
      setSearchVis(next);
    } catch (e) {
      setSaveError("Couldn't save visibility: " + e.message);
    } finally {
      setSavingVis(false);
    }
  };

  const update = async (patch) => {
    setSaveError("");
    try {
      await updateDoc(doc(db, "users", myUid), Object.fromEntries(Object.entries(patch).map(([k, v]) => [`privacy.${k}`, v])));
    } catch (e) {
      setSaveError("Couldn't save: " + e.message);
    }
  };

  const toggleExcept = async (uid) => {
    const current = privacy.presenceExcluded || [];
    const next = current.includes(uid) ? current.filter((u) => u !== uid) : [...current, uid];
    await update({ presenceExcluded: next });
  };

  if (!privacy) return null;

  const acceptedContacts = contacts.filter((c) => c.status === "accepted");
  const excludedList = privacy.presenceExcluded || [];

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <Lock size={18} color={t.text} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>Privacy</span>
      </div>
      <div className="nx-scroll" style={{ padding: 16 }}>
        {saveError && <div style={{ color: "#FF3B30", fontSize: 12.5, marginBottom: 10 }}>{saveError}</div>}

        <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 8 }}>Last seen & online</div>
        {privacy.lastSeenVisibility === "nobody" && (
          <div style={{ display: "flex", gap: 8, background: t.primaryLight, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <EyeOff size={15} color={t.primary} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>If you hide your last seen, you also won't see others' last seen or online status — it's reciprocal.</span>
          </div>
        )}
        <OptionGroup t={t} value={privacy.lastSeenVisibility} setValue={(v) => update({ lastSeenVisibility: v })} options={[
          ["everyone", "Everyone"], ["contacts", "My contacts"], ["nobody", "Nobody", "You also won't see others' last seen"],
        ]} />

        <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 8, marginTop: 10 }}>Read receipts & typing</div>
        {!privacy.readReceiptsEnabled && (
          <div style={{ display: "flex", gap: 8, background: t.primaryLight, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <EyeOff size={15} color={t.primary} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>Turning off read receipts means you also won't see blue checkmarks from others.</span>
          </div>
        )}
        <ToggleRow t={t} title="Read receipts" sub="Blue checkmarks when you've read a message" on={privacy.readReceiptsEnabled} onClick={() => update({ readReceiptsEnabled: !privacy.readReceiptsEnabled })} />
        <ToggleRow t={t} title="Typing indicator" sub="Shows others when you're typing (also reciprocal)" on={privacy.typingIndicatorEnabled} onClick={() => update({ typingIndicatorEnabled: !privacy.typingIndicatorEnabled })} />

        <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 8, marginTop: 10 }}>Who can see my Status</div>
        <OptionGroup t={t} value={privacy.statusVisibility} setValue={(v) => update({ statusVisibility: v })} options={[
          ["everyone", "Everyone"], ["contacts", "My contacts"],
        ]} />

        {/* Search visibility — what other users can find this account by */}
        <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 8, marginTop: 14 }}>Who can find me when searching</div>
        <div style={{ background: t.surface, borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
            Your <strong>@username</strong> is always searchable — it's your account handle. Choose any extra fields other people can find you by.
          </div>
          <CheckRow t={t} title="Display name" sub="Let people find you by your display name" on={searchVis.displayName} disabled={savingVis} onClick={() => updateSearchVis({ displayName: !searchVis.displayName })} />
          <CheckRow t={t} title="Email" sub="Let people find you by your email address" on={searchVis.email} disabled={savingVis} onClick={() => updateSearchVis({ email: !searchVis.email })} />
          <CheckRow t={t} title="Phone number" sub="Let people find you by your phone number" on={searchVis.number} disabled={savingVis} onClick={() => updateSearchVis({ number: !searchVis.number })} />
          <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 8, paddingTop: 8 }} />
          <CheckRow t={t} title="Require full username" sub="Only appear in results when someone types your complete @username (no smart/prefix search)" on={searchVis.exactUsername} disabled={savingVis} onClick={() => updateSearchVis({ exactUsername: !searchVis.exactUsername })} />
        </div>

        {/* My Contacts Except... */}
        <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 8, marginTop: 10 }}>My Contacts Except...</div>
        <div style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
            Hide your real-time presence and status updates from selected contacts. They won't see when you're online or your status posts.
          </div>
          <div onClick={() => setShowExceptList(!showExceptList)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer", borderTop: `1px solid ${t.border}`, borderBottom: showExceptList ? `1px solid ${t.border}` : "none" }}>
            <Users size={16} color={t.primary} />
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: t.text }}>
              {excludedList.length > 0 ? `${excludedList.length} contact${excludedList.length !== 1 ? "s" : ""} excluded` : "Select contacts to exclude"}
            </span>
            <span style={{ fontSize: 12, color: t.textMuted }}>{showExceptList ? "▲" : "▼"}</span>
          </div>
          {showExceptList && (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {acceptedContacts.length === 0 && (
                <div style={{ padding: 16, textAlign: "center", color: t.textMuted, fontSize: 13 }}>No contacts to exclude.</div>
              )}
              {acceptedContacts.map((c) => {
                const isExcluded = excludedList.includes(c.uid);
                return (
                  <div key={c.uid} onClick={() => toggleExcept(c.uid)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                    <Avatar photoURL={c.profile?.photoURL} name={c.profile?.displayName} uid={c.uid} size={36} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: t.text }}>{c.profile?.displayName || "Unknown"}</span>
                    <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${isExcluded ? "#FF3B30" : t.border}`, background: isExcluded ? "#FF3B30" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isExcluded && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
