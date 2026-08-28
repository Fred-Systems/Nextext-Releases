import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Eye, Send, Download, Volume2, VolumeX, MessageCircle, RefreshCw } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useTheme } from "../theme/ThemeContext";
import { useStatusViewers, subscribeStatusComments, addStatusComment, voteStatusComment, deleteStatusComment, setStatusCommentsHidden, retryStatus } from "../firebase/status";
import { getOrCreateDirectChat, sendTextMessage } from "../firebase/chats";
import Avatar from "../components/Avatar";
import ZoomableMedia from "../components/ZoomableMedia";
import HlsVideo from "../components/HlsVideo";
import { getSignedUrl } from "../supabase/media";
import NextextNative from "../native/nextextNative";
import { Capacitor } from "@capacitor/core";

const DEFAULT_DURATION_MS = 5000;
const QUICK_REACTION_EMOJIS = ["❤️", "😂", "😮", "🔥", "👍", "🙏"];

function getSlideDuration(status) {
  if (status?.durationMs && status.durationMs > 0) return status.durationMs;
  if (status?.mediaType === "video") return 10000;
  if (status?.mediaType === "voice") return status?.durationMs || 10000;
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

export default function StatusStoryViewer({ statuses, initialIndex = 0, myUid, ownerUid, contacts, onClose, onViewStory, onNext, onExit }) {
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
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const SPEED_PRESETS = [1, 1.5, 2, 3];
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Pause status playback while comments are open (resume when closed).
  useEffect(() => { setPaused(showComments); }, [showComments]);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const pressTimerRef = useRef(null);
  const holdFiredRef = useRef(false);
  const pressStartRef = useRef(0);

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
  const barRefs = useRef([]);
  const progressRef = useRef(0);
  const timerRef = useRef(null);
  const advanceRef = useRef(null);
  const videoRef = useRef(null);
  const voiceRef = useRef(null);
  const bgAudioRef = useRef(null);
  const initialAnimDoneRef = useRef(false);

  const isOwner = myUid && ownerUid && myUid === ownerUid;
  const current = statuses[idx];
  const [hlsUrl, setHlsUrl] = useState(null);
  const [fallbackUrl, setFallbackUrl] = useState(null);
  const [posterUrl, setPosterUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!current) { setHlsUrl(null); setFallbackUrl(null); setPosterUrl(null); return; }
      // Only expose HLS/fallback when ready; while processing/queued show poster or processing UI
      if (current.state && current.state !== "ready") { setHlsUrl(null); setFallbackUrl(null); setPosterUrl(null); return; }
      try {
        if (current.hlsMasterPath) {
          const u = await getSignedUrl(current.hlsMasterPath, current.expiresAt);
          if (!cancelled) setHlsUrl(u);
        } else setHlsUrl(null);
        if (current.fallbackPath) {
          const u = await getSignedUrl(current.fallbackPath, current.expiresAt);
          if (!cancelled) setFallbackUrl(u);
        } else setFallbackUrl(null);
        if (current.posterPath) {
          const u = await getSignedUrl(current.posterPath, current.expiresAt);
          if (!cancelled) setPosterUrl(u);
        } else setPosterUrl(null);
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, [current?.id, current?.state, current?.hlsMasterPath, current?.fallbackPath, current?.posterPath, current?.expiresAt]);

  // Live comments for the current status.
  useEffect(() => {
    if (!current?.id) { setComments([]); return; }
    const unsub = subscribeStatusComments(current.id, setComments);
    return unsub;
  }, [current?.id]);

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text || postingComment || !current?.id) return;
    setPostingComment(true);
    try { await addStatusComment(current.id, myUid, text); setCommentText(""); }
    catch (e) { console.warn("comment failed", e); }
    finally { setPostingComment(false); }
  };
  // Once the video's real length is known from its metadata, the auto-timer
  // tracks THAT instead of the stored durationMs (which can be an estimate or
  // a 10s fallback when metadata wasn't readable at post time).
  const [liveVideoDuration, setLiveVideoDuration] = useState(null);
  useEffect(() => { setLiveVideoDuration(null); }, [idx]);
  const duration = (current?.mediaType === "video" || current?.mediaType === "voice") && liveVideoDuration ? liveVideoDuration : getSlideDuration(current);

  // Mark this slide as "viewed" (green circle) after the user has seen even a
  // second of it — matching WhatsApp behaviour, where a partially-watched story
  // segment is no longer shown as unread.
  useEffect(() => {
    if (!current) return;
    const tmo = setTimeout(() => {
      setCompletedIndices((prev) => {
        if (prev.has(idx)) return prev;
        const n = new Set(prev);
        n.add(idx);
        return n;
      });
    }, 1000);
    return () => clearTimeout(tmo);
  }, [idx, current?.id]);

  // Tap = advance to next; press-and-hold = pause (release resumes). A horizontal
  // swipe still goes back/forward and a downward swipe closes.
  const startPress = (clientX, clientY, multiTouch) => {
    if (multiTouch) {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      holdFiredRef.current = false;
      return;
    }
    touchStartRef.current = { x: clientX, y: clientY };
    pressStartRef.current = Date.now();
    holdFiredRef.current = false;
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => { holdFiredRef.current = true; setPaused(true); }, 200);
  };
  const endPress = (clientX, clientY) => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    const dx = clientX - touchStartRef.current.x;
    const dy = clientY - touchStartRef.current.y;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && idx < statuses.length - 1) advanceRef.current?.();
      else if (dx > 0 && idx > 0) goBack();
      return;
    }
    if (Math.abs(dy) > 80 && dy > 0) { onClose(); return; }
    if (holdFiredRef.current) {
      setPaused(false); // resume after hold-to-pause
    } else {
      advanceRef.current?.(); // quick tap -> next status
    }
  };

  // Loop breaker + clean mount reset: reset the active index timer state to
  // zero on mount, clearing any stray timers so the first slide's filling line
  // starts from 0% with a smooth linear transition (never snaps to 100%).
  // Also clear the completed-indices set: when the user closes and re-opens
  // a user's story, the new run starts fresh (no "already-viewed" fill on
  // the very first slide), and previous-viewer state doesn't leak across
  // different story owners.
  useEffect(() => {
    completedRef.current = false;
    progressRef.current = 0;
    initializedRef.current = false;
    setCompletedIndices(new Set());
    setPaused(false);
    setShowViewers(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (videoRef.current) { try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch { /* noop */ } }
    if (bgAudioRef.current) { try { bgAudioRef.current.pause(); bgAudioRef.current.currentTime = 0; } catch { /* noop */ } }
    setIdx(initialIndex);
    initializedRef.current = true;
  }, [ownerUid]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (onNext) {
        onNext();
      } else {
        if (onViewStory) onViewStory();
        onClose();
      }
    }
  };

  const goBack = useCallback(() => {
    // Explicit cleanup: clear any pending advance timer so revisiting a prior
    // slide never leaves a parallel timeline bar sliding simultaneously.
    if (timerRef.current) clearTimeout(timerRef.current);
    progressRef.current = 0;
    // Going back means every slide from the destination onward is "unviewed"
    // again — keep completed only for slides strictly BEFORE the destination so
    // the destination (and everything after it) resets and re-animates from 0%.
    setCompletedIndices((prev) => {
      const next = new Set();
      for (const i of prev) if (i < idx - 1) next.add(i);
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
    // Reset every OTHER bar via the refs array so stale direct-mutated widths
    // don't linger: slides behind the current read full (already viewed),
    // slides ahead read empty (not yet viewed) and never animate until shown.
    barRefs.current.forEach((el, i) => {
      if (!el || i === idx) return;
      el.style.transition = "none";
      el.style.width = completedIndices.has(i) ? "100%" : "0%";
    });
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

    if (current.mediaType === "voice" && voiceRef.current) {
      voiceRef.current.currentTime = 0;
      voiceRef.current.play().catch(() => {});
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
    v.muted = muted;
    v.playbackRate = speed;
    if (paused) {
      v.pause();
      if (bgAudioRef.current) bgAudioRef.current.pause();
    } else {
      v.play().catch(() => {});
      if (bgAudioRef.current) bgAudioRef.current.play().catch(() => {});
    }
  }, [paused, current?.mediaType, current?.videoVolume, muted, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (current?.mediaType !== "voice" || !voiceRef.current) return;
    const a = voiceRef.current;
    if (paused) {
      a.pause();
      if (bgAudioRef.current) bgAudioRef.current.pause();
    } else {
      a.play().catch(() => {});
      if (bgAudioRef.current) bgAudioRef.current.play().catch(() => {});
    }
  }, [paused, current?.mediaType]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleDownload = async () => {
    const urlToFetch = fallbackUrl || posterUrl || hlsUrl || current?.mediaURL || current?.bgAudioURL;
    if (!urlToFetch) return;
    setDownloading(true);
    try {
      const resp = await fetch(urlToFetch);
      const blob = await resp.blob();
      const ext = current.mediaType === "video" ? "mp4" : current.mediaType === "voice" ? "webm" : current.mediaType === "image" ? "jpg" : "bin";
      const fileName = `nextext-status-${current.id}.${ext}`;
      const mimeType = blob.type || "application/octet-stream";
      // Native download path (Capacitor WebView) — anchor downloads don't work reliably
      if (Capacitor.isNativePlatform() && NextextNative.saveToDownloads) {
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = reader.result.split(",")[1];
          try { await NextextNative.saveToDownloads({ data: b64, fileName, mimeType }); } catch {}
          setDownloading(false);
        };
        reader.onerror = () => { setDownloading(false); };
        reader.readAsDataURL(blob);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setDownloading(false);
      }
    } catch { /* best effort */ }
    setDownloading(false);
  };

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
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: bg, zIndex: 300, display: "flex", flexDirection: "column", userSelect: "none" }}
      onTouchStart={(e) => { startPress(e.touches[0].clientX, e.touches[0].clientY, e.touches.length > 1); }}
      onTouchEnd={(e) => { endPress(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }}
    >
      <div style={{ display: "flex", gap: 3, padding: "10px 12px 0", position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, overflow: "hidden" }}>
        {statuses.map((s, i) => (
          <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
            {completedIndices.has(i) ? (
              <div ref={(el) => { barRefs.current[i] = el; }} style={{ height: "100%", borderRadius: 2, background: "#00A884", width: "100%" }} />
            ) : i === idx ? (
              <div ref={(el) => { barRef.current = el; barRefs.current[i] = el; }} style={{ height: "100%", borderRadius: 2, background: "#00A884", width: "0%" }} />
            ) : (
              <div ref={(el) => { barRefs.current[i] = el; }} style={{ height: "100%", borderRadius: 2, background: "#00A884", width: "0%" }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 14px 8px", position: "absolute", top: 6, left: 0, right: 0, zIndex: 10 }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
        <Avatar photoURL={ownerPhoto} name={ownerName} uid={ownerUid} size={36} hideLocalOverride />
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{ownerName}</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11.5 }}>{timeAgo(current.createdAt)}</div>
        </div>
        <X size={22} color="#fff" onClick={(e) => { e.stopPropagation(); e.preventDefault(); fullUnmount(); }} style={{ cursor: "pointer" }} />
        {!(current.commentsHidden && !isOwner) && (
          <div
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowComments((v) => !v); }}
            style={{ position: "relative", cursor: "pointer", flexShrink: 0 }}
          >
            <MessageCircle size={21} color="#fff" />
            {current.commentCount > 0 && (
              <span style={{ position: "absolute", top: -6, right: -8, background: "#00A884", color: "#fff", fontSize: 10, fontWeight: 700, minWidth: 15, height: 15, borderRadius: 8, padding: "0 3px", display: "flex", alignItems: "center", justifyContent: "center" }}>{current.commentCount}</span>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px 40px", boxSizing: "border-box", overflow: "hidden" }}>
        {current.bgAudioURL && <audio ref={bgAudioRef} src={current.bgAudioURL} loop />}
        {(current.state === "queued" || current.state === "processing") ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "#fff" }}>
            <RefreshCw size={28} color="#fff" style={{ animation: "nextext-spin 1s linear infinite" }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Processing video…</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>This will be ready shortly</span>
          </div>
        ) : current.state === "failed" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "#fff", textAlign: "center", padding: 20 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Video failed: {current.errorCode || "PROCESSING_FAILED"}</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{current.errorMessage || "Try a different video."}</span>
            {isOwner && <button onClick={() => retryStatus(current.id)} style={{ marginTop: 8, padding: "8px 16px", borderRadius: 8, border: "none", background: "#00A884", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Retry</button>}
          </div>
        ) : current.mediaType === "video" && (current.mediaURL || hlsUrl || fallbackUrl) ? (
          hlsUrl ? (
            <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {/* Show lightweight preview loop if available; otherwise full HLS */}
              {current.previewURL && !liveVideoDuration ? (
                <video
                  ref={videoRef}
                  src={current.previewURL}
                  loop
                  muted
                  autoPlay
                  playsInline
                  poster={posterUrl || current.posterURL || undefined}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  onLoadedMetadata={(e) => { const ms = Math.round(e.target.duration * 1000); if (ms > 0) setLiveVideoDuration(ms); }}
                />
              ) : (
                <HlsVideo
                  src={hlsUrl}
                  fallbackSrc={fallbackUrl || current.mediaURL}
                  poster={posterUrl || current.posterURL || undefined}
                  videoRef={videoRef}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  controls={false}
                  onLoadedMetadata={(e) => { const ms = Math.round(e.target.duration * 1000); if (ms > 0) setLiveVideoDuration(ms); }}
                  onEnded={() => { setLiveVideoDuration(Math.max(liveVideoDuration || 0, 1)); advanceRef.current?.(); }}
                />
              )}
              {(current.textOverlay || current.text) && (
                <div style={{ position: "absolute", bottom: 16, left: 12, right: 12, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
                  {current.textOverlay || current.text}
                </div>
              )}
            </div>
          ) : (
          <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <ZoomableMedia
              src={fallbackUrl || current.mediaURL}
              type="video"
              mediaRef={videoRef}
              onTap={() => {}}
              videoProps={{
                loop: false,
                onLoadedMetadata: (e) => { const ms = Math.round(e.target.duration * 1000); if (ms > 0) setLiveVideoDuration(ms); },
                onTimeUpdate: (e) => {
                  if (!current?.waitForVideo) return;
                  const v = e.target;
                  if (v.duration && v.currentTime != null) {
                    progressRef.current = (v.currentTime / v.duration) * 100;
                    if (barRef.current) {
                      barRef.current.style.transition = "none";
                      barRef.current.style.width = `${progressRef.current}%`;
                    }
                  }
                },
                onEnded: () => { setLiveVideoDuration(Math.max(liveVideoDuration || 0, 1)); advanceRef.current?.(); },
              }}
            />
            {(current.textOverlay || current.text) && (
              <div style={{ position: "absolute", bottom: 16, left: 12, right: 12, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
                {current.textOverlay || current.text}
              </div>
            )}
          </div>
          )) : current.mediaType === "image" && current.mediaURL ? (
          <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <ZoomableMedia src={current.mediaURL} type="image" onTap={() => {}} />
            {(current.textOverlay || current.text) && (
              <div style={{ position: "absolute", bottom: 16, left: 12, right: 12, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
                {current.textOverlay || current.text}
              </div>
            )}
          </div>
        ) : current.mediaType === "voice" && current.mediaURL ? (
          <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, overflow: "hidden", padding: "80px 24px 90px", boxSizing: "border-box" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, textAlign: "center" }}>🎤 Voice note</div>
            <audio
              ref={voiceRef}
              src={current.mediaURL}
              controls
              playsInline
              autoPlay
              onLoadedMetadata={(e) => { const ms = Math.round(e.target.duration * 1000); if (ms > 0) setLiveVideoDuration(ms); }}
              onEnded={() => { setLiveVideoDuration(Math.max(liveVideoDuration || 0, 1)); advanceRef.current?.(); }}
              style={{ width: "82%", maxWidth: 340 }}
            />
            {(current.textOverlay || current.text) && (
              <div style={{ maxWidth: "82%", background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
                {current.textOverlay || current.text}
              </div>
            )}
          </div>
        ) : (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px 90px", boxSizing: "border-box" }}>
            <div style={{ color: "#fff", fontWeight: 700, textAlign: "center", lineHeight: 1.3, fontFamily: current.fontFamily || appFont, width: "100%", boxSizing: "border-box", wordBreak: "break-word", overflowY: "auto", maxHeight: "100%", fontSize: Math.max(30, Math.min(64, Math.round(200 / Math.max(1, (current.text || "No text").length / 3)))) }}>
              {current.text || "No text"}
            </div>
          </div>
        )}
      </div>

      {!showViewers && (
        <div style={{ position: "absolute", top: 52, right: 8, display: "flex", gap: 8, zIndex: 16 }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
          {current?.mediaType === "video" && (
            <div onClick={(e) => { e.stopPropagation(); setSpeed((s) => { const i = SPEED_PRESETS.indexOf(s); return SPEED_PRESETS[(i + 1) % SPEED_PRESETS.length]; }); }} title="Playback speed" style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>{speed}x</span>
            </div>
          )}
          {current?.mediaType === "video" && (
            <div onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }} title={muted ? "Unmute" : "Mute"} style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {muted ? <VolumeX size={18} color="#fff" /> : <Volume2 size={18} color="#fff" />}
            </div>
          )}
          {(current?.allowDownload || current?.state === "ready" || !current?.state) && (current?.mediaURL || current?.fallbackPath || current?.posterPath || current?.hlsMasterPath) && (
            <div onClick={(e) => { e.stopPropagation(); if (!downloading) handleDownload(); }} title={downloading ? "Downloading…" : "Download"} style={{ width: 38, height: 38, borderRadius: "50%", background: downloading ? "rgba(0,168,132,0.9)" : "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", cursor: downloading ? "wait" : "pointer", opacity: downloading ? 0.9 : 1 }}>
              {downloading ? <RefreshCw size={16} color="#fff" style={{ animation: "nextext-spin 0.9s linear infinite" }} /> : <Download size={18} color="#fff" />}
            </div>
          )}
        </div>
      )}

      {!showViewers && idx > 0 && (
        <div onClick={(e) => { e.stopPropagation(); goBack(); }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 12 }}>
          <ChevronLeft size={18} color="#fff" />
        </div>
      )}
      {!showViewers && idx < statuses.length - 1 && (
        <div onClick={(e) => { e.stopPropagation(); advanceRef.current?.(); }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 12 }}>
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
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.85)", borderRadius: "16px 16px 0 0", zIndex: 25, paddingBottom: 20 }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
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
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px 16px", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", zIndex: 20 }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
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

      {showComments && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "72%", display: "flex", flexDirection: "column", background: "rgba(18,18,18,0.98)", borderRadius: "16px 16px 0 0", zIndex: 30 }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
          <div onClick={() => setShowComments(false)} style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px", cursor: "pointer" }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.3)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Comments ({comments.length})</span>
            {isOwner && !current.commentsHidden && (
              <div onClick={() => setStatusCommentsHidden(current.id, true)} style={{ fontSize: 12, color: "#FF3B30", cursor: "pointer", fontWeight: 600 }}>Turn off</div>
            )}
          </div>
          {current.commentsHidden ? (
            <div style={{ padding: "28px 16px", textAlign: "center" }}>
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13.5, marginBottom: 12 }}>Comments are turned off for this post.</div>
              {isOwner && (
                <div onClick={() => setStatusCommentsHidden(current.id, false)} style={{ display: "inline-block", padding: "8px 16px", borderRadius: 10, background: "#00A884", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Turn on comments</div>
              )}
            </div>
          ) : (
            <>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 0" }}>
                {comments.length === 0 ? (
                  <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "24px 16px" }}>No comments yet. Be the first!</div>
                ) : (
                  comments.map((c) => {
                    const up = c.up || [];
                    const down = c.down || [];
                    const votedUp = up.includes(myUid);
                    const votedDown = down.includes(myUid);
                    const u = contacts?.find((x) => x.uid === c.uid)?.profile || extraProfiles?.[c.uid] || null;
                    const name = u?.displayName || (c.uid === myUid ? "You" : "User");
                    const photo = u?.photoURL || null;
                    return (
                      <div key={c.id} style={{ display: "flex", gap: 10, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <Avatar photoURL={photo} name={name} uid={c.uid} size={34} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: "#fff", fontSize: 13.5, fontWeight: 600 }}>{name}</div>
                          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13.5, marginTop: 1, wordBreak: "break-word" }}>{c.text}</div>
                          <div style={{ display: "flex", gap: 14, marginTop: 6, alignItems: "center" }}>
                            <div onClick={() => voteStatusComment(current.id, c.id, myUid, "up")} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: votedUp ? "#00A884" : "rgba(255,255,255,0.6)" }}>
                              <span style={{ fontSize: 13 }}>▲</span><span style={{ fontSize: 12 }}>{up.length}</span>
                            </div>
                            <div onClick={() => voteStatusComment(current.id, c.id, myUid, "down")} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: votedDown ? "#FF3B30" : "rgba(255,255,255,0.6)" }}>
                              <span style={{ fontSize: 13 }}>▼</span><span style={{ fontSize: 12 }}>{down.length}</span>
                            </div>
                            {c.uid === myUid && (
                              <div onClick={() => deleteStatusComment(current.id, c.id, myUid)} style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", cursor: "pointer", marginLeft: "auto" }}>Delete</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && commentText.trim()) submitComment(); }}
                  placeholder="Add a comment…"
                  disabled={postingComment}
                  style={{ flex: 1, border: "none", outline: "none", background: "rgba(255,255,255,0.12)", borderRadius: 20, padding: "9px 14px", fontSize: 13.5, color: "#fff" }}
                />
                <div onClick={() => submitComment()} onTouchEnd={(e) => { e.stopPropagation(); submitComment(); }} style={{ display: "flex", alignItems: "center", flexShrink: 0, cursor: commentText.trim() ? "pointer" : "default" }}>
                  <Send size={18} color={commentText.trim() ? "#00A884" : "rgba(255,255,255,0.4)"} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
