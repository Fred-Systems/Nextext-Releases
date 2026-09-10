// App-icon / app-name disguise service.
//
// The NexText APK ships with 14 launcher entries pointing at MainActivity:
 //   - The default MainActivity (always present, label "NexText", icon
 //     ic_launcher.png). This is the "default" profile.
 //   - 13 activity-aliases (Alias1..Alias13) declared in AndroidManifest.xml.
 //     Aliases 1-5, 8-11 keep the "NexText" label (same app, different wallpaper);
 //     Alias 6 and 12 ship as "Calculator" and Alias 7 and 13 as "Notes". All aliases are
 //     disabled on first install and MainActivity is the only visible launcher
 //     entry.
//
// At runtime the user picks a profile from Settings. We:
//   1. Persist the choice to localStorage (instant UI feedback; this is the
//      authoritative JS-side state, used to decide what gate to render).
//   2. Mirror the choice to SharedPreferences via the native bridge so
//      MainActivity.applyIconProfile() can re-apply it on cold start.
//   3. Call NextextNative.setAppIcon(), which disables every alias except the
//      chosen one, kills the app process, and the launcher re-reads the icon.
//
// The WebView always loads index.html, but the disguise screens
// (CalculatorScreen / NotepadScreen) are shown INSTEAD of the chat list when
// the active profile is icon6 / icon7 and the user hasn't entered their PIN /
// keyword yet. Entering the correct value flips `unlocked` and renders the
// real app as usual.
//
// Disguise behaviour:
//   - icon6 ("Calculator"): a working calculator. The trailing digits of every
//     user input are compared against a stored PIN (4-6 digits). Match → unlock.
//   - icon7 ("Notes"): a working notepad. The stored "unlock keyword" must
//     appear as a whole word in the current note text. This way the notepad
//     looks like a real text editor with real content, but typing the keyword
//     somewhere in the note unlocks the app.

const STORAGE_KEY = "nextext_icon_profile";
const PIN_KEY = "nextext_disguise_pin";
const KEYWORD_KEY = "nextext_disguise_keyword";

// Mirror table of all 14 launcher profiles. Keep in sync with the
// <activity-alias> entries in AndroidManifest.xml and the profile table in
// NextextNativePlugin.java — the JS side uses this to render the picker UI
// (label, preview image, "is this a disguise?" flag).
export const ICON_PROFILES = [
  { id: "default", label: "NexText", kind: "nextext", iconPath: "/ic_launcher.png" },
  { id: "icon1",   label: "NexText", kind: "splash", iconPath: "/ic_icon1.png" },
  { id: "icon2",   label: "NexText", kind: "splash", iconPath: "/ic_icon2.png" },
  { id: "icon3",   label: "NexText", kind: "splash", iconPath: "/ic_icon3.png" },
  { id: "icon4",   label: "NexText", kind: "splash", iconPath: "/ic_icon4.png" },
  { id: "icon5",   label: "NexText", kind: "splash", iconPath: "/ic_icon5.png" },
  { id: "icon8",   label: "NexText", kind: "splash", iconPath: "/ic_icon8.png" },
  { id: "icon9",   label: "NexText", kind: "splash", iconPath: "/ic_icon9.png" },
  { id: "icon10",  label: "NexText", kind: "splash", iconPath: "/ic_icon10.png" },
  { id: "icon11",  label: "NexText", kind: "splash", iconPath: "/ic_icon11.png" },
  { id: "icon6",   label: "Calculator", kind: "calculator", iconPath: "/ic_icon6.png" },
  { id: "icon7",   label: "Notes",      kind: "notes",      iconPath: "/ic_icon7.png" },
  { id: "icon12",  label: "Calculator", kind: "calculator", iconPath: "/ic_icon12.png" },
  { id: "icon13",  label: "Notes",      kind: "notes",      iconPath: "/ic_icon13.png" },
  // Special "discipline" profiles (icon14/icon15). When active, the app shows an
  // animated warning on the launch splash. Hidden from the picker unless the
  // admin enables them (globalSettings.hideSpecialIcons === false).
  { id: "icon14",  label: "NexText", kind: "splash", iconPath: "/ic_icon14.png", special: true },
  { id: "icon15",  label: "NexText", kind: "splash", iconPath: "/ic_icon15.png", special: true },
  // Mizrachi mode (icon16/icon17). Same launch behaviour as icon14/icon15
  // (special splash words, hidden by the admin "hide special icons" toggle),
  // but shown in the picker under the "Mizrachi mode" name. On the device home
  // screen they resolve to the default NexText launcher icon (see native
  // aliases + NextextNativePlugin mapping).
  { id: "icon16",  label: "Mizrachi mode", kind: "splash", iconPath: "/ic_icon16.png", special: true },
  { id: "icon17",  label: "Mizrachi mode", kind: "splash", iconPath: "/ic_icon17.png", special: true },
  // v1.7.93 disguise icons (user-supplied artwork, processed with the same
  // full-bleed square pipeline as icon12/icon13): Calculator + Notepad.
  { id: "icon18",  label: "Calculator", kind: "calculator", iconPath: "/ic_icon18.png" },
  { id: "icon19",  label: "Notes",      kind: "notes",       iconPath: "/ic_icon19.png" },
];

