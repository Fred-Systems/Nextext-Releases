import React, { useState, useEffect } from "react";
import { ChevronLeft, Users, RefreshCw, Smartphone, Share2, Package, Check } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { collection, query, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { sendContactRequest } from "../firebase/contacts";
import { getLatestApkUrl } from "../updater/updateChecker";
import { Capacitor } from "@capacitor/core";
import NextextNative from "../native/nextextNative";



function normalizePhone(raw) {
  // Strip everything except digits; keep leading + for country code detection
  return String(raw || "").replace(/[^\d]/g, "");
}

// Match a NexText user's stored number against a device contact. Both sides
// are reduced to digits; a match counts when:
// 1. Full normalized numbers match exactly
// 2. Last 10 digits match (handles country-code differences like +1 prefix)
// 3. One number has leading 1 (US country code) and the other doesn't, but
//    the remaining digits match
function phonesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Compare last 10 digits (handles +1, +44, etc.)
  if (a.length >= 10 && b.length >= 10) {
    if (a.slice(-10) === b.slice(-10)) return true;
  }
  // Explicit US +1 handling: if one has leading 1 and other doesn't,
  // compare without the leading 1
  const aNo1 = a.startsWith("1") && a.length === 11 ? a.slice(1) : a;
  const bNo1 = b.startsWith("1") && b.length === 11 ? b.slice(1) : b;
  if (aNo1 !== a || bNo1 !== b) {
    if (aNo1 === bNo1) return true;
  }
  return false;
}

