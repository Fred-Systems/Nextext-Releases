import { useEffect, useRef, useState } from "react";

// Displays any runtime error (uncaught exception or unhandled promise
// rejection) as a visible banner on screen. The app runs inside a Capacitor
// WebView on phones where there is no easy way to open a JS console, so a
// silent error previously looked like a blank page. This makes it visible so
// the cause can actually be reported instead of guessed.
const AUTO_DISMISS_MS = 8000;

export default function ErrorReporter({ children }) {
  const [errors, setErrors] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    const push = (msg) => {
      const id = ++idRef.current;
      setErrors((prev) => [...prev, { id, msg }].slice(-5));
      // Auto-dismiss each banner so a transient error never blocks the
      // screen forever; the manual × is still available.
      setTimeout(() => {
        setErrors((prev) => prev.filter((e) => e.id !== id));
      }, AUTO_DISMISS_MS);
    };
    const onError = (event) => {
      const e = event?.error || event;
      const msg = e && (e.message || e.stack || String(e))
        || (typeof event?.message === "string" ? event.message : "Unknown error");
      // ResizeObserver fires a benign "loop completed with undelivered
      // notifications" / "loop limit exceeded" error on every layout pass by
      // the virtualized chat list when the text size or scale changes. It is
      // not a real failure and surfacing it would just spam the error banner.
      if (msg && msg.toLowerCase().indexOf("resizeobserver") !== -1) return;
      push(`Uncaught: ${msg}`);
    };
    const onRejection = (event) => {
      const e = event?.reason;
      const msg = e && (e.message || e.stack || String(e)) || "Unknown rejection";
      push(`Rejected promise: ${msg}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <>
      {children}
      {errors.length > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 9999999, background: "#3D0A0A", borderTop: "2px solid #FF3B30", padding: 10, maxHeight: "40vh", overflowY: "auto", fontSize: 11, color: "#FFB3B3", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {errors.map((err) => (
            <div key={err.id} style={{ marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ flex: 1 }}>{err.msg}</span>
              <span
                onClick={() => setErrors((prev) => prev.filter((e) => e.id !== err.id))}
                style={{ color: "#fff", fontSize: 12, cursor: "pointer", flexShrink: 0, background: "rgba(255,255,255,0.15)", borderRadius: 4, padding: "0 5px" }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
