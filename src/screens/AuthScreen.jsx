import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Eye, EyeOff, Lock } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { collection, query, where, getDocs, limit as fbLimit } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { db, auth as firebaseAuth } from "../firebase/config";
import DownloadApkButton from "../components/DownloadApkButton";
import ApkDownloadCount from "../components/ApkDownloadCount";
import { useGlobalSettings } from "../firebase/config-settings";

export default function AuthScreen({ auth }) {
  const { t } = useTheme();
  const globalSettings = useGlobalSettings();
  // Google Sign-In visibility is admin-controlled (default HIDE — the provider
  // isn't configured). When hidden, no Google buttons render and no Google
  // auth requests can be made. When shown, buttons only render for real flows.
  const googleVisible = globalSettings?.auth?.googleSignIn === "show";
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [usernameTaken, setUsernameTaken] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (mode !== "signup" || !username.trim()) {
      setUsernameTaken(false);
      setCheckingUsername(false);
      return;
    }
    setCheckingUsername(true);
    setUsernameTaken(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      // A username-availability lookup needs isSignedIn(), which isn't true
      // until the account exists — so skip the live check while unauthenticated
      // (the real uniqueness gate runs inside signUpWithEmail after sign-in).
      if (!auth.user) { setCheckingUsername(false); return; }
      try {
        const lower = username.trim().toLowerCase();
        const q = query(
          collection(db, "users"),
          where("usernameLower", ">=", lower),
          where("usernameLower", "<=", lower + "\uf8ff"),
          fbLimit(1)
        );
        const snap = await getDocs(q);
        const exact = snap.docs.some((d) => d.data().usernameLower === lower);
        setUsernameTaken(exact);
      } catch {
        setCheckingUsername(false);
      }
      setCheckingUsername(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username, mode]);

  const handleSubmit = async () => {
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") {
        await auth.signInWithEmail(email, password);
      } else {
        if (!username.trim() || !displayName.trim()) {
          setError("Please fill in username and display name.");
          setBusy(false);
          return;
        }
        if (usernameTaken) {
          setError("That username is already taken. Please choose another.");
          setBusy(false);
          return;
        }
        if (!agreedToPrivacy) {
          setError("You must agree to the Privacy Policy to create an account.");
          setBusy(false);
          return;
        }
        await auth.signUpWithEmail(email, password, username.trim(), displayName.trim(), phone.trim() || null);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  };

  const handleGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      await auth.signInWithGoogle();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  };

  const handleGoogleSignup = async () => {
    setError("");
    if (!username.trim()) { setError("Please choose a username for your account."); setBusy(false); return; }
    if (!displayName.trim()) { setError("Please enter a display name for your account."); setBusy(false); return; }
    if (usernameTaken) { setError("That username is already taken."); setBusy(false); return; }
    if (!agreedToPrivacy) { setError("You must agree to the Privacy Policy to create an account."); setBusy(false); return; }
    setBusy(true);
    try {
      const u = await auth.signInWithGoogle(true);
      if (u?.uid) {
        await auth.completeGoogleSignup(username.trim(), displayName.trim(), username.trim().toLowerCase(), phone.trim() || null);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  };

  return (
    <div className="nx-screen" style={{ position: "absolute", inset: 0, background: t.bg, zIndex: 65, display: "flex", flexDirection: "column", width: "100%", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      <div style={{ height: 4, background: "#111B21", flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "30px 28px 50px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <MessageSquare size={30} color={t.bubbleMeText} />
          </div>
          <div style={{ fontWeight: 800, fontSize: 24, color: t.text }}>NexText</div>
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>{mode === "signin" ? "Welcome back" : "Create your account"}</div>
        </div>

        {mode === "signup" && (
          <>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (required)" style={inputStyle(t)} />
            <div style={{ position: "relative" }}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (required)" style={{ ...inputStyle(t), borderColor: usernameTaken ? "#FF3B30" : t.border }} />
              {checkingUsername && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: t.textMuted }}>checking…</span>}
              {usernameTaken && !checkingUsername && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#FF3B30" }}>taken</span>}
            </div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (recommended)" inputMode="tel" style={inputStyle(t)} />
            <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 10, lineHeight: 1.5, padding: "0 2px" }}>
              Adding your real phone number helps friends find you automatically. Never enter a fake number — it could connect you with the wrong person.
            </div>
            <div style={{ display: "flex", gap: 8, background: "#FFEDE6", borderRadius: 10, padding: 10, marginBottom: 12, border: `1px solid #FFB199` }}>
              <Lock size={15} color="#C0392B" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: "#7A2E1D", lineHeight: 1.45 }}>
                <strong>Messages are not end-to-end encrypted.</strong> NexText can technically access message content because its servers process it to power AI, translation, sync, and web access. By creating an account you acknowledge this is not a zero-knowledge / E2EE messenger.
              </span>
            </div>
            <div onClick={() => setAgreedToPrivacy(!agreedToPrivacy)} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, cursor: "pointer", padding: "0 2px" }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${agreedToPrivacy ? t.primary : t.border}`, background: agreedToPrivacy ? t.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, transition: "background 0.15s" }}>
                {agreedToPrivacy && <span style={{ color: t.bubbleMeText, fontSize: 12, fontWeight: 700 }}>✓</span>}
              </div>
              <span style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>
                I agree to the <span onClick={(e) => { e.stopPropagation(); setShowPrivacyPolicy(true); }} style={{ color: t.primary, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>Privacy Policy</span>. I understand that my data is stored on third-party infrastructure (Firebase, Supabase) with unguessable but not unbreakable access paths, that this app is maintained on a best-effort basis by an independent developer, and that the creators of NexText are not liable for any data damage, loss, or security exposure.
              </span>
            </div>
          </>
        )}
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inputStyle(t)} />
        <div style={{ position: "relative" }}>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="Password" style={{ ...inputStyle(t), marginBottom: 16, paddingRight: 42 }} />
          <div onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 12, top: 13, cursor: "pointer", color: t.textMuted }}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </div>
        </div>

        {mode === "signin" && (
          <div style={{ marginBottom: 12, textAlign: "right" }}>
            <span
              onClick={async () => {
                setResetMsg("");
                if (!email.trim()) { setResetMsg("Enter your email above first, then tap Forgot password?"); return; }
                setResetBusy(true);
                try {
                  await sendPasswordResetEmail(firebaseAuth, email.trim());
                  setResetMsg("Password reset email sent! Check your inbox.");
                } catch (e) {
                  const code = e?.code;
                  if (code === "auth/user-not-found") setResetMsg("No account found with that email.");
                  else if (code === "auth/invalid-email") setResetMsg("That doesn't look like a valid email.");
                  else setResetMsg(e?.message || "Could not send reset email. Try again.");
                }
                setResetBusy(false);
              }}
              style={{ fontSize: 13, color: t.primary, fontWeight: 600, cursor: resetBusy ? "wait" : "pointer" }}
            >
              {resetBusy ? "Sending…" : "Forgot password?"}
            </span>
          </div>
        )}
        {resetMsg && <div style={{ color: resetMsg.includes("sent") ? "#34C759" : "#FF9500", fontSize: 12.5, marginBottom: 12 }}>{resetMsg}</div>}
        {error && <div style={{ color: "#FF3B30", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

        <button disabled={busy} onClick={handleSubmit} style={btnStyle(t, true)}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
          <div style={{ flex: 1, height: 1, background: t.border }} />
          <span style={{ fontSize: 12, color: t.textMuted }}>or</span>
          <div style={{ flex: 1, height: 1, background: t.border }} />
        </div>

        {googleVisible ? (
        mode === "signup" ? (
          <button disabled={busy || !agreedToPrivacy} onClick={handleGoogleSignup} style={{ ...btnStyle(t, false), opacity: agreedToPrivacy ? 1 : 0.5 }}>
            <svg viewBox="0 0 48 48" style={{ width: 18, height: 18, flexShrink: 0 }}><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.54 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.87 7.35 2.56 10.56l7.98-5.97z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.97C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>
        ) : (
          <>
            <button disabled={busy} onClick={handleGoogle} style={btnStyle(t, false)}>
              <svg viewBox="0 0 48 48" style={{ width: 18, height: 18, flexShrink: 0 }}><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.54 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.87 7.35 2.56 10.56l7.98-5.97z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.97C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </button>
            <div style={{ fontSize: 11.5, color: t.textMuted, textAlign: "center", marginTop: 8, lineHeight: 1.5, padding: "0 10px" }}>
              New here? Sign in with Google on the <span onClick={() => { setMode("signup"); setError(""); setUsernameTaken(false); }} style={{ color: t.primary, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>Sign Up</span> page to create your account.
            </div>
          </>
        )
        ) : null}

        <div onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setUsernameTaken(false); }} style={{ textAlign: "center", fontSize: 13, color: t.primary, fontWeight: 600, cursor: "pointer", marginTop: 20 }}>
          {mode === "signin" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
        </div>

        {!globalSettings?.hideDownloadCount && <DownloadApkButton subtle />}
        <ApkDownloadCount />
      </div>

      {showPrivacyPolicy && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setShowPrivacyPolicy(false)}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 20, maxWidth: 350, maxHeight: "80%", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: t.text }}>Privacy Policy</span>
              <span onClick={() => setShowPrivacyPolicy(false)} style={{ cursor: "pointer", color: t.textMuted, fontSize: 18 }}>×</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.6, overflowY: "auto", maxHeight: "60vh" }}>
              <p style={{ marginBottom: 10 }}>NexText collects and stores your account data (username, display name, messages, media, and status updates) on Firebase (Google) and Supabase infrastructure.</p>
              <p style={{ marginBottom: 10 }}><strong>Data Storage:</strong> Your data is stored using unguessable URL paths on third-party cloud services. While these paths are not publicly discoverable, they are not cryptographically secured against a determined attacker with direct infrastructure access.</p>
              <p style={{ marginBottom: 10 }}><strong>Maintenance:</strong> This application is developed and maintained on a best-effort basis by an independent developer. There is no guaranteed uptime, support SLA, or liability for bugs, data loss, or service interruptions.</p>
              <p style={{ marginBottom: 10 }}><strong>Liability:</strong> By using NexText, you acknowledge and agree that the developers, contributors, and operators of NexText are NOT liable for any data damage, data loss, security exposure, unauthorized access, or any other consequence arising from your use of this application. You use NexText entirely at your own risk.</p>
              <p style={{ marginBottom: 10 }}><strong>Media:</strong> Uploaded images, videos, voice notes, and files are stored on Supabase with public read access via RLS policies. Media may persist beyond account deletion depending on cache and CDN behavior.</p>
              <p style={{ marginBottom: 10 }}><strong>Encryption:</strong> NexText uses encryption to protect data in transit and at rest, but messages are <strong>not end-to-end encrypted (not E2EE)</strong>. Because NexText's servers process message content to provide features such as AI, translation, synchronization, and web access, NexText's infrastructure may technically be capable of accessing message content. NexText should not be considered a zero-knowledge or E2EE messenger.</p>
              <p><strong>Contact:</strong> Questions about this policy can be submitted through the in-app Feedback screen to the administrator.</p>
            </div>
            <button onClick={() => setShowPrivacyPolicy(false)} style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 8 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function inputStyle(t) {
  return { width: "100%", padding: "13px 14px", borderRadius: 12, border: `1px solid ${t.border}`, fontSize: 14.5, color: t.text, background: t.surface, outline: "none", boxSizing: "border-box", marginBottom: 10 };
}
function btnStyle(t, filled) {
  return filled
    ? { width: "100%", padding: "13px", borderRadius: 12, border: "none", background: t.primary, color: t.bubbleMeText, fontWeight: 700, fontSize: 15, cursor: "pointer" }
    : { width: "100%", padding: "12px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontWeight: 600, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 };
}
function friendlyError(err) {
    const code = err?.code ?? err;
    const map = {
      "auth/email-already-in-use": "That email already has an account — try signing in instead.",
      "auth/invalid-email": "That doesn't look like a valid email.",
      "auth/weak-password": "Password should be at least 6 characters.",
      "auth/wrong-password": "Incorrect password.",
      "auth/user-not-found": "No account found with that email.",
      "auth/invalid-credential": "Incorrect email or password.",
      "permission-denied": "We couldn't save your account profile. Please check your connection and try again.",
      "username-taken": "That username is already taken. Please choose another.",
      "auth/argument-error": "Google sign-in failed. This is usually a configuration issue — make sure the app's SHA-1/SHA-256 fingerprint and OAuth web client ID are registered in the Firebase Console.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled. Please try again.",
    "auth/popup-blocked": "Pop-up was blocked by your browser. Please allow pop-ups for this site.",
    "auth/unauthorized-domain": "Google sign-in is not allowed on this device. Try signing in with email instead.",
    "auth/cancelled-popup-request": "Another pop-up request is already in progress.",
    "auth/account-exists-with-different-credential": "This Google account is already linked to a different sign-in method for this email.",
    "USER_CANCELLED": "",
    "user-cancelled": "",
    "cancelled": "",
    "CANCELLED": "",
  };
  console.error("[Auth Error]", err);
  const mapped = map[code];
  if (mapped !== undefined) return mapped;

  // CapGo capacitor-social-login numeric error codes (Android native path).
  const nativeMap = {
    "-3": "Google sign-in was cancelled.",
    "-4": "Google sign-in is misconfigured on this device. Check the Firebase Console has the SHA-1 and SHA-256 fingerprint for this app's signing key registered.",
    "-5": "Google sign-in failed on this device. This usually means the Firebase Console doesn't recognize this app — verify the package name (com.nextext.app) and the SHA-1/SHA-256 fingerprint of your signing key are registered.",
    "-6": "A Google sign-in is already in progress. Please wait.",
    "-7": "No Google account is available on this device.",
    "-2": "Google sign-in is not implemented on this device.",
    "-1": "Google sign-in failed (something went wrong on the device).",
  };
  if (nativeMap[String(code)]) return nativeMap[String(code)];

  const rawMsg = typeof err?.message === "string" && err.message ? err.message.trim() : "";
  if (rawMsg) {
    if (
      rawMsg.toLowerCase().includes("play services") ||
      rawMsg.toLowerCase().includes("play store") ||
      rawMsg.toLowerCase().includes("google play")
    ) {
      return "Please make sure Play Store / Google Play Services is enabled on your device, then try again.";
    }
    if (rawMsg !== String(code)) {
      return `Google sign-in failed: ${rawMsg}`;
    }
  }
  return `Google sign-in failed (${code || "unknown error"}). Check that your Google account is available and that the app's SHA-1/SHA-256 fingerprint is registered in the Firebase Console.`;
}