import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorReporter from './utils/errorReporter.jsx'
import { version as APP_VERSION } from '../package.json'

import React from 'react'

// ── Boot-level error capture ───────────────────────────────────────────────
// The React ErrorBoundary only catches errors thrown *during render*. If a
// module throws while being evaluated (before React mounts), or an async
// promise (e.g. Firebase auth) rejects, the app can end up on the #root
// background (#0B141A) with nothing rendered and no overlay — exactly the
// "dark blank screen" some devices hit. This captures those too and writes
// to the always-present #nx-boot-error div so the real cause is finally
// visible (and copyable / clearable).
function getBuildInfo() {
  let platform = "unknown";
  try { platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "unknown"; } catch {}
  return `NexText v${APP_VERSION}
Platform: ${platform}
WebView UA: ${navigator.userAgent}
Time: ${new Date().toISOString()}`;
}

function copyError(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    alert("Error copied to clipboard — paste it to the developer.");
  } catch {
    alert("Could not copy automatically. Please screenshot this screen.");
  }
}

function clearAndRestart() {
  try { localStorage.clear(); } catch {}
  try {
    if (indexedDB && indexedDB.databases) {
      indexedDB.databases().then((dbs) => {
        (dbs || []).forEach((d) => { try { indexedDB.deleteDatabase(d.name); } catch {} });
      }).catch(() => {});
    }
  } catch {}
  setTimeout(() => window.location.reload(), 300);
}

let bootErrorShown = false;
function showBootError(msg) {
  try {
    const el = document.getElementById("nx-boot-error");
    if (!el) return;
    const text = (msg || "Unknown error");
    if (bootErrorShown) {
      el.innerHTML += "\n\n" + text;
      return;
    }
    bootErrorShown = true;
    const full = text + "\n\n────────────────────────────\n" + getBuildInfo() +
      "\n\nIf your Android System WebView is very old, update it from the Play Store and retry.";
    el.innerHTML = "";
    const pre = document.createElement("pre");
    pre.style.cssText = "color:#ff6b6b;padding:16px;font-size:12px;white-space:pre-wrap;word-break:break-all;background:#0B141A;min-height:100vh;margin:0;";
    pre.textContent = full;
    el.appendChild(pre);
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;display:flex;gap:8px;padding:8px;background:#1a1a1a;z-index:20;border-bottom:1px solid #ff6b6b;";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy error";
    copyBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#10B981;color:#fff;font-weight:700;cursor:pointer;";
    copyBtn.onclick = () => copyError(full);
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear data & restart";
    clearBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#FF3B30;color:#fff;font-weight:700;cursor:pointer;";
    clearBtn.onclick = clearAndRestart;
    bar.appendChild(copyBtn);
    bar.appendChild(clearBtn);
    el.appendChild(bar);
    el.style.display = "block";
    el.style.pointerEvents = "auto";
  } catch { /* nothing else we can do */ }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error: error } }
  componentDidCatch(error) {
    const msg = (error && (error.stack || error.message)) || String(error);
    showBootError(msg);
  }
  render() {
    if (this.state.error) {
      const msg = this.state.error.stack || String(this.state.error);
      const errEl = document.getElementById('nx-boot-error');
      if (errEl) { errEl.style.display = 'block'; errEl.style.pointerEvents = 'auto'; errEl.innerHTML = '<pre style="color:#ff6b6b;padding:16px;font-size:12px;white-space:pre-wrap;word-break:break-all;background:#0B141A;min-height:100vh;">' + msg + '</pre>'; }
      return <pre style={{ color: '#ff6b6b', padding: 16, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {msg}
      </pre>
    }
    return this.props.children
  }
}

// Capture errors that happen before/outside React (module eval, async rejections).
window.addEventListener('error', (e) => {
  const err = e.error || e;
  showBootError((err && (err.stack || err.message)) || e.message || 'Unknown error');
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  showBootError('Unhandled promise rejection:\n' + ((r && (r.stack || r.message)) || String(r)));
});

try {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorReporter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ErrorReporter>
    </StrictMode>,
  );
} catch (e) {
  showBootError('Render failed:\n' + ((e && (e.stack || e.message)) || String(e)));
}
