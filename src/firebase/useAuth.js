import { useState, useEffect } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp, arrayUnion, collection, query, where, getDocs, limit } from "firebase/firestore";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { SocialLogin as CapgoSocialLogin } from "@capgo/capacitor-social-login";
import { auth, googleProvider, db } from "../firebase/config";
import { changeNames } from "../firebase/names";

const LegacyGoogleSignIn = registerPlugin("LegacyGoogleSignIn");

// Rejects the promise if it hasn't settled within ms, so a broken native
// Google sign-in can never leave the UI stuck on "Please wait…" forever.
const withTimeout = (promise, ms, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });

// Capgo and Legacy Google Sign-In can return the credential in several shapes
// (idToken/accessToken at the top level, under .response, or nested inside
// .authentication). Calling GoogleAuthProvider.credential(undefined) throws
// auth/argument-error, so build the Firebase credential from whatever token
// actually came back — preferring an ID token, falling back to an access token.
function buildGoogleCredential(profile = {}) {
  const idToken =
    profile.idToken ||
    profile.id_token ||
    profile.authentication?.idToken ||
    profile.authentication?.id_token;
  const accessToken =
    profile.accessToken ||
    profile.access_token ||
    profile.authentication?.accessToken ||
    profile.authentication?.access_token;
  if (!idToken && !accessToken) {
    throw new Error("Google sign-in returned no usable credential.");
  }
  return GoogleAuthProvider.credential(idToken, accessToken);
}

// One account per email: Firebase Auth itself already prevents creating a
// second account with the same email under a different password (it'll
// throw auth/email-already-in-use). For Google Sign-In merging into an
// existing email/password account, enable "One account per email address"
// under Firebase Console -> Authentication -> Settings -> User account linking.

export function useAuth() {
  const [user, setUser] = useState(null);
  const [userDoc, setUserDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub;
    let safetyTimer;
    try {
      unsub = onAuthStateChanged(auth, async (firebaseUser) => {
        clearTimeout(safetyTimer);
        setUser(firebaseUser);
        if (firebaseUser) {
          try {
            const ref = doc(db, "users", firebaseUser.uid);
            const snap = await getDoc(ref);
            setUserDoc(snap.exists() ? snap.data() : null);
          } catch (e) {
            console.error("[useAuth] Failed to fetch user doc:", e);
            setUserDoc(null);
          }
        } else {
          // Check for redirect result (Capacitor/WebView Google sign-in)
          try {
            const result = await getRedirectResult(auth);
            if (result?.user) {
              const ref = doc(db, "users", result.user.uid);
              const snap = await getDoc(ref);
              if (!snap.exists()) {
                await createUserProfile(result.user, {
                  email: result.user.email,
                  username: result.user.email.split("@")[0],
                  displayName: result.user.displayName || "New User",
                });
              }
              setUserDoc(snap.exists() ? snap.data() : null);
              setUser(result.user);
            }
          } catch (e) {
            console.error("[useAuth] Redirect result error:", e);
          }
          setUserDoc(null);
        }
        setLoading(false);
      });
      // Fallback: if auth never resolves in 8 seconds, stop loading
      // so the user at least sees the login screen instead of a blank screen.
      safetyTimer = setTimeout(() => {
        console.warn("[useAuth] ⚠️ Auth timed out after 8s — onAuthStateChanged never fired. Showing login screen.");
        setUser(null);
        setUserDoc(null);
        setLoading(false);
      }, 8000);
    } catch (e) {
      console.error("[useAuth] onAuthStateChanged failed:", e);
      setLoading(false);
    }
    return () => { clearTimeout(safetyTimer); if (unsub) unsub(); };
  }, []);

  async function signUpWithEmail(email, password, username, displayName, phone) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Creating the account signs the user in, so Firestore `isSignedIn()` is now
    // true. Force-refresh the ID token anyway so the very first write can't race
    // a lagging native token (mirrors the Google sign-up path).
    try { await cred.user.getIdToken(true); } catch { /* non-fatal */ }

    // Username-uniqueness check. It MUST run AFTER sign-in: the `users` read rule
    // requires isSignedIn(), so a pre-auth query throws permission-denied and
    // would block signup entirely. Now that we're authenticated it succeeds.
    const lower = String(username || "").trim().toLowerCase();
    try {
      const q = query(
        collection(db, "users"),
        where("usernameLower", ">=", lower),
        where("usernameLower", "<=", lower + "￰"),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.docs.some((d) => d.data().usernameLower === lower)) {
        // Roll back the freshly minted auth account and report a friendly error.
        try { await cred.user.delete(); } catch { /* best effort */ }
        const e = new Error("That username is already taken. Please choose another.");
        e.code = "username-taken";
        throw e;
      }
    } catch (e) {
      if (e?.code === "username-taken") throw e;
      // Any other read failure is non-fatal here — creation still proceeds and
      // createUserProfile's retry loop is the real guard.
    }

    // Create the profile doc. Retry a few times on permission-denied because the
    // freshly issued token can still lag on native/Capacitor builds. Use merge:true
    // so a partial/leftover doc can't collide.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        try { await cred.user.getIdToken(true); } catch { /* non-fatal */ }
        await createUserProfile(cred.user, { email, username, displayName }, true);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (e?.code === "permission-denied" && attempt < 3) { await sleep(350 * (attempt + 1)); continue; }
        throw e;
      }
    }
    if (lastErr) throw lastErr;

    if (phone && phone.trim()) {
      const digits = String(phone).replace(/[^\d+]/g, "");
      // Use setDoc merge so this can't throw "No document to update" if the
      // profile doc write above is still settling on a slow/old WebView.
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          phoneNumber: phone.trim(),
          phoneNumberNormalized: digits || null,
        }, { merge: true });
      } catch (e) {
        // Non-fatal: if it still fails, the profile doc exists and the phone
        // number can be re-saved later from Settings without blocking signup.
        console.warn("[useAuth] phone save skipped:", e?.message);
      }
    }
    return cred.user;
  }

  async function signInWithEmail(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function signInWithGoogle(markProfileComplete = false) {
    // Creates the Firestore profile for a brand-new Google account and marks it
    // complete when this was the sign-up flow (which already collected names).
    const ensureProfile = async (user, extra) => {
      // Always resolve the real signed-in uid. Some native Google plugins hand
      // back a raw object WITHOUT a `.user` wrapper, so `user.uid` can be
      // undefined — writing to `users/undefined` then fails the `isSelf` create
      // rule and surfaces as "Missing or insufficient permissions". Fall back to
      // the actually authenticated user so the path is always correct.
      const uid = user?.uid || auth.currentUser?.uid;
      if (!uid) throw new Error("Sign-in did not return an authenticated user.");
      const profileUser = {
        uid,
        email: user?.email ?? auth.currentUser?.email ?? null,
        displayName: user?.displayName ?? auth.currentUser?.displayName ?? null,
        photoURL: user?.photoURL ?? auth.currentUser?.photoURL ?? null,
      };
      // Force-refresh the ID token so Firestore's auth context is current
      // before we write the user doc — otherwise the first write right after
      // sign-in can hit "Missing or insufficient permissions" on native.
      try { if (user?.getIdToken) await user.getIdToken(true); else if (auth.currentUser?.getIdToken) await auth.currentUser.getIdToken(true); } catch { /* non-fatal */ }
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await createUserProfile(profileUser, {
          email: profileUser.email,
          username: profileUser.email ? profileUser.email.split("@")[0] : `user-${uid.slice(0, 6)}`,
          displayName: profileUser.displayName || extra?.displayName || "New User",
          photoURL: profileUser.photoURL || extra?.photoUrl || extra?.photoURL || null,
        });
        if (markProfileComplete) await updateDoc(ref, { profileComplete: true });
      }
      return profileUser;
    };

    // Native (Capacitor) builds use the real Google Sign-In plugin — no popup
    // or redirect, which do not work reliably inside the Android WebView.
    // Native (Capacitor) builds try native Play Services first, but fall back
    // seamlessly to Web-based Google OAuth if Play Services/Play Store is disabled or missing.
    if (Capacitor.isNativePlatform()) {
      try {
        const legacy = await withTimeout(
          LegacyGoogleSignIn.signIn(),
          4000,
          "Play Services unavailable"
        );
        const legacyUser = await signInWithCredential(auth, buildGoogleCredential(legacy || {}));
        return await ensureProfile(legacyUser.user, legacy);
      } catch (legacyErr) {
        if (legacyErr?.code === "CANCELLED" || legacyErr?.message?.includes("cancelled")) {
          throw legacyErr;
        }
      }

      try {
        const capgoRes = await withTimeout(
          CapgoSocialLogin.login({ provider: "google", options: { scopes: ["email", "openid", "profile"] } }),
          4000,
          "Play Services unavailable"
        );
        const capgoUser = await signInWithCredential(auth, buildGoogleCredential(capgoRes?.response || {}));
        return await ensureProfile(capgoUser.user, capgoRes?.response);
      } catch (capgoErr) {
        if (capgoErr?.code === "CANCELLED" || capgoErr?.message?.includes("cancelled")) {
          throw capgoErr;
        }
      }
    }

    // Web-based Google OAuth flow (works on all devices including those without Play Services).
    // - On a normal desktop browser, signInWithPopup opens the OAuth window.
    // - On a mobile browser, popup may be blocked; we use redirect directly.
    // - On a Capacitor/Android WebView *without* Play Services, both native
    //   paths above already failed silently — signInWithRedirect opens the
    //   system browser (or an embedded Web View with the OAuth consent page),
    //   completes the standard Google OAuth 2.0 web flow, and on return the
    //   getRedirectResult() handler in onAuthStateChanged resolves the credential.
    //
    // On mobile / WebView, popups are unreliable and (on devices without Play
    // Store) surface the "Cross-Origin-Opener-Policy policy would block the
    // window.closed call" warning and hang. Go straight to the redirect flow.
    const isMobile =
      Capacitor.isNativePlatform() ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

    if (isMobile) {
      try {
        await signInWithRedirect(auth, googleProvider);
        // Resolution happens asynchronously via getRedirectResult in
        // onAuthStateChanged (see line ~88). Return null so the caller does not
        // wait on a popup that never resolves.
        return null;
      } catch (redirectErr) {
        throw playStoreFriendlyError(redirectErr);
      }
    }

    try {
      const cred = await signInWithPopup(auth, googleProvider);
      return await ensureProfile(cred.user, null);
    } catch (e) {
      if (
        e.code === "auth/popup-blocked" ||
        e.code === "auth/popup-closed-by-user" ||
        e.code === "auth/unauthorized-domain" ||
        e.code === "auth/operation-not-supported-in-this-environment" ||
        e.code === "auth/cancelled-popup-request" ||
        e.code === "auth/internal-error"
      ) {
        // signInWithRedirect is the Play-Store-independent web fallback:
        // it works inside WebViews and on devices where the popup API is
        // unavailable. Resolution happens asynchronously via getRedirectResult
        // in the onAuthStateChanged effect above (see lines ~60-78).
        try {
          await signInWithRedirect(auth, googleProvider);
          return null;
        } catch (redirectErr) {
          throw playStoreFriendlyError(redirectErr);
        }
      }
      throw playStoreFriendlyError(e);
    }
  }

  // On devices with Play Store / Google Play Services disabled, native Google
  // sign-in can surface as auth/argument-error (or a generic message) — convert
  // that into the exact user-facing hint requested instead of the raw Firebase
  // error string.
  function playStoreFriendlyError(err) {
    const code = err?.code || "";
    const msg = String(err?.message || "").toLowerCase();
    // Only flag a genuine Play Services / Play Store problem. A generic
    // auth/argument-error is almost always an OAuth/client-id/SHA config issue,
    // NOT a missing Play Store — mislabeling it sends users down the wrong path.
    const isPlayStoreIssue =
      msg.includes("play services") ||
      msg.includes("play store") ||
      msg.includes("google play services") ||
      msg.includes("google play store");
    if (isPlayStoreIssue) {
      const e = new Error("Please make sure Play Store / Google Play Services is enabled on your device, then try again.");
      e.code = "auth/argument-error";
      return e;
    }
    return err;
  }

  async function completeGoogleSignup(username, displayName, usernameLower, phone) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in.");
    await changeNames(uid, { username, displayName, phone });
    const snap = await getDoc(doc(db, "users", uid));
    setUserDoc(snap.exists() ? snap.data() : null);
  }

  async function completeProfile(username, displayName, phone) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in.");
    await changeNames(uid, { username, displayName, phone });
    const snap = await getDoc(doc(db, "users", uid));
    setUserDoc(snap.exists() ? snap.data() : null);
  }

  async function createUserProfile(fbUser, { email, username, displayName, photoURL }, profileComplete = false) {
    await setDoc(doc(db, "users", fbUser.uid), {
      email,
      emailLower: email.toLowerCase(),
      username,
      usernameLower: username.toLowerCase(),
      displayName,
      photoURL: photoURL || null,
      profileComplete,
      about: "",
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      isOnline: true,
      theme: "default",
      fcmTokens: [],
      role: "user",
      acceptedTermsAt: serverTimestamp(),
      acceptedTermsVersion: "1.0",
      privacy: {
        lastSeenVisibility: "contacts",
        statusVisibility: "contacts",
        statusAllowedList: [],
        statusExcludedList: [],
        readReceiptsEnabled: true,
        typingIndicatorEnabled: true,
      },
      voiceNoteSendMode: "instant",
      twoFactor: { enabled: false, totpSecretEncrypted: null, backupCodesHashed: [] },
      moderation: { banType: "none", mutedUntil: null, bannedAt: null, bannedBy: null, banReason: null },
      accountType: "standard",
      parentUid: null,
      restrictions: null,
      dataUsage: { bytesUsedToday: 0, bytesUsedDate: "", bytesUsedAllTime: 0 },
      dataLimit: { dailyLimitBytes: null },
    }, { merge: true });
  }

  async function logOut() {
    return signOut(auth);
  }

  // Returns true if the signed-in account uses email/password auth (so it can
  // change its password / email) rather than Google or phone sign-in.
  function isEmailPasswordAccount() {
    return Array.isArray(auth.currentUser?.providerData)
      ? auth.currentUser.providerData.some((p) => p.providerId === "password")
      : false;
  }

  // Require the current password (re-authenticate) before changing it. This is
  // the security gate the user requested: the old password must be supplied.
  async function changePassword(oldPassword, newPassword) {
    const u = auth.currentUser;
    if (!u || !u.email) throw new Error("Not signed in with an email account.");
    const cred = EmailAuthProvider.credential(u.email, oldPassword);
    await reauthenticateWithCredential(u, cred);
    await updatePassword(u, newPassword);
  }

  // Changing the email also requires the account password for re-authentication.
  // The previous address is preserved in emailHistory so an admin can always see
  // what an account used to be tied to.
  async function changeEmail(newEmail, password) {
    const u = auth.currentUser;
    if (!u || !u.email) throw new Error("Not signed in with an email account.");
    const normalized = String(newEmail).trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) throw new Error("Enter a valid email address.");
    const cred = EmailAuthProvider.credential(u.email, password);
    await reauthenticateWithCredential(u, cred);
    const oldEmail = u.email;
    await updateEmail(u, normalized);
    const ref = doc(db, "users", u.uid);
    const curSnap = await getDoc(ref);
    const curData = curSnap.exists() ? curSnap.data() : {};
    const emailPatch = { email: normalized, emailLower: normalized };
    // Re-publish the searchable email copy only if the user opted into email
    // discovery; otherwise strip it so searches can't surface them by email.
    if (curData?.searchVisibility?.email) emailPatch.searchEmail = normalized;
    else emailPatch.searchEmail = deleteField();
    await updateDoc(ref, emailPatch);
    try {
      await updateDoc(ref, {
        emailHistory: arrayUnion({ email: oldEmail, changedAt: serverTimestamp() }),
      });
    } catch { /* emailHistory field may not exist yet — non-fatal */ }
    const snap = await getDoc(ref);
    if (snap.exists()) setUserDoc(snap.data());
  }

  return { user, userDoc, loading, signUpWithEmail, signInWithEmail, signInWithGoogle, completeGoogleSignup, completeProfile, logOut, isEmailPasswordAccount, changePassword, changeEmail };
}
