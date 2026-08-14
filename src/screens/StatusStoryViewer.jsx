import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Eye, Send } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useTheme } from "../theme/ThemeContext";
import { useStatusViewers } from "../firebase/status";
import { getOrCreateDirectChat, sendTextMessage } from "../firebase/chats";
import Avatar from "../components/Avatar";

const DEFAULT_DURATION_MS = 5000;
const QUICK_REACTION_EMOJIS = ["❤️", "😂", "😮", "🔥", "👍", "🙏"];

function getSlideDuration(status) {
  if (status?.durationMs && status.durationMs > 0) return status.durationMs;
  if (status?.mediaType === "video") return 10000;
  return DEFAULT_DURATION_MS;
}

function ViewersPanel({ contacts, extraProfiles, viewers, ownerName }) {
  const resolveProfile = (uid) => {
    const c = contacts?.find((ct) => ct.uid === uid);
    if (c?.profile) return c.profile;
    if (extraProfiles?.[uid]) return extraProfiles[uid];
    return null;
  };
  const resolveName = (uid) => resolveProfile(uid)?.displayName || ownerName || "Unknown";
  const resolvePhoto = (uid) => resolveProfile(uid)?.photoURL || null;

  const timeAgo = (ts) => {
    if (!ts?.toDate) return "";
    const mins = Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (viewers.length === 0) {
    return (
      <div style={{ padding: "20px 16px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
        No views yet
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 240, overflowY: "auto" }}>
      {viewers.map((v) => (
        <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px" }}>
          <Avatar photoURL={resolvePhoto(v.viewerUid)} name={resolveName(v.viewerUid)} uid={v.viewerUid} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveName(v.viewerUid)}</div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{timeAgo(v.viewedAt)}</div>
        </div>
      ))}
    </div>
  );
}

export default function StatusStoryViewer({ statuses, initialIndex = 0, myUid, ownerUid, contacts, onClose, onViewStory, onExit }) {
  const { t, appFont } = useTheme();
  const initializedRef = useRef(false);
  const completedRef = useRef(false);
  const [idx, setIdx] = useState(initialIndex);
  const [paused, setPaused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const [extraProfiles, setExtraProfiles] = useState({});
  const [completedIndices, setCompletedIndices] = useState(new Set());
  const touchStartRef = useRef({ x: 0, y: 0 });

  const fullUnmount = useCallback(() => {
    completedRef.current = true;
    setIdx(0);
    setPaused(false);
    setShowViewers(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (videoRef.current) { try { videoRef.current.pause(); } catch { /* noop */ } }
    if (bgAudioRef.current) { try { bgAudioRef.current.pause(); } catch { /* noop */ } }
    if (onExit) onExit();
    else onClose?.();
  }, [onExit, onClose]);

  const barRef = useRef(null);
  const progressRef = useRef(0);
  const timerRef = useRef(null);
  const advanceRef = useRef(null);
  const videoRef = useRef(null);
  const bgAudioRef = useRef(null);
  const initialAnimDoneRef = useRef(false);

  const isOwner = myUid && ownerUid && myUid === ownerUid;
  const current = statuses[idx];
  // Once the video's real length is known from its metadata, the auto-timer
  // tracks THAT instead of the stored durationMs (which can be an estimate or
  // a 10s fallback when metadata wasn't readable at post time).
  const [liveVideoDuration, setLiveVideoDuration] = useState(null);
  useEffect(() => { setLiveVideoDuration(null); }, [idx]);
  const duration = current?.mediaType === "video" && liveVideoDuration ? liveVideoDuration : getSlideDuration(current);

  // Loop breaker + clean mount reset: reset the active index timer state to
  // zero on mount, clearing any stray timers so the first slide's filling line
  // starts from 0% with a smooth linear transition (never snaps to 100%).
  useEffect(() => {
    completedRef.current = false;
    progressRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!initializedRef.current) {
      initializedRef.current = true;
      setIdx(initialIndex);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bounds check: if idx exceeds statuses length (statuses changed), clamp it
  useEffect(() => {
    if (statuses.length > 0 && idx >= statuses.length) {
      setIdx(statuses.length - 1);
    }
    // Prune completed indices that are now out of bounds
    setCompletedIndices((prev) => {
      const next = new Set(prev);
      for (const i of next) {
        if (i >= statuses.length) next.delete(i);
      }
      return next;
    });
  }, [statuses.length, idx]);

  const viewers = useStatusViewers(current?.id);

  const ownerInContacts = contacts?.find((ct) => ct.uid === ownerUid);
  const ownerProfile = ownerInContacts?.profile || extraProfiles[ownerUid];
  const ownerName = ownerProfile?.displayName || ownerUid?.slice(0, 6) || "Unknown";
  const ownerPhoto = ownerProfile?.photoURL || null;

  useEffect(() => {
    if (!ownerUid) return;
    if (ownerInContacts?.profile) return;
    if (extraProfiles[ownerUid]) return;
    let cancelled = false;
    getDoc(doc(db, "users", ownerUid)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const data = snap.data();
      setExtraProfiles((prev) => ({ ...prev, [ownerUid]: { displayName: data.displayName, photoURL: data.photoURL } }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ownerUid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewers?.length) return;
    const missing = viewers.filter((v) => {
      if (v.viewerUid === myUid) return false;
      if (contacts?.some((ct) => ct.uid === v.viewerUid && ct.profile)) return false;
      if (extraProfiles[v.viewerUid]) return false;
      return true;
    });
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map((v) => getDoc(doc(db, "users", v.viewerUid)).then((s) => ({ uid: v.viewerUid, data: s.exists() ? s.data() : null })))).then((results) => {
      if (cancelled) return;
      setExtraProfiles((prev) => {
        const next = { ...prev };
        results.forEach(({ uid, data }) => { if (data) next[uid] = { displayName: data.displayName, photoURL: data.photoURL }; });
        return next;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [viewers, myUid]); // eslint-disable-line react-hooks/exhaustive-deps

  advanceRef.current = () => {
    if (completedRef.current) return;
    if (idx < statuses.length - 1) {
      // Force skipped bar to 100% instantly before advancing
      if (barRef.current) {
        barRef.current.style.transition = "none";
        barRef.current.style.width = "100%";
      }
      // Mark current index as completed
      setCompletedIndices((prev) => {
        const next = new Set(prev);
        next.add(idx);
        return next;
      });
      setIdx((i) => i + 1);
      progressRef.current = 0;
    } else {
      completedRef.current = true;
      setCompletedIndices((prev) => {
        const next = new Set(prev);
        next.add(idx);
        return next;
      });
      if (onViewStory) onViewStory();
      onClose();
    }
  };

  const goBack = useCallback(() => {
    // Explicit cleanup: clear any pending advance timer so revisiting a prior
    // slide never leaves a parallel timeline bar sliding simultaneously.
    if (timerRef.current) clearTimeout(timerRef.current);
    progressRef.current = 0;
    // The slide we're leaving becomes an "ahead" bar (width 0%) on the next
    // render. Kill its transition BEFORE the width change lands so it snaps
    // instantly to EMPTY (0%) on the previous slide — going back means those
    // slides are unviewed again, so their bars must read empty, never filled.
    if (barRef.current) {
      barRef.current.style.transition = "none";
      barRef.current.style.width = "0%";
    }
    // Unmark current index as completed (we didn't finish it)
    setCompletedIndices((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
    if (idx > 0) {
      setIdx((i) => i - 1);
    } else {
      if (barRef.current) {
        barRef.current.style.transition = "none";
        barRef.current.style.width = "0%";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (barRef.current) {
              barRef.current.style.transition = `width ${duration}ms linear`;
              barRef.current.style.width = "100%";
            }
          });
        });
      }
      timerRef.current = setTimeout(() => advanceRef.current?.(), duration);
    }
  }, [idx, duration]);

  useEffect(() => {
    if (!current) return;
    progressRef.current = 0;
    setPaused(false);
    setShowViewers(false);
    initialAnimDoneRef.current = false;

    if (barRef.current) {
      barRef.current.style.transition = "none";
      barRef.current.style.width = "0%";
    }
    const isWaitVideo = current?.mediaType === "video" && current?.waitForVideo;
    if (!isWaitVideo) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (barRef.current) {
            barRef.current.style.transition = `width ${duration}ms linear`;
            barRef.current.style.width = "100%";
            initialAnimDoneRef.current = true;
          }
        });
      });
    } else {
      initialAnimDoneRef.current = true;
    }

    clearTimeout(timerRef.current);
    if (isWaitVideo) {
      // Wait for the video to end before advancing (driven by onEnded).
      // Safety cap so a stuck/blocked video never hangs the story forever.
      timerRef.current = setTimeout(() => advanceRef.current?.(), Math.max(60000, duration + 5000));
    } else {
      timerRef.current = setTimeout(() => advanceRef.current?.(), duration);
    }

    if (current.mediaType === "video" && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }

    return () => clearTimeout(timerRef.current);
  }, [idx, duration, current?.mediaType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!barRef.current || !initialAnimDoneRef.current) return;
    if (paused) {
      barRef.current.style.transition = "none";
      barRef.current.style.width = `${progressRef.current}%`;
      clearTimeout(timerRef.current);
    } else {
      const isWaitVideo = current?.mediaType === "video" && current?.waitForVideo;
      if (!isWaitVideo) {
        const remainingMs = ((100 - progressRef.current) / 100) * duration;
        barRef.current.style.transition = `width ${remainingMs}ms linear`;
        barRef.current.style.width = "100%";
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => advanceRef.current?.(), Math.max(remainingMs, 50));
      }
    }
  }, [paused, duration]);

  useEffect(() => {
    if (current?.mediaType !== "video" || !videoRef.current) return;
    const v = videoRef.current;
    v.volume = (current.videoVolume ?? 100) / 100;
    if (paused) {
      v.pause();
      if (bgAudioRef.current) bgAudioRef.current.pause();
    } else {
      v.play().catch(() => {});
      if (bgAudioRef.current) bgAudioRef.current.play().catch(() => {});
    }
  }, [paused, current?.mediaType, current?.videoVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!current?.bgAudioURL || !bgAudioRef.current) return;
    const audio = bgAudioRef.current;
    audio.volume = (current.bgAudioVolume || 70) / 100;
    if (!paused) audio.play().catch(() => {});
    return () => { audio.pause(); audio.currentTime = 0; };
  }, [current?.bgAudioURL, current?.bgAudioVolume, idx, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendReply = async (text) => {
    if (!text?.trim() || !myUid || !ownerUid || isOwner) return;
    setSending(true);
    try {
      const chatId = await getOrCreateDirectChat(myUid, ownerUid);
      const statusRef = {
        statusId: current.id,
        ownerUid,
        slideIndex: idx,
        mediaURL: current.mediaURL || null,
        mediaType: current.mediaType || null,
        text: current.text || null,
        createdAt: current.createdAt,
        expiresAt: current.expiresAt || null,
      };
      await sendTextMessage(chatId, myUid, text.trim(), [ownerUid], { statusRef });
      setReplySent(true);
      setReplyText("");
      setTimeout(() => setReplySent(false), 2000);
    } catch { /* silent */ }
    setSending(false);
  };

  if (!statuses[idx]) return null;

  const timeAgo = (ts) => {
    if (!ts?.toDate) return "";
    const mins = Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const bg = current.backgroundColor || (current.mediaType === "image" || current.mediaType === "video" ? "#000" : t.primary);

  return createPortal(
    <div
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: bg, zIndex: 300, display: "flex", flexDirection: "column", userSelect: "none" }}
      onTouchStart={(e) => { touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
        const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
          if (dx < 0 && idx < statuses.length - 1) {
            advanceRef.current?.();
          } else if (dx > 0 && idx > 0) {
            goBack();
          }
        } else if (Math.abs(dy) > 80 && dy > 0) {
          onClose();
        }
      }}
    >
      <div style={{ display: "flex", gap: 3, padding: "10px 12px 0", position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, overflow: "hidden" }}>
        {statuses.map((s, i) => (
          <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
            {completedIndices.has(i) ? (
              <div style={{ height: "100%", borderRadius: 2, background: "#00A884", width: "100%" }} />
            ) : i === idx ? (
              <div ref={barRef} style={{ height: "100%", borderRadius: 2, background: "#00A884", width: "0%" }} />
            ) : (
              <div style={{ height: "100%", borderRadius: 2, background: "#00A884", width: "0%" }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 14px 8px", position: "absolute", top: 6, left: 0, right: 0, zIndex: 10 }}>
        <Avatar photoURL={ownerPhoto} name={ownerName} uid={ownerUid} size={36} hideLocalOverride />
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{ownerName}</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11.5 }}>{timeAgo(current.createdAt)}</div>
        </div>
        <X size={22} color="#fff" onClick={(e) => { e.stopPropagation(); e.preventDefault(); fullUnmount(); }} style={{ cursor: "pointer" }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px 40px", boxSizing: "border-box", overflow: "hidden" }}>
        {current.bgAudioURL && <audio ref={bgAudioRef} src={current.bgAudioURL} loop />}
        {current.mediaType === "video" && current.mediaURL ? (
          <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <video ref={videoRef} src={current.mediaURL} playsInline loop={false}
              onLoadedMetadata={(e) => { const ms = Math.round(e.target.duration * 1000); if (ms > 0) setLiveVideoDuration(ms); }}
              onTimeUpdate={(e) => {
                if (!current?.waitForVideo) return;
                const v = e.target;
                if (v.duration && v.currentTime != null) {
                  progressRef.current = (v.currentTime / v.duration) * 100;
                  if (barRef.current) {
                    barRef.current.style.transition = "none";
                    barRef.current.style.width = `${progressRef.current}%`;
                  }
                }
              }}
              onEnded={() => { setLiveVideoDuration(Math.max(liveVideoDuration || 0, 1)); advanceRef.current?.(); }}
              style={{ width: "100%", height: "100%", borderRadius: 8, objectFit: "contain" }} />
            {(current.textOverlay || current.text) && (
              <div style={{ position: "absolute", bottom: 16, left: 12, right: 12, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
                {current.textOverlay || current.text}
              </div>
            )}
          </div>
        ) : current.mediaType === "image" && current.mediaURL ? (
          <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <img src={current.mediaURL} alt="Status" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 8 }} />
            {(current.textOverlay || current.text) && (
              <div style={{ position: "absolute", bottom: 16, left: 12, right: 12, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
                {current.textOverlay || current.text}
              </div>
            )}
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px 90px", boxSizing: "border-box" }}>
            <div style={{ color: "#fff", fontWeight: 700, textAlign: "center", lineHeight: 1.3, fontFamily: current.fontFamily || appFont, width: "100%", boxSizing: "border-box", wordBreak: "break-word", overflowY: "auto", maxHeight: "100%", fontSize: Math.max(30, Math.min(64, Math.round(200 / Math.max(1, (current.text || "No text").length / 3)))) }}>
              {current.text || "No text"}
            </div>
          </div>
        )}
      </div>

      {!showViewers && (
        <div style={{ position: "absolute", inset: 0, display: "flex", zIndex: 5 }}>
          <div onClick={goBack} style={{ flex: 1, cursor: "pointer" }} />
          <div
            onMouseDown={() => setPaused(true)}
            onMouseUp={() => setPaused(false)}
            onMouseLeave={() => { if (paused) setPaused(false); }}
            onTouchStart={() => setPaused(true)}
            onTouchEnd={() => setPaused(false)}
            style={{ flex: 1, cursor: "pointer" }}
          />
          <div onClick={() => advanceRef.current?.()} style={{ flex: 1, cursor: "pointer" }} />
        </div>
      )}

      {!showViewers && idx > 0 && (
        <div onClick={goBack} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 12 }}>
          <ChevronLeft size={18} color="#fff" />
        </div>
      )}
      {!showViewers && idx < statuses.length - 1 && (
        <div onClick={() => advanceRef.current?.()} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 12 }}>
          <ChevronRight size={18} color="#fff" />
        </div>
      )}

      {paused && !showViewers && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 60, height: 60, borderRadius: "50%", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 15 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ width: 8, height: 24, borderRadius: 2, background: "#fff" }} />
            <div style={{ width: 8, height: 24, borderRadius: 2, background: "#fff" }} />
          </div>
        </div>
      )}

      {isOwner && !showViewers && (
        <div onClick={() => { setShowViewers(true); setPaused(true); }} style={{ position: "absolute", bottom: 20, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, zIndex: 20, cursor: "pointer" }}>
          <Eye size={16} color="#fff" />
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>Viewers</span>
        </div>
      )}

      {isOwner && showViewers && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.85)", borderRadius: "16px 16px 0 0", zIndex: 25, paddingBottom: 20 }}>
          <div onClick={() => { setShowViewers(false); setPaused(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 0 6px", cursor: "pointer" }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.3)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <Eye size={16} color="#fff" />
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Viewed by</span>
          </div>
          <ViewersPanel contacts={contacts} extraProfiles={extraProfiles} viewers={viewers} ownerName={ownerName} />
        </div>
      )}

      {!isOwner && !showViewers && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px 16px", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", zIndex: 20 }}>
          {replySent ? (
            <div style={{ textAlign: "center", color: "#00A884", fontSize: 13, fontWeight: 600, padding: "10px 0" }}>Reply sent!</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {QUICK_REACTION_EMOJIS.map((emoji) => (
                  <span key={emoji} onClick={() => handleSendReply(emoji)} style={{ fontSize: 20, cursor: "pointer", opacity: sending ? 0.4 : 1 }}>{emoji}</span>
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "6px 10px 6px 14px", gap: 6 }}>
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSendReply(replyText); }}
                  placeholder="Reply…"
                  disabled={sending}
                  style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13.5, color: "#fff" }}
                />
                {replyText.trim() && (
                  <Send size={16} color="#00A884" onClick={() => handleSendReply(replyText)} style={{ cursor: "pointer", flexShrink: 0 }} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
