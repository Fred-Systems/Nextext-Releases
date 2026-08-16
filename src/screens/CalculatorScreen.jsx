// Disguise screen: a fully functional calculator.
//
// Visually indistinguishable from a real calculator app, but every key press
// also feeds an unlock checker (calculatorPinMatches in iconManager.js). When
// the trailing digits of the input history equal the saved PIN, onUnlock() is
// called and the parent swaps to the real chat list.
//
// The math is intentionally minimal: + − × ÷ %, a single memory register (M+
// / M− / MR / MC), a toggle for sign, and a backspace. We parse / evaluate
// expressions with a hand-rolled shunting-yard algorithm — `eval` would
// expose globals and feels wrong for a "calculator" UI. The expression shown
// at the top of the screen reflects the user's keystrokes verbatim; the
// smaller "history" line shows the live result. The PIN checker inspects the
// full expression, so users can type "12+34=1234" or just hammer "1234" and
// both will unlock.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { getCalculatorPin, setCalculatorPin, hasCustomCalculatorPin, getActiveProfile } from "../services/iconManager";

const BUTTONS = [
  ["C",  "+/-", "%", "÷"],
  ["7",  "8",   "9", "×"],
  ["4",  "5",   "6", "−"],
  ["1",  "2",   "3", "+"],
  ["0",  ".",   "⌫", "="],
];

