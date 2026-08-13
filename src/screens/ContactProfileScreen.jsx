import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Ban, Flag, FileText, Camera, X, UserPlus } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { doc, onSnapshot, updateDoc, collection, query, orderBy } from "firebase/firestore";
import { addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import Avatar from "../components/Avatar";
import AvatarColorPicker from "../components/AvatarColorPicker";
import { getContactDisplayName, getContactRealName, setContactNickname } from "../firebase/contacts";
import { useGlobalSettings } from "../firebase/config-settings";
import { useStatuses } from "../firebase/status";
import { uploadChatFile } from "../supabase/media";
import { isMediaExpired, sendContactMessage, getOrCreateDirectChat } from "../firebase/chats";
import { useContacts } from "../firebase/contacts";
import { AI_CONTACT_UID } from "../firebase/ai";
import ContactSharePicker from "../components/ContactSharePicker";

const LOCAL_OVERRIDE_KEY = "nextext_contact_photo_overrides";

function getLocalOverrides() {
  try {
    const raw = localStorage.getItem(LOCAL_OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function setLocalOverride(uid, photoURL) {
  const overrides = getLocalOverrides();
  if (photoURL) { overrides[uid] = photoURL; } else { delete overrides[uid]; }
  localStorage.setItem(LOCAL_OVERRIDE_KEY, JSON.stringify(overrides));
}

const VIEWED_KEY = "nextext_status_viewed";
function getStoredViewed() {
  try { const raw = localStorage.getItem(VIEWED_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function getMediaExpiryText(sentAt, mediaExpiryDays) {
  if (mediaExpiryDays == null) return "Permanent Storage";
  if (!sentAt?.toDate) return "";
  const daysElapsed = (Date.now() - sentAt.toDate().getTime()) / (1000 * 60 * 60 * 24);
  const remaining = Math.ceil(mediaExpiryDays - daysElapsed);
  if (remaining <= 0) return "Expired";
  return `Deletes in ${remaining} day${remaining !== 1 ? "s" : ""}`;
}

function directChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

function useSharedMedia(myUid, otherUid, tab) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const isSelf = myUid && otherUid && myUid === otherUid;

  useEffect(() => {
    if (!myUid || !otherUid || isSelf) { setItems([]); setLoading(false); return; }
    const chatId = directChatId(myUid, otherUid);
    const msgRef = collection(db, "chats", chatId, "messages");
    const types = tab === "media" ? ["image", "video"] : ["file"];
    const q = query(msgRef, orderBy("sentAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const results = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((m) => !m.deletedForEveryone && types.includes(m.type) && m.mediaURL);
      setItems(results);
      setLoading(false);
    }, () => { setItems([]); setLoading(false); });
    return unsub;
  }, [myUid, otherUid, tab, isSelf]);

  return { items, loading };
}

export default function ContactProfileScreen({ myUid, otherUid, contact, onBack, onOpenStatus }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  const isSelfProfile = otherUid === myUid;
  const otherStatuses = useStatuses(isSelfProfile ? [] : [otherUid]);
  const hasOtherActiveStatus = otherStatuses.length > 0;
  const viewedMap = getStoredViewed();
  const otherStatusViewed = !!viewedMap[otherUid];
  const [tab, setTab] = useState("media");
  const [isBlocked, setIsBlocked] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [error, setError] = useState("");
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [avatarNonce, setAvatarNonce] = useState(0);
  const [localPhotoOverride, setLocalPhotoOverride] = useState(() => getLocalOverrides()[otherUid] || null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [nickname, setNickname] = useState(() => contact?.nickname || "");
  const [savingNickname, setSavingNickname] = useState(false);
  const [showContactShare, setShowContactShare] = useState(false);
  const [shareSent, setShareSent] = useState(false);
  const { contacts: myContacts } = useContacts(myUid);
  const localPhotoRef = useRef(null);
  const { items: sharedMedia, loading: mediaLoading } = useSharedMedia(myUid, otherUid, tab);

  const [otherUserDoc, setOtherUserDoc] = useState(null);

  useEffect(() => {
    if (!otherUid || otherUid === myUid) return;
    const unsub = onSnapshot(doc(db, "users", myUid, "contacts", otherUid), (snap) => {
      setIsBlocked(!!snap.data()?.blocked);
    });
    return unsub;
  }, [myUid, otherUid]);

  useEffect(() => {
    if (!otherUid) return;
    const unsub = onSnapshot(doc(db, "users", otherUid), (snap) => {
      setOtherUserDoc(snap.exists() ? snap.data() : null);
    }, () => setOtherUserDoc(null));
    return unsub;
  }, [otherUid]);

  const statusBlocked = !!otherUserDoc?.restrictions?.blockStatus;

  const toggleBlock = async () => {
    setError("");
    try {
      await updateDoc(doc(db, "users", myUid, "contacts", otherUid), { blocked: !isBlocked });
    } catch (e) {
      setError("Couldn't update: " + e.message);
    }
  };

  const submitReport = async () => {
    setError("");
    try {
      await addDoc(collection(db, "reports"), {
        reportedUid: otherUid,
        reportedByUid: myUid,
        reason: "Reported from contact profile",
        chatId: null,
        messageId: null,
        createdAt: serverTimestamp(),
        status: "new",
        adminNotes: null,
      });
      setReportSent(true);
      setTimeout(() => setReportSent(false), 2500);
    } catch (e) {
      setError("Couldn't send report: " + e.message);
    }
  };

  const handleLocalPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const result = await uploadChatFile(`local-override-${myUid}`, myUid, file, { compress: true });
      setLocalOverride(otherUid, result.url);
      setLocalPhotoOverride(result.url);
    } catch { /* silent */ }
    setUploadingPhoto(false);
  };

  const shareThisContact = async (target) => {
    setShareSent(true);
    setTimeout(() => setShareSent(false), 2500);
    try {
      const targetChatId = await getOrCreateDirectChat(myUid, target.uid);
      await sendContactMessage(targetChatId, myUid, {
        uid: otherUid,
        contactName: displayName,
        contactUsername: otherUserDoc?.username || contact?.profile?.username || null,
        contactPhotoURL: otherUserDoc?.photoURL || contact?.profile?.photoURL || null,
      }, [target.uid]);
    } catch (e) {
      setError("Couldn't share contact: " + e.message);
    }
  };

  const clearLocalPhotoOverride = () => {
    setLocalOverride(otherUid, null);
    setLocalPhotoOverride(null);
  };

  const saveNickname = async () => {
    if (!nickname.trim()) return;
    setSavingNickname(true);
    try {
      await setContactNickname(myUid, otherUid, nickname.trim());
    } catch (err) {
      setError("Failed to save nickname: " + err.message);
    }
    setSavingNickname(false);
  };

  const effectivePhotoURL = localPhotoOverride || contact?.profile?.photoURL;

  const realName = getContactRealName(contact);
  const displayName = getContactDisplayName(contact);
  const hasNickname = contact?.nickname && contact.nickname.trim();

  const safeBack = () => { try { onBack?.(); } catch { /* navigation guard */ } };

  const isAIContact = otherUid === AI_CONTACT_UID;

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 40 }}>
      {fullscreenImage && createPortal(
        <div onClick={() => setFullscreenImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 999999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", padding: 16 }}>
            <img src={fullscreenImage} alt="Full" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 12, objectFit: "contain", display: "block" }} />
          </div>
          <div onClick={() => setFullscreenImage(null)} style={{ position: "fixed", top: 16, right: 16, width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.25)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 1000000 }}>
            <X size={24} color="#fff" strokeWidth={3} />
          </div>
        </div>,
        document.body
      )}
      <div style={{ display: "flex", alignItems: "center", padding: "16px", gap: 12, background: isAIContact ? "linear-gradient(135deg, #7C5CFF, #53BDEB)" : "#111B21", flexShrink: 0 }}>
        <ChevronLeft size={22} color="#fff" onClick={safeBack} style={{ cursor: "pointer" }} />
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>{isAIContact ? "AI Profile" : "Contact Info"}</span>
      </div>
      <div className="nx-scroll">
        {isAIContact ? (
          <div style={{ padding: "28px 16px", textAlign: "center", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ width: 88, height: 88, borderRadius: "50%", background: "linear-gradient(135deg, #7C5CFF, #53BDEB)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <span style={{ fontSize: 44 }}>🤖</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 19, color: t.text }}>NexText AI</div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4 }}>Powered by Groq + Llama 3.1</div>
            <div style={{ marginTop: 14, fontSize: 13.5, color: t.text, lineHeight: 1.6, maxWidth: 280, margin: "14px auto 0" }}>
              Your intelligent chat companion. Ask questions, have fun conversations with unique personalities, or analyze your chats when AI Context is enabled.
            </div>
            <div style={{ marginTop: 18, textAlign: "left" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textMuted, marginBottom: 8, textTransform: "uppercase" }}>Capabilities</div>
              {[
                "General Q&A and research assistance",
                "6 unique personalities (Trump, Sarcastic, Robot, Shakespeare, Old Grump, Default)",
                "Chat analysis with AI Context",
                "Meta Llama 3.1 (8B) via Groq",
              ].map((cap) => (
                <div key={cap} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", fontSize: 13, color: t.text, borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.primary, flexShrink: 0 }} />
                  {cap}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, fontSize: 12.5, color: t.primary, lineHeight: 1.5, textAlign: "left" }}>
              Tip: Tap ⋮ in the chat to change personality or use AI Context for chat analysis.
            </div>
          </div>
        ) : (
        <div style={{ padding: "28px 16px", textAlign: "center", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ margin: "0 auto 12px", position: "relative", display: "inline-block" }}>
            <Avatar key={avatarNonce} photoURL={effectivePhotoURL} name={displayName} uid={otherUid} size={88} hasActiveStatus={hasOtherActiveStatus} statusViewed={otherStatusViewed} onViewPicture={() => { if (effectivePhotoURL) setFullscreenImage(effectivePhotoURL); }} />
            <input ref={localPhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLocalPhotoUpload} />
            <div onClick={() => localPhotoRef.current?.click()} style={{ position: "absolute", bottom: 0, right: 0, width: 28, height: 28, borderRadius: "50%", background: t.primary, border: `2px solid ${t.bg}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Camera size={13} color="#fff" />
            </div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 19, color: t.text }}>{displayName}</div>
          {otherUserDoc?.customStatusText && (
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4, fontStyle: "italic", maxWidth: 260 }}>{otherUserDoc.customStatusText}</div>
          )}
          {localPhotoOverride && (
            <div onClick={clearLocalPhotoOverride} style={{ fontSize: 11.5, color: t.primary, cursor: "pointer", marginTop: 4, fontWeight: 600 }}>
              {uploadingPhoto ? "Uploading…" : "Remove local photo override"}
            </div>
          )}
          {!localPhotoOverride && (
            <div onClick={() => localPhotoRef.current?.click()} style={{ fontSize: 11.5, color: t.textMuted, cursor: "pointer", marginTop: 4 }}>
              {uploadingPhoto ? "Uploading…" : "Set photo for your eyes only"}
            </div>
          )}
          {/* Nickname editor */}
          {!isSelfProfile && !isAIContact && (
            <div style={{ marginTop: 16, padding: "0 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>Nickname</span>
                <span style={{ fontSize: 11, color: t.textMuted }}>This name is only visible to you</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={realName}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14 }}
                />
                <button
                  onClick={saveNickname}
                  disabled={savingNickname || !nickname.trim()}
                  style={{ padding: "10px 16px", borderRadius: 8, background: nickname.trim() && !savingNickname ? t.primary : t.border, color: nickname.trim() && !savingNickname ? t.bubbleMeText : t.textMuted, border: "none", fontWeight: 600, fontSize: 13, cursor: nickname.trim() && !savingNickname ? "pointer" : "not-allowed" }}
                >
                  {savingNickname ? "Saving…" : "Save"}
                </button>
              </div>
              {hasNickname && (
                <div style={{ marginTop: 6, fontSize: 12, color: t.textMuted }}>
                  Real name: {realName}
                </div>
              )}
            </div>
          )}
          {!isSelfProfile && !isAIContact && (
            <div style={{ marginTop: 14, padding: "0 16px" }}>
              <div
                onClick={() => setShowContactShare(true)}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 12, border: `1px solid ${t.primary}`, background: "transparent", color: t.primary, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                <UserPlus size={17} />
                {shareSent ? "Contact shared ✓" : "Share Contact"}
              </div>
            </div>
          )}
        </div>
        )}

        {!isAIContact && (
          <div style={{ padding: "0 16px", borderBottom: `1px solid ${t.border}` }}>
            <AvatarColorPicker uid={otherUid} onChange={() => setAvatarNonce((n) => n + 1)} />
          </div>
        )}

        {error && <div style={{ color: "#FF3B30", fontSize: 12.5, padding: "10px 16px" }}>{error}</div>}
        {reportSent && <div style={{ color: t.primary, fontSize: 12.5, padding: "10px 16px" }}>Report sent to admin.</div>}

        {!isSelfProfile && !isAIContact && (
          <div style={{ display: "flex", borderBottom: `1px solid ${t.border}` }}>
            {[["media", "Media"], ["files", "Files"]].map(([key, label]) => (
              <div key={key} onClick={() => setTab(key)} style={{ flex: 1, textAlign: "center", padding: "12px", fontSize: 13.5, fontWeight: 600, color: tab === key ? t.primary : t.textMuted, borderBottom: tab === key ? `2px solid ${t.primary}` : "2px solid transparent", cursor: "pointer" }}>
                {label}
              </div>
            ))}
          </div>
        )}
        <div style={{ padding: 16 }}>
          {isSelfProfile ? (
            <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
              <div style={{ fontWeight: 600, marginBottom: 4, color: t.text }}>Your Profile</div>
              <div>This is your NexText profile. Other users see this when they view your contact info.</div>
              {otherUserDoc?.customStatusText && (
                <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: t.primaryLight, color: t.primary, fontSize: 13, fontWeight: 600, fontStyle: "italic" }}>"{otherUserDoc.customStatusText}"</div>
              )}
              {!statusBlocked && onOpenStatus && (
                <div onClick={onOpenStatus} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, padding: "12px", borderRadius: 12, background: t.primary, color: t.bubbleMeText, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  📸 Create Status Update
                </div>
              )}
            </div>
          ) : mediaLoading ? (
            <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, padding: 16 }}>Loading…</div>
          ) : sharedMedia.length === 0 ? (
            <div style={{ textAlign: "center", color: t.textMuted, fontSize: 13, padding: 16 }}>No {tab} shared yet.</div>
          ) : tab === "media" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
              {sharedMedia.map((m) => {
                const expiryText = getMediaExpiryText(m.sentAt, globalSettings?.mediaExpiryDays);
                const expired = isMediaExpired(m, globalSettings?.mediaExpiryDays);
                return (
                  <div key={m.id} style={{ position: "relative", cursor: !expired && m.type === "image" ? "pointer" : "default", aspectRatio: "1", overflow: "hidden", borderRadius: 6, background: t.border }} onClick={() => !expired && m.type === "image" && setFullscreenImage(m.mediaURL)}>
                    {expired ? (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: t.border, color: t.textMuted, fontSize: 10, fontWeight: 700 }}>Expired</div>
                    ) : m.type === "image" ? (
                      <img src={m.mediaURL} alt="Shared" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <video src={m.mediaURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                    {!expired && expiryText && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 9, padding: "2px 4px", textAlign: "center" }}>{expiryText}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sharedMedia.map((m) => {
                const expiryText = getMediaExpiryText(m.sentAt, globalSettings?.mediaExpiryDays);
                const expired = isMediaExpired(m, globalSettings?.mediaExpiryDays);
                if (expired) {
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: t.primaryLight, color: t.textMuted }}>
                      <FileText size={22} color={t.textMuted} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.fileName || "File"}</div>
                        <div style={{ fontSize: 11, fontStyle: "italic" }}>Expired</div>
                      </div>
                    </div>
                  );
                }
                return (
                  <a key={m.id} href={m.mediaURL} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: t.bubbleOtherBg, textDecoration: "none", color: t.text }}>
                    <FileText size={22} color={t.textMuted} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.fileName || "File"}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>{m.fileSizeBytes ? `${(m.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}</div>
                      {expiryText && <div style={{ fontSize: 10, opacity: 0.55, fontStyle: "italic" }}>{expiryText}</div>}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {otherUid && otherUid !== myUid && !isAIContact && (
          <div style={{ padding: 16 }}>
            <div onClick={toggleBlock} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
              <Ban size={18} color="#FF3B30" />
              <span style={{ color: "#FF3B30", fontSize: 15, fontWeight: 600 }}>{isBlocked ? `Unblock ${displayName}` : `Block ${displayName}`}</span>
            </div>
            <div onClick={submitReport} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", cursor: "pointer" }}>
              <Flag size={18} color="#FF9500" />
              <span style={{ color: "#FF9500", fontSize: 15, fontWeight: 600 }}>Report {displayName}</span>
            </div>
          </div>
        )}
      </div>
      {showContactShare && (
        <ContactSharePicker
          t={t}
          myUid={myUid}
          contacts={myContacts}
          mode="forward-to"
          shared={{ uid: otherUid, name: displayName }}
          onClose={() => setShowContactShare(false)}
          onShare={shareThisContact}
        />
      )}
    </div>
  );
}
