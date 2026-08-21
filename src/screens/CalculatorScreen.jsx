// Disguise screen: a fully functional calculator with light/dark toggle.
// Theme choice is stored in localStorage (disguise-agnostic key). Defaults to dark.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { getCalculatorPin, calculatorPinMatches, getActiveProfile } from "../services/iconManager";

const THEME_KEY = "nextext_calc_theme";

const BUTTONS = [
  ["C",  "+/-", "%", "÷"],
  ["7",  "8",   "9", "×"],
  ["4",  "5",   "6", "−"],
  ["1",  "2",   "3", "+"],
  ["0",  ".",   "⌫", "="],
];

// Keep darkness threshold aligned with system "prefers-color-scheme: dark"
// (media query is ~0.226 for "dark" in sRGB). We default to dark unless the
// user has explicitly chosen light, so the toggle has one stable start state.
const DARK_BG   = "#000000";
const DARK_INK  = "#FFFFFF";
const DARK_DISP = "#000000";
const DARK_BTN  = "#1C1C1E";
const DARK_BTN2 = "#3A3A3C";

const LIGHT_BG   = "#FFFFFF";
const LIGHT_INK  = "#1C1C1E";
const LIGHT_DISP = "#F2F2F7";
const LIGHT_BTN  = "#E5E5EA";
const LIGHT_BTN2 = "#D1D1D6";

function applyTheme(dark) {
  return dark
    ? { bg: DARK_BG, ink: DARK_INK, displayBg: DARK_DISP, btnBg: DARK_BTN, btnBgAlt: DARK_BTN2, accent: "#34C759" }
    : { bg: LIGHT_BG, ink: LIGHT_INK, displayBg: LIGHT_DISP, btnBg: LIGHT_BTN, btnBgAlt: LIGHT_BTN2, accent: "#007AFF" };
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\d|\./.test(ch)) {
      let j = i;
      while (j < expr.length && /\d|\./.test(expr[j])) j++;
      const numStr = expr.slice(i, j);
      const norm = numStr.startsWith(".") ? "0" + numStr : numStr;
      const n = parseFloat(norm);
      if (!Number.isFinite(n)) return null;
      tokens.push({ type: "num", value: n });
      i = j;
    } else if ("+-×÷−".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
    } else {
      i++;
    }
  }
  return tokens;
}

function precedence(op) {
  if (op === "×" || op === "÷") return 2;
  if (op === "+" || op === "−" || op === "-") return 1;
  return 0;
}

function applyOp(a, b, op) {
  if (op === "+") return a + b;
  if (op === "−" || op === "-") return a - b;
  if (op === "×") return a * b;
  if (op === "÷") return b === 0 ? NaN : a / b;
  return NaN;
}

function evaluate(expr) {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  const normalised = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "op" && (i === 0 || tokens[i - 1].type === "op")) {
      if (t.value === "−" || t.value === "-") {
        normalised.push({ type: "num", value: 0 });
        normalised.push({ type: "op", value: "−" });
        continue;
      }
      if (t.value === "+") { continue; }
    }
    normalised.push(t);
  }
  const out = [];
  const ops = [];
  for (const t of normalised) {
    if (t.type === "num") out.push(t);
    else if (t.type === "op") {
      while (ops.length && precedence(ops[ops.length - 1].value) >= precedence(t.value)) {
        out.push({ type: "op", value: ops.pop().value });
      }
      ops.push(t);
    }
  }
  while (ops.length) out.push({ type: "op", value: ops.pop().value });
  const stack = [];
  for (const t of out) {
    if (t.type === "num") stack.push(t.value);
    else {
      const b = stack.pop();
      const a = stack.pop();
      if (a == null || b == null) return null;
      stack.push(applyOp(a, b, t.value));
    }
  }
  if (stack.length !== 1) return null;
  return stack[0];
}