// Tokenise a user-typed expression like "12+3.4×(5−1)" into a stream of
// number / operator tokens. We accept unicode minus / division / multiplication
// because that's what the keypad renders. Anything else is dropped.
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\d|\./.test(ch)) {
      let j = i;
      while (j < expr.length && /\d|\./.test(expr[j])) j++;
      const numStr = expr.slice(i, j);
      // Treat a leading dot as "0."
      const norm = numStr.startsWith(".") ? "0" + numStr : numStr;
      const n = parseFloat(norm);
      if (!Number.isFinite(n)) return null;
      tokens.push({ type: "num", value: n });
      i = j;
    } else if ("+-×÷−".includes(ch)) {
      // First char may be unary minus / plus; we let shunting-yard handle it.
      tokens.push({ type: "op", value: ch });
      i++;
    } else {
      // skip unknown chars (whitespace, "=" leftover, etc.)
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

// Evaluate the expression using shunting-yard → RPN. Returns null on any
// parse error; returns NaN on division by zero. Both are surfaced as "Error".
function evaluate(expr) {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  // Pad unary minus / plus so the parser never tries to read "(-3+1)" as two
  // consecutive operators. We treat each leading operator as a unary minus
  // that flips the sign of the next number.
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
  // Drop trailing zeros for whole numbers, otherwise 6 significant digits
  // looks like a real calculator without producing 0.30000000004.
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
  // The display shows a free-form expression so the user can see exactly what
  // they've typed — including the PIN digits if they want to type them in.
  const [expression, setExpression] = useState("");
  const [memory, setMemory] = useState(0);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [pinSettingsOpen, setPinSettingsOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinFeedback, setPinFeedback] = useState("");
  const unlockRef = useRef(onUnlock);

  useEffect(() => { unlockRef.current = onUnlock; }, [onUnlock]);

  // The PIN check happens on every expression change. We compare against the
  // digit-only tail of the expression — typing "12+34=5678" matches a PIN
  // "5678"; typing the PIN on its own also matches.
  useEffect(() => {
    try {
      const pin = getCalculatorPin();
      if (!pin || pin.length < 4) return;
      const digits = expression.replace(/\D/g, "");
      if (digits.length >= pin.length && digits.slice(-pin.length) === pin) {
        // Defer slightly so the final digit actually paints before we unmount.
        const t = setTimeout(() => { try { unlockRef.current && unlockRef.current(); } catch {} }, 120);
        return () => clearTimeout(t);
      }
    } catch { /* PIN check is best-effort */ }
  }, [expression]);

  const press = useCallback((label) => {
    setExpression((prev) => {
      if (label === "AC" || label === "C") { setJustEvaluated(false); return ""; }
      if (label === "⌫") {
        if (justEvaluated) { setJustEvaluated(false); return ""; }
        return prev.slice(0, -1);
      }
      if (label === "+/-") {
        // Toggle the sign of the LAST number in the expression. We don't try
        // to handle mid-expression sign changes — that's a real calc feature
        // nobody uses. Insert a "−" or remove a leading "−" from the trailing
        // number token.
        const m = prev.match(/(.*?)(-?\d*\.?\d+)\s*$/);
        if (!m) return prev;
        const head = m[1] || "";
        const num = m[2] || "";
        const stripped = num.startsWith("−") || num.startsWith("-") ? num.slice(1) : "−" + num;
        return head + stripped;
      }
      if (label === "%") {
        // Treat the trailing number as a percentage of the running total. If
        // there isn't one, divide by 100. Easier to just divide by 100 for
        // the trailing number — matches iOS calculator.
        const m = prev.match(/(.*?)(-?\d*\.?\d+)\s*$/);
        if (!m) return prev;
        const head = m[1] || "";
        const num = parseFloat(m[2]);
        if (!Number.isFinite(num)) return prev;
        return head + (num / 100).toString();
      }
      if (label === "=") {
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
        // Don't allow two operators in a row — replace the previous one.
        if (!prev) {
          // Leading operator is fine as a unary minus.
          if (label === "−" || label === "-") return "−";
          return prev;
        }
        const last = prev[prev.length - 1];
        if ("+-×÷−".includes(last)) {
          return prev.slice(0, -1) + label;
        }
        return prev + label;
      }
      // Digits / dot
      setJustEvaluated(false);
      if (justEvaluated) {
        // After "=", the next digit starts a fresh expression. Same goes for
        // operators — they continue the previous result. iOS does the same.
        if (/\d|\./.test(label)) return label;
        return prev + label;
      }
      // Cap expression length so a long-running session doesn't blow the heap.
      if (prev.length >= 64) return prev;
      return prev + label;
    });
  }, [justEvaluated]);

  // Hardware / software keyboard support. The native WebView never sees a real
  // keyboard while in disguise mode (the calc owns input), but the desktop
  // preview still works.
  useEffect(() => {
    const onKey = (e) => {
      if (pinSettingsOpen) return;
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
  }, [press, pinSettingsOpen]);

  const onMemory = (op) => {
    if (op === "MC") { setMemory(0); return; }
    const result = evaluate(expression);
    if (result == null || Number.isNaN(result) || !Number.isFinite(result)) return;
    if (op === "MR") setExpression((prev) => (justEvaluated ? String(result) : prev + String(result)));
    else if (op === "M+") setMemory((m) => m + result);
    else if (op === "M-") setMemory((m) => m - result);
  };

  const livePreview = expression && !justEvaluated ? formatResult(evaluate(expression)) : "";
  const accent = profile?.id === "icon6" ? "#34C759" : "#10B981";
  const bg = "#000000";
  const displayBg = "#000000";
  const btnBg = "#1C1C1E";
  const btnBgAlt = "#3A3A3C";
  const btnBgOp = accent;
  const btnText = "#FFFFFF";

  const buttonFor = (label) => {
    const isOp = "+-×÷−".includes(label) || label === "=";
    const isMod = label === "AC" || label === "C" || label === "+/-" || label === "%";
    const isFn = label === "⌫";
    const bgCol = isOp ? btnBgOp : isMod || isFn ? btnBgAlt : btnBg;
    return { bg: bgCol, fg: isOp ? "#FFFFFF" : btnText };
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: bg, color: btnText,
        display: "flex", flexDirection: "column", padding: "0 0 max(env(safe-area-inset-bottom), 12px) 0",
        fontFamily: "-apple-system, system-ui, sans-serif",
        userSelect: "none", WebkitUserSelect: "none",
      }}
    >
      {/* Tiny settings affordance — long-tap the calculator title to open the
          PIN-change sheet. Most users never need it; the default PIN is
          "1234" and the unlock check fires as soon as those four digits
          appear in the expression history. */}
      <div
        style={{
          paddingTop: "max(env(safe-area-inset-top), 18px)",
          padding: "max(env(safe-area-inset-top), 18px) 16px 8px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          opacity: 0.6, fontSize: 13,
        }}
      >
        <span>{profile?.label || "Calculator"}</span>
        <span onClick={() => { setPinDraft(""); setPinFeedback(""); setPinSettingsOpen(true); }} style={{ cursor: "pointer", padding: 4 }}>
          ⚙︎
        </span>
      </div>

      <div style={{ flex: 1, padding: "8px 24px", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "flex-end", gap: 6, background: displayBg, overflow: "hidden" }}>
        <div style={{ fontSize: 32, color: "rgba(255,255,255,0.45)", minHeight: 36, textAlign: "right", wordBreak: "break-all", lineHeight: 1.1 }}>
          {livePreview}
        </div>
        <div style={{ fontSize: 64, lineHeight: 1.05, textAlign: "right", wordBreak: "break-all", fontWeight: 200 }}>
          {expression || "0"}
        </div>
      </div>

      {memory !== 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 18px", fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
          <span>M = {formatResult(memory)}</span>
          <span>
            <button onClick={() => onMemory("MR")} style={memBtn}>MR</button>
            <button onClick={() => onMemory("MC")} style={memBtn}>MC</button>
            <button onClick={() => onMemory("M+")} style={memBtn}>M+</button>
            <button onClick={() => onMemory("M-")} style={memBtn}>M−</button>
          </span>
        </div>
      )}

      <div style={{ padding: "8px 12px 12px", display: "grid", gridTemplateRows: `repeat(${BUTTONS.length}, 1fr)`, gap: 10 }}>
        {BUTTONS.map((row, ri) => (
          <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
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
                    height: "min(72px, calc((100vh - 360px) / 5))",
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

      {pinSettingsOpen && (
        <div style={modalOverlay} onClick={() => setPinSettingsOpen(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Set unlock PIN</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 14 }}>
              Type the digits you'd enter on the calculator to unlock NexText. 4–6 digits, no letters.
              {!hasCustomCalculatorPin() && " Default PIN is 1234."}
            </div>
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pinDraft}
              onChange={(e) => { setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 6)); setPinFeedback(""); }}
              placeholder="1234"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 18, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)", background: "#1C1C1E", color: "#fff",
                letterSpacing: 6, textAlign: "center", marginBottom: 10,
              }}
            />
            {pinFeedback && <div style={{ fontSize: 13, color: pinFeedback.startsWith("✓") ? accent : "#FF453A", marginBottom: 10 }}>{pinFeedback}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPinSettingsOpen(false)} style={modalBtn("secondary")}>Cancel</button>
              <button
                onClick={() => {
                  if (pinDraft.length < 4) { setPinFeedback("PIN must be at least 4 digits."); return; }
                  setCalculatorPin(pinDraft);
                  setPinFeedback("✓ Saved");
                  setTimeout(() => setPinSettingsOpen(false), 600);
                }}
                style={modalBtn("primary", accent)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
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

const modalOverlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
};
const modalCard = {
  background: "#1C1C1E", color: "#fff", borderRadius: 18, padding: 22,
  width: "min(320px, calc(100% - 32px))",
};
function modalBtn(kind, color) {
  return {
    flex: 1,
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: kind === "primary" ? color : "rgba(255,255,255,0.12)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  };
}
