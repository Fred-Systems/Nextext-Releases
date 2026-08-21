import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Lock, EyeOff } from "lucide-react";

export default function AppLockScreen({ onUnlock }) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const stored = localStorage.getItem("nextext_app_lock_pass") || "";

  useEffect(() => {
    const input = document.getElementById("app-lock-input");
    if (input) input.focus();
  }, []);

  const submit = () => {
    if (pass === stored) { onUnlock(); return; }
    setError(true);
    setPass("");
    setTimeout(() => setError(false), 1500);
  };

  const lockScreen = (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "#0B141A", zIndex: 2147483000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#00A88422", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Lock size={28} color="#00A884" />
      </div>
      <div style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>App locked</div>
      <div style={{ fontSize: 13, color: "#889aa6", marginBottom: 8 }}>Enter your PIN or password to continue</div>
      <div style={{ position: "relative", width: 200 }}>
        <input
          id="app-lock-input"
          type={showPass ? "text" : "password"}
          autoFocus
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Enter PIN…"
          style={{ width: "100%", padding: "12px 42px 12px 14px", borderRadius: 12, border: `1px solid ${error ? "#FF3B30" : "#2a3a4a"}`, fontSize: 16, textAlign: "center", letterSpacing: 6, boxSizing: "border-box", outline: "none", color: "#fff", background: "#1e2c35" }}
        />
        <div onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#889aa6" }}>
          <EyeOff size={18} />
        </div>
      </div>
      {error && <div style={{ color: "#FF3B30", fontSize: 13, fontWeight: 600 }}>Incorrect password</div>}
      <button onClick={submit} style={{ width: 200, padding: 13, borderRadius: 12, border: "none", background: "#00A884", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 4 }}>
        Unlock
      </button>
    </div>
  );

  return createPortal(lockScreen, document.body);
}
