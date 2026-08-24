import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Eye, User, Image as ImageIcon, Info } from "lucide-react";
import { getAvatarColor, getAvatarStyle, lightenColor, getAvatarInitial } from "../utils/avatarColors";
import { useAIIconStyle } from "../services/aiIcon";
import { AI_CONTACT_UID } from "../firebase/ai";

const LOCAL_OVERRIDE_KEY = "nextext_contact_photo_overrides";
export function getLocalPhotoOverride(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(LOCAL_OVERRIDE_KEY);
    if (!raw) return null;
    const overrides = JSON.parse(raw);
    return overrides[uid] || null;
  } catch { return null; }
}

// Renders the inner circle for the AI assistant avatar based on the chosen
// style (see src/services/aiIcon.js). Returns a style object + the label.
export function aiAvatarInner(aiStyle, size, fontSize) {
  const base = {
    width: size, height: size, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize, fontWeight: 800, color: "#fff", userSelect: "none",
  };
  switch (aiStyle) {
    case "ai-letters":
      return { style: { ...base, background: "#0B141A", color: "#10B981", letterSpacing: 1, fontStyle: "italic" }, label: "AI" };
    case "neon":
      return { style: { ...base, background: "#06141A", color: "#39FF14", textShadow: "0 0 8px #39FF14, 0 0 16px #39FF14" }, label: "AI" };
    case "gradient":
      return { style: { ...base, background: "linear-gradient(135deg, #10B981, #00A884 60%, #25D366)", color: "#fff" }, label: "AI" };
    case "mono":
      return { style: { ...base, background: "#111111", color: "#EDEDED" }, label: "AI" };
    default:
      return { style: { ...base, background: "#10B981", color: "#fff" }, label: "AI" };
  }
}

// Global avatar-menu coordination: only one 3-button menu may be open at a
// time anywhere in the app. Opening any avatar broadcasts its uid so every
// other open menu clears instantly (auto-dismiss).
let activeAvatarMenuUid = null;
const avatarMenuListeners = new Set();
function broadcastAvatarMenu(openUid) {
  activeAvatarMenuUid = openUid;
  avatarMenuListeners.forEach((fn) => fn(openUid));
}

export default React.memo(function Avatar({ photoURL, name, uid, size = 52, style = {}, hasActiveStatus = false, statusViewed = false, onStatusView, onViewProfile, onViewPicture, onViewGroupInfo, hideLocalOverride = false, blockStatus = false }) {
  const [showMenu, setShowMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const avatarRef = useRef(null);
  const menuContentRef = useRef(null);
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const localOverride = hideLocalOverride ? null : getLocalPhotoOverride(uid);
  const effectivePhotoURL = localOverride || photoURL;
  const bg = getAvatarColor(uid || name || "");
  const bgStyle = getAvatarStyle(uid || name || "") === "gradient"
    ? { background: `linear-gradient(135deg, ${lightenColor(bg, 0.25)}, ${bg})` }
    : { background: bg };
  const initial = getAvatarInitial(name);
  const fontSize = Math.round(size * 0.38);
  const aiStyle = useAIIconStyle();
  const isAI = uid === AI_CONTACT_UID;
  const ringPad = hasActiveStatus ? 3 : 0;
  const outerSize = size + ringPad * 2;
  const hasPhoto = !!effectivePhotoURL;
  const ringColor = statusViewed ? "rgba(0,168,132,0.35)" : "#00A884";

  // Auto-dismiss: when another avatar opens its menu, close this one.
  useEffect(() => {
    const fn = (openUid) => { if (openUid && openUid !== uidRef.current) setShowMenu(false); };
    avatarMenuListeners.add(fn);
    return () => avatarMenuListeners.delete(fn);
  }, []);

  // Escape key dismiss
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showMenu]);

  // Close menu when navigating away or clicking anywhere outside
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e) => {
      if (menuContentRef.current && !menuContentRef.current.contains(e.target)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [showMenu]);

  const handleClick = (e) => {
    e.stopPropagation();
    broadcastAvatarMenu(uid);
    setShowMenu(true);
  };

  const closeMenu = () => {
    if (activeAvatarMenuUid === uid) broadcastAvatarMenu(null);
    setShowMenu(false);
  };

  const handleMenuStatus = (e) => {
    e.stopPropagation();
    closeMenu();
    if (onStatusView) onStatusView();
  };

  const handleMenuProfile = (e) => {
    e.stopPropagation();
    closeMenu();
    if (onViewProfile) onViewProfile();
  };

  const handleMenuGroupInfo = (e) => {
    e.stopPropagation();
    closeMenu();
    if (onViewGroupInfo) onViewGroupInfo();
  };

  const handleMenuPicture = (e) => {
    e.stopPropagation();
    closeMenu();
    if (onViewPicture && hasPhoto) {
      onViewPicture();
    } else {
      setFullscreen(true);
    }
  };

  const avatarNode = (
    <div
      ref={avatarRef}
      onClick={handleClick}
      className="nx-avatar-thumb"
      style={{
        width: outerSize, height: outerSize, borderRadius: "50%",
        background: hasActiveStatus ? ringColor : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, cursor: "pointer", position: "relative",
        overflow: "hidden", ...style,
      }}
    >
      {isAI ? (
        (() => { const a = aiAvatarInner(aiStyle, size, fontSize); return <div style={a.style}>{a.label}</div>; })()
      ) : effectivePhotoURL ? (
        <img src={effectivePhotoURL} alt={name || "avatar"} className="nx-avatar-thumb" style={{ width: size, height: size, objectFit: "cover" }} />
      ) : (
        <div style={{ width: size, height: size, borderRadius: "50%", ...bgStyle, display: "flex", alignItems: "center", justifyContent: "center", fontSize, fontWeight: 700, color: "#fff", userSelect: "none" }}>
          {initial}
        </div>
      )}
    </div>
  );

  return (
    <>
      {avatarNode}
      {showMenu && createPortal(
        <div onClick={closeMenu} style={{ position: "fixed", inset: 0, zIndex: 99998 }}>
          <div ref={menuContentRef} onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "rgba(30,30,30,0.97)", borderRadius: 12, overflowY: "auto", maxHeight: "70vh", zIndex: 99999, boxShadow: "0 8px 30px rgba(0,0,0,0.5)", minWidth: 200, whiteSpace: "nowrap", WebkitOverflowScrolling: "touch" }}>
            {hasActiveStatus && onStatusView && !blockStatus && (
              <div onClick={handleMenuStatus} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
                <Eye size={16} color="#00A884" />
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>View Status</span>
              </div>
            )}
            {onViewGroupInfo && (
              <div onClick={handleMenuGroupInfo} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: (hasActiveStatus && onStatusView && !blockStatus) ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
                <Info size={16} color="#8E8E93" />
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>View Group Info</span>
              </div>
            )}
            {!onViewGroupInfo && onViewProfile && (
              <div onClick={handleMenuProfile} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: (hasActiveStatus && onStatusView && !blockStatus) ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
                <User size={16} color="#8E8E93" />
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>View Profile</span>
              </div>
            )}
            <div onClick={handleMenuPicture} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", borderTop: (hasActiveStatus && onStatusView && !blockStatus) || onViewProfile || onViewGroupInfo ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
              <ImageIcon size={16} color="#8E8E93" />
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{hasPhoto ? "View Profile Picture" : (onViewGroupInfo ? "View Group Picture" : "View Avatar")}</span>
            </div>
          </div>
        </div>,
        document.body
      )}
      {fullscreen && createPortal(
        <div onClick={() => setFullscreen(false)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.95)", zIndex: 999999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <div style={{ position: "absolute", top: 16, right: 16, zIndex: 1000001 }}>
            <div onClick={(e) => { e.stopPropagation(); setFullscreen(false); }} style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.25)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={24} color="#fff" strokeWidth={3} />
            </div>
          </div>
          {effectivePhotoURL ? (
            <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 16px 40px", boxSizing: "border-box" }}>
              <img src={effectivePhotoURL} alt={name || "avatar"} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", borderRadius: 8, objectFit: "contain", display: "block" }} onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }} />
              <div style={{ display: "none", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "#111b21" }}>
                <span style={{ fontSize: "min(200px, 40vw)", fontWeight: 700, color: "#fff", userSelect: "none" }}>{initial}</span>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#111b21" }}>
              <span style={{ fontSize: "min(200px, 40vw)", fontWeight: 700, color: "#fff", userSelect: "none" }}>{initial}</span>
            </div>
          )}
          {name && (
            <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, color: "#fff", fontSize: 16, fontWeight: 600, textAlign: "center", maxWidth: "90%", margin: "0 auto" }}>{name}</div>
          )}
        </div>,
        document.body
      )}
    </>
  );
});