export default function FindFriendsScreen({ myUid, onBack }) {
  const { t } = useTheme();
  const [matches, setMatches] = useState([]);
  const [otherContacts, setOtherContacts] = useState([]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState([]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [invited, setInvited] = useState([]);
  const [shareStatus, setShareStatus] = useState("");
  const [includeApk, setIncludeApk] = useState(false);
  const [apkUrl, setApkUrl] = useState("");
  const [apkBusy, setApkBusy] = useState(false);

  const ensurePermission = async () => {
    if (!Capacitor.isNativePlatform()) return true;
    try {
      const res = await NextextNative.requestContacts();
      return !!(res && res.granted);
    } catch {
      return false;
    }
  };

  const readDeviceContacts = async () => {
    if (!Capacitor.isNativePlatform()) return [];
    try {
      const res = await NextextNative.getDeviceContacts();
      if (!res || res.granted === false) {
        setPermissionDenied(true);
        return null;
      }
      return res.contacts || [];
    } catch {
      return [];
    }
  };

  // Reliable clipboard copy with an execCommand fallback — navigator.clipboard
  // is frequently unavailable/blocked inside the Android (Capacitor) WebView.
  const copyInviteText = async (text) => {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };

  const handleShare = async (name, phone) => {
    setShareStatus("");
    const link = `https://nextext.app/invite?r=${encodeURIComponent(myUid || "")}`;
    // Optional APK: when the toggle is on, fetch (once, cached) the latest
    // Android app download link and append it so the friend can install
    // NexText directly. A fetch failure just drops the APK line — the plain
    // invite still goes out.
    let apkLine = "";
    if (includeApk) {
      let apk = apkUrl;
      if (!apk && !apkBusy) {
        setShareStatus("Fetching latest APK link…");
        setApkBusy(true);
        apk = (await getLatestApkUrl()) || "";
        setApkUrl(apk);
        setApkBusy(false);
      }
      if (apk) apkLine = `\nDownload the latest Android app here: ${apk}`;
    }
    const text = `Hey${name ? " " + name : ""}! Let's chat on NexText — a fast, private messaging app. Sign up here: ${link}${apkLine}`;
    // Prefer the native share sheet (navigator.share) on every platform — on
    // Android it surfaces WhatsApp / Messages / email etc. so the user can pick
    // how to send the invite. Only fall back to clipboard copy when the sheet
    // is unavailable or the user cancels/rejects it.
    if (navigator.share) {
      try {
        await navigator.share({ text });
        setInvited((s) => [...s, phone]);
        return;
      } catch (e) {
        if (e?.name === "AbortError" || e?.name === "ShareCanceledError") return; // user cancelled
        // fall through to clipboard below
      }
    }
    const copied = await copyInviteText(text);
    if (copied) {
      setInvited((s) => [...s, phone]);
      setShareStatus(`Invite copied${name ? " for " + name : ""} — paste it into a message!`);
    } else {
      setShareStatus(`Couldn't copy automatically. Invite link: ${link}`);
    }
  };

  const checkAllContacts = async () => {
    setError("");
    setBusy(true);
    setChecked(false);
    try {
      const granted = await ensurePermission();
      if (!granted) {
        setPermissionDenied(true);
        setBusy(false);
        return;
      }
      const deviceContacts = await readDeviceContacts();
      if (deviceContacts === null) {
        setBusy(false);
        return;
      }

      // All NexText users who have a phone number on file.
      const usersSnap = await getDocs(
        query(collection(db, "users"))
      );
      const usersByPhone = new Map();
      usersSnap.forEach((d) => {
        const data = d.data() || {};
        if (d.id === myUid) return;
        const num = normalizePhone(data.phoneNumberNormalized || data.phoneNumber);
        if (!num) return;
        usersByPhone.set(num, { uid: d.id, displayName: data.displayName || data.username || "NexText user", username: data.username || "", phone: num, verified: data.verified, hideVerified: data.hideVerified });
      });

      const found = [];
      const notFound = [];
      const seenUser = new Set();
      deviceContacts.forEach((c) => {
        const cNum = normalizePhone(c.phone);
        let user = null;
        for (const [stored, u] of usersByPhone) {
          if (phonesMatch(stored, cNum)) { user = u; break; }
        }
        if (user) {
          if (!seenUser.has(user.uid)) {
            seenUser.add(user.uid);
            found.push(user);
          }
        } else if (cNum.length >= 6) {
          notFound.push({ name: c.name || "Contact", phone: cNum });
        }
      });

      setMatches(found);
      setOtherContacts(notFound);
      setChecked(true);
    } catch (e) {
      setError("Couldn't check contacts: " + (e?.message || "unknown error"));
    }
    setBusy(false);
  };

  useEffect(() => {
    checkAllContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (uid) => {
    try {
      await sendContactRequest(myUid, uid);
      setSentTo((s) => [...s, uid]);
    } catch (e) {
      setError("Couldn't send request: " + (e?.message || "unknown error"));
    }
  };

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: t.surface, flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        <ChevronLeft size={22} color={t.text} onClick={onBack} style={{ cursor: "pointer" }} />
        <Users size={18} color={t.text} />
        <span style={{ color: t.text, fontWeight: 700, fontSize: 17 }}>Find Friends</span>
      </div>
      <div className="nx-scroll" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
          We compare your device contacts against NexText users so you can add friends who are already here — and invite everyone else.
        </div>
        {error && <div style={{ color: "#FF3B30", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        {shareStatus && <div style={{ color: t.primary, fontSize: 12.5, marginBottom: 10 }}>{shareStatus}</div>}
        {permissionDenied && (
          <div style={{ background: t.primaryLight, borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Smartphone size={16} color={t.primary} />
              <span style={{ fontWeight: 700, color: t.text, fontSize: 13.5 }}>Contacts access is off</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5, marginBottom: 10 }}>
              Allow NexText to read your contacts to find friends who use the app.
            </div>
            <button onClick={checkAllContacts} disabled={busy} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer" }}>
              {busy ? "Checking…" : "Grant access"}
            </button>
          </div>
        )}
        {!permissionDenied && (
          <button onClick={checkAllContacts} disabled={busy} style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 15, cursor: busy ? "wait" : "pointer", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: busy ? 0.6 : 1 }}>
            <RefreshCw size={16} style={busy ? { animation: "nextext-spin 0.9s linear infinite" } : {}} />
            {busy ? "Checking contacts…" : "Check my contacts"}
          </button>
        )}

        {checked && !busy && (
          <>
            <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 8 }}>
              On NexText{matches.length > 0 ? ` (${matches.length})` : ""}
            </div>
            {matches.length === 0 && (
              <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, padding: "8px 0 20px" }}>
                None of your contacts use NexText yet.
              </div>
            )}
            {matches.map((u) => (
              <div key={u.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: t.primary }}>{u.displayName?.[0] || "?"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 600, fontSize: 14.5, color: t.text }}>{u.displayName}{u.verified && !u.hideVerified && <Check size={14} color="#1DA1F2" strokeWidth={3} />}</div>
                  <div style={{ fontSize: 12, color: t.textMuted }}>@{u.username}</div>
                </div>
                <button disabled={sentTo.includes(u.uid)} onClick={() => handleAdd(u.uid)} style={{ padding: "7px 14px", borderRadius: 16, border: "none", background: sentTo.includes(u.uid) ? t.border : t.primary, color: sentTo.includes(u.uid) ? t.textMuted : t.bubbleMeText, fontSize: 12.5, fontWeight: 700, cursor: sentTo.includes(u.uid) ? "default" : "pointer" }}>
                  {sentTo.includes(u.uid) ? "Sent" : "Add"}
                </button>
              </div>
            ))}

            {otherContacts.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", background: t.primaryLight, borderRadius: 12, marginBottom: 8, marginTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Package size={16} color={t.primary} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, color: t.text, fontSize: 13.5 }}>Include APK link</div>
                      <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.4, marginTop: 1 }}>Also send the latest Android app download so they can install NexText right away.</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setIncludeApk((v) => !v)}
                    aria-label="Toggle APK link in invites"
                    style={{ width: 46, height: 26, borderRadius: 13, border: "none", background: includeApk ? t.primary : t.border, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.15s ease" }}>
                    <span style={{ position: "absolute", top: 3, left: includeApk ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
                  </button>
                </div>
                <div style={{ fontWeight: 700, color: t.text, fontSize: 14, marginBottom: 8, marginTop: 12 }}>
                  Not on NexText yet ({otherContacts.length})
                </div>
                {otherContacts.map((c) => (
                  <div key={c.phone} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${t.border}` }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: t.primary }}>{c.name?.[0] || "?"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5, color: t.text }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: t.textMuted }}>{c.phone}</div>
                    </div>
                    <button onClick={() => handleShare(c.name, c.phone)} style={{ padding: "7px 12px", borderRadius: 16, border: "1px solid", borderColor: t.primary, background: "transparent", color: t.primary, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                      <Share2 size={13} />
                      {invited.includes(c.phone) ? "Invited" : "Invite"}
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