const DEFAULT_PROFILE = "default";

// Synchronous access to the native bridge (window.NexTextNativeBridge) that
// MainActivity installs. Reading SharedPreferences directly (instead of an
// async Capacitor call) means the first paint already has the correct profile
// + unlock secret — localStorage is dropped when setAppIcon kills the process.
function nativeBridge() {
  try {
    if (typeof window !== "undefined" && window.NexTextNativeBridge) return window.NexTextNativeBridge;
  } catch { /* bridge unavailable (e.g. web preview) */ }
  return null;
}

function readNative(method) {
  try {
    const b = nativeBridge();
    if (b && typeof b[method] === "function") {
      const v = b[method]();
      if (v != null && v !== "") return v;
    }
  } catch { /* best-effort */ }
  return null;
}

async function writeNativeSecret(kind, value) {
  try {
    const cap = window?.Capacitor;
    const plugin = cap && cap.Plugins && cap.Plugins.NextextNative;
    if (plugin && typeof plugin.setDisguiseSecret === "function") {
      await plugin.setDisguiseSecret({ kind, value: value || "" });
    }
  } catch { /* best-effort */ }
}

function readProfile() {
  // Prefer native storage so a cold start after setAppIcon's kill shows the
  // correct launcher icon immediately (no splash flash for disguised apps).
  const native = readNative("getActiveIcon");
  if (native && ICON_PROFILES.some((p) => p.id === native)) return native;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    // Defensive: ignore unknown ids (e.g. after a profile was removed in a
    // future build) so the app never gets stuck on a missing alias.
    if (!ICON_PROFILES.some((p) => p.id === raw)) return DEFAULT_PROFILE;
    return raw;
  } catch { return DEFAULT_PROFILE; }
}

export function getActiveProfile() {
  const id = readProfile();
  return ICON_PROFILES.find((p) => p.id === id) || ICON_PROFILES[0];
}

export function getActiveProfileId() {
  return readProfile();
}

// Reads the authoritative profile id the native side persisted in
// SharedPreferences (written by setAppIcon). The WebView localStorage can be
// dropped independently, so the disguise gate calls this on every cold start
// to stay in sync with the launcher icon the user actually tapped. Resolves to
// the reconciled id (also written back to localStorage) or falls back to the
// current localStorage value.
export async function syncNativeProfile() {
  try {
    const cap = window?.Capacitor;
    const plugin = cap && cap.Plugins && cap.Plugins.NextextNative;
    if (plugin && typeof plugin.getActiveIconProfile === "function") {
      const res = await plugin.getActiveIconProfile();
      const id = res?.profileId;
      if (id && ICON_PROFILES.some((p) => p.id === id)) {
        try { localStorage.setItem(STORAGE_KEY, id); } catch { /* best-effort */ }
        return id;
      }
    }
  } catch {
    /* best-effort — fall through to localStorage */
  }
  return readProfile();
}