function formatResult(n) {
  if (n == null || Number.isNaN(n)) return "Error";
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const abs = Math.abs(n);
  let str;
  if (abs >= 1e12 || (abs > 0 && abs < 1e-6)) {
    str = n.toExponential(4);
  } else {
    str = parseFloat(n.toPrecision(12)).toString();
  }
  return str;
}

export default function CalculatorScreen({ onUnlock }) {
  const profile = getActiveProfile();
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light") return false;
      return true;
    } catch {
      return true;
    }
  });
  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const next = !d;
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch {}
      return next;
    });
  }, []);

  const theme = applyTheme(dark);
  const [expression, setExpression] = useState("");
  const [memory, setMemory] = useState(0);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const unlockRef = useRef(onUnlock);
  const unlockingRef = useRef(false);

  useEffect(() => { unlockRef.current = onUnlock; }, [onUnlock]);

  const press = useCallback((label) => {
    setExpression((prev) => {
      if (label === "AC" || label === "C") { setJustEvaluated(false); return ""; }
      if (label === "⌫") {
        if (justEvaluated) { setJustEvaluated(false); return ""; }
        return prev.slice(0, -1);
      }
      if (label === "+/-") {
        const m = prev.match(/(.*?)(-?\d*\.?\d+)\s*$/);
        if (!m) return prev;
        const head = m[1] || "";
        const num = m[2] || "";
        const stripped = num.startsWith("−") || num.startsWith("-") ? num.slice(1) : "−" + num;
        return head + stripped;
      }
      if (label === "%") {
        const m = prev.match(/(.*?)(-?\d*\.?\d+)\s*$/);
        if (!m) return prev;
        const head = m[1] || "";
        const num = parseFloat(m[2]);
        if (!Number.isFinite(num)) return prev;
        return head + (num / 100).toString();
      }
               if (label === "=") {
                 // The calculator code only unlocks when the user presses "=".
                 // We never auto-unlock mid-typing (that would let someone see
                 // the code "work" before they finish entering it). Requires
                 // the exact stored code, then presses "=" to confirm.
                 if (calculatorPinMatches(prev)) {
                   if (!unlockingRef.current) {
                     unlockingRef.current = true;
                     try { unlockRef.current && unlockRef.current(); } catch {}
                   }
                   return "";
                 }
                 const result = evaluate(prev);
                 if (result == null || Number.isNaN(result)) {
                   setJustEvaluated(true);
                   return "Error";
                 }
                 setJustEvaluated(true);
                 return formatResult(result);
               }
      if ("+-×÷−".includes(label)) {
        setJustEvaluated(false);
        if (!prev) {
          if (label === "−" || label === "-") return "−";
          return prev;
        }
        const last = prev[prev.length - 1];
        if ("+-×÷−".includes(last)) {
          return prev.slice(0, -1) + label;
        }
        return prev + label;
      }
      setJustEvaluated(false);
      if (justEvaluated) {
        if (/\d|\./.test(label)) return label;
        return prev + label;
      }
      if (prev.length >= 64) return prev;
      return prev + label;
    });
  }, [justEvaluated]);

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      if (/[0-9]/.test(k)) press(k);
      else if (k === ".") press(".");
      else if (k === "+") press("+");
      else if (k === "-") press("−");
      else if (k === "*") press("×");
      else if (k === "/") press("÷");
      else if (k === "Enter" || k === "=") press("=");
      else if (k === "Backspace") press("⌫");
      else if (k === "Escape") press("AC");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const onMemory = (op) => {
    if (op === "MC") { setMemory(0); return; }
    const result = evaluate(expression);
    if (result == null || Number.isNaN(result) || !Number.isFinite(result)) return;
    if (op === "MR") setExpression((p) => (justEvaluated ? String(result) : p + String(result)));
    else if (op === "M+") setMemory((m) => m + result);
    else if (op === "M-") setMemory((m) => m - result);
  };

  const liveResult = (() => {
    if (!expression || justEvaluated) return "";
    const r = evaluate(expression);
    if (r == null || Number.isNaN(r) || !Number.isFinite(r)) return "";
    return formatResult(r);
  })();

  const iconColor = dark ? "#FFFFFF" : "#000000";
  const bgCol = theme.bg;
  const inkCol = theme.ink;
  const btnBgBase = theme.btnBg;
  const btnBgOp = theme.accent;
  const btnTextMain = dark ? "#FFFFFF" : "#000000";

  const buttonFor = (label) => {
    const isOp = "+-×÷−".includes(label) || label === "=";
    const isMod = label === "AC" || label === "C" || label === "+/-" || label === "%";
    const isFn = label === "⌫";
    const bgCol2 = isOp ? btnBgOp : isMod || isFn ? theme.btnBgAlt : btnBgBase;
    return { bg: bgCol2, fg: isOp ? "#FFFFFF" : btnTextMain };
  };

  return (
    <div
      style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        width: "100%", height: "100dvh",
        background: bgCol, color: inkCol,
        display: "flex", flexDirection: "column",
        paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
        fontFamily: "-apple-system, system-ui, sans-serif",
        userSelect: "none", WebkitUserSelect: "none",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          paddingTop: "max(env(safe-area-inset-top), 18px)",
          padding: "max(env(safe-area-inset-top), 18px) 16px 8px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          opacity: 0.7, fontSize: 13,
        }}
      >
        <span>{profile?.label || "Calculator"}</span>
        <span
          role="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          style={{ cursor: "pointer", padding: "4px 8px", userSelect: "none", fontSize: 14 }}
        >
          {dark ? "☀️" : "🌙"}
        </span>
      </div>

      <div style={{ flex: "0 0 auto", padding: "8px 24px", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "flex-end", gap: 6, background: theme.displayBg, overflow: "hidden" }}>
        <div style={{ maxHeight: "28vh", overflowY: "auto", width: "100%", textAlign: "right", padding: "0 4px" }}>
          <div style={{ fontSize: 32, color: dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.35)", minHeight: 36, wordBreak: "break-all", lineHeight: 1.1 }}>
            {liveResult}
          </div>
          <div style={{ fontSize: 64, lineHeight: 1.05, wordBreak: "break-all", fontWeight: 200 }}>
            {expression || "0"}
          </div>
        </div>
      </div>

      {memory !== 0 && (
        <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "space-between", padding: "6px 18px", fontSize: 13, color: dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)" }}>
          <span>M = {formatResult(memory)}</span>
          <span>
            <button onClick={() => onMemory("MR")} style={memBtn}>MR</button>
            <button onClick={() => onMemory("MC")} style={memBtn}>MC</button>
            <button onClick={() => onMemory("M+")} style={memBtn}>M+</button>
            <button onClick={() => onMemory("M-")} style={memBtn}>M−</button>
          </span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, padding: "8px 12px 12px", display: "grid", gridTemplateRows: `repeat(${BUTTONS.length}, 1fr)`, gap: 10 }}>
        {BUTTONS.map((row, ri) => (
          <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, minHeight: 0 }}>
            {row.map((label) => {
              const { bg: bgCol, fg } = buttonFor(label);
              const wide = label === "0";
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => press(label)}
                  onTouchEnd={(e) => { e.preventDefault(); press(label); }}
                  style={{
                    gridColumn: wide ? "span 2" : "auto",
                    height: "100%",
                    minHeight: 36,
                    borderRadius: 36,
                    border: "none",
                    background: bgCol,
                    color: fg,
                    fontSize: 28,
                    fontWeight: 400,
                    cursor: "pointer",
                    touchAction: "manipulation",
                    transition: "transform 0.08s ease, opacity 0.08s ease",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const memBtn = {
  background: "transparent",
  color: "inherit",
  border: "none",
  padding: "4px 8px",
  fontSize: 13,
  cursor: "pointer",
};