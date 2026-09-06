import React from "react";

// Isolates each pager page so a crash in one page shows an inline error
// instead of silently leaving the page blank or killing the whole app.
// The shell (bottom bar, AI widget) keeps working even if a page fails.
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    // "ResizeObserver loop completed with undelivered notifications" is a benign
    // browser layout warning, not a crash — never show the crash screen for it.
    const msg = String(error?.message || error || "");
    if (/resizeobserver loop/i.test(msg)) return {};
    return { error };
  }

  componentDidCatch(error, info) {
    const msg = String(error?.message || error || "");
    if (/resizeobserver loop/i.test(msg)) return;
    console.error("[PageErrorBoundary]", this.props.label || "page", error, info);
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || this.state.error?.stack || String(this.state.error);
      return (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, background: "#0B141A", color: "#FF6B6B", textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>
            {this.props.label || "This page"} crashed
          </div>
          <div style={{ fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", opacity: 0.9 }}>
            {msg}
          </div>
          <div style={{ fontSize: 11, color: "#8696A0" }}>Tap "Reset all settings" in Settings → Account if this keeps happening.</div>
        </div>
      );
    }
    return this.props.children;
  }
}