export function isDisguiseActive() {
  const p = getActiveProfile();
  if (!p) return false;
  return p.kind === "calculator" || p.kind === "notes";
}

// Persists + applies a new icon profile. On the native side this kills the
// process so the launcher picks up the new icon. The function resolves AFTER
// the native call has been issued (we don't wait for process death — that
// would hang forever).
export async function setActiveProfile(profileId) {
  const next = ICON_PROFILES.some((p) => p.id === profileId) ? profileId : DEFAULT_PROFILE;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* best-effort */ }
  try {
    const cap = window?.Capacitor;
    const plugin = cap && cap.Plugins && cap.Plugins.NextextNative;
    if (plugin && typeof plugin.setAppIcon === "function") {
      await plugin.setAppIcon({ profileId: next });
      // setAppIcon kills the process on success — anything after this line
      // may not run on this JS context.
      return { applied: true, killed: true };
    }
  } catch (e) {
    // Fall back silently — the JS-side state is still updated and the
    // disguise screen will gate the UI, only the launcher icon won't change.
  }
  return { applied: false, killed: false, profileId: next };
}

// --- Calculator disguise ---

const DEFAULT_CALC_PIN = "1234";

export function getCalculatorPin() {
  try {
    const local = localStorage.getItem(PIN_KEY);
    if (local) return local;
  } catch { /* fall through to native */ }
  const native = readNative("getCalculatorPin");
  if (native) return native;
  return DEFAULT_CALC_PIN;
}

export function setCalculatorPin(pin) {
  const clean = String(pin || "").replace(/\D/g, "").slice(0, 6);
  try { localStorage.setItem(PIN_KEY, clean); } catch { /* best-effort */ }
  writeNativeSecret("calculator", clean);
  return clean;
}

export function hasCustomCalculatorPin() {
  try { if (localStorage.getItem(PIN_KEY) != null) return true; } catch { /* fall through */ }
  return readNative("getCalculatorPin") != null;
}

// Pulls the trailing digit-only sequence from a free-form calculator history
// string and compares it to the PIN. Returns true if the most recent N digits
// match the PIN in order (with no intervening non-digits). This is what the
// calculator UI calls every time the user presses a key.
export function calculatorPinMatches(input) {
  if (!input) return false;
  const pin = getCalculatorPin();
  if (!pin) return false;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length < pin.length) return false;
  return digits.slice(-pin.length) === pin;
}

// --- Notepad disguise ---

const DEFAULT_KEYWORD = "open";

export function getNotepadKeyword() {
  try {
    const local = localStorage.getItem(KEYWORD_KEY);
    if (local) return local;
  } catch { /* fall through to native */ }
  const native = readNative("getNotepadKeyword");
  if (native) return native;
  return DEFAULT_KEYWORD;
}

export function setNotepadKeyword(keyword) {
  const clean = String(keyword || "").trim().slice(0, 32);
  try { localStorage.setItem(KEYWORD_KEY, clean); } catch { /* best-effort */ }
  writeNativeSecret("notes", clean);
  return clean;
}

export function hasCustomNotepadKeyword() {
  try { if (localStorage.getItem(KEYWORD_KEY) != null) return true; } catch { /* fall through */ }
  return readNative("getNotepadKeyword") != null;
}

// Returns true if `keyword` appears as a complete word (case-insensitive,
// surrounded by word boundaries or string edges) anywhere in `text`.
export function notepadKeywordMatches(text) {
  const kw = getNotepadKeyword();
  if (!kw) return false;
  if (!text) return false;
  try {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i");
    return re.test(String(text));
  } catch {
    return String(text).toLowerCase().includes(kw.toLowerCase());
  }
}
