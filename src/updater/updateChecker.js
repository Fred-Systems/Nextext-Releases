import { Capacitor, registerPlugin } from "@capacitor/core";
import { version as APP_VERSION } from "../../package.json";

const GITHUB_REPO = "Fred-Systems/nextext";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const LAST_SEEN_KEY = "nextext_last_seen_release";
const OVERRIDE_KEY = "nextext_app_version_override";

const NextextNative = registerPlugin("NextextNative");

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function readOverride() {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return (v && typeof v === "string" && v.trim()) ? v.trim() : null;
  } catch {
    return null;
  }
}

export function getCurrentVersion() {
  const override = readOverride();
  return override || APP_VERSION;
}

export async function checkForUpdate() {
  const currentVersion = getCurrentVersion();
  try {
    const res = await fetch(`${GITHUB_API}?per_page=10`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) {
      // GitHub rate limiting is common on mobile networks (shared IP, 60 req/hr
      // unauthenticated). Treating it as "no update" is wrong — surface it so
      // the UI can say "could not check" instead of "up to date".
      const remaining = res.headers.get("x-ratelimit-remaining");
      const limited = res.status === 403 && remaining === "0";
      const err = new Error(
        limited
          ? "GitHub's update API is rate-limited on this network. Please try again later."
          : `Update check failed (HTTP ${res.status}).`
      );
      err.code = limited ? "RATE_LIMITED" : `HTTP_${res.status}`;
      throw err;
    }
    const releases = await res.json();
    if (!Array.isArray(releases)) throw new Error("Update check returned unexpected data.");
    // Pick the newest non-prerelease tag that has an APK and is newer than us.
    const candidates = releases
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => ({
        tag: r.tag_name || "",
        name: r.name || `Version ${(r.tag_name || "").replace(/^v/i, "")}`,
        body: r.body || "No changelog provided.",
        apk: (r.assets || []).find((a) => a.name && a.name.endsWith(".apk")),
        html_url: r.html_url,
      }))
      .filter((r) => r.tag && compareVersions(r.tag, currentVersion) > 0 && r.apk);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => compareVersions(b.tag, a.tag));
    const best = candidates[0];
    return {
      version: best.tag.replace(/^v/i, ""),
      name: best.name,
      body: best.body,
      downloadUrl: best.apk.browser_download_url,
      releaseUrl: best.html_url,
    };
  } catch (e) {
    console.error("[updater] checkForUpdate failed:", e);
    const err = new Error(e?.message || "Could not check for updates.");
    err.code = e?.code || "NETWORK";
    throw err;
  }
}

// Latest published (non-draft, non-prerelease) APK download URL, regardless of
// whether it's newer than the running app — used to include the install link in
// contact invites. Returns null on any failure (rate limit, network, no APK).
export async function getLatestApkUrl() {
  try {
    const res = await fetch(`${GITHUB_API}?per_page=1`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return null;
    const releases = await res.json();
    const release = (Array.isArray(releases) ? releases : [])
      .find((r) => !r.draft && !r.prerelease && (r.assets || []).some((a) => a.name && a.name.endsWith(".apk")));
    const apk = (release?.assets || []).find((a) => a.name && a.name.endsWith(".apk"));
    return apk?.browser_download_url || null;
  } catch {
    return null;
  }
}

// Total downloads of ALL published APK releases, summed across every version
// (GitHub tracks a per-asset download_count). Used on the login page; hides
// itself if the admin disables the counter. Returns null when the count can't
// be fetched. The API caps pages at 100 releases; paginate until empty.
export async function getApkDownloadCount() {
  try {
    let page = 1;
    let total = 0;
    let seenAny = false;
    for (let pages = 0; pages < 5; pages++) {
      const res = await fetch(`${GITHUB_API}?per_page=100&page=${page}`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) return seenAny ? total : null;
      const releases = await res.json();
      if (!Array.isArray(releases) || releases.length === 0) break;
      for (const r of releases) {
        if (r.draft || r.prerelease) continue;
        for (const a of r.assets || []) {
          if (a.name && a.name.endsWith(".apk") && typeof a.download_count === "number") {
            total += a.download_count;
            seenAny = true;
          }
        }
      }
      if (releases.length < 100) break;
      page++;
    }
    return seenAny ? total : null;
  } catch {
    return null;
  }
}

export function openDownloadUrl(url) {
  if (!url) return;
  // On Android, window.open("_system") can silently no-op (returns a truthy
  // window handle without opening anything). Route through the native plugin
  // instead, which launches the real system browser via an Android intent.
  if (Capacitor.isNativePlatform()) {
    try {
      NextextNative.openExternalUrl({ url });
      return;
    } catch { /* fall through to web fallbacks */ }
  }
  // Web / fallback: try _system, then _blank, then direct navigation.
  try {
    const w = window.open(url, "_system");
    if (w) return;
  } catch { /* _system not supported */ }
  try {
    const w = window.open(url, "_blank");
    if (w) return;
  } catch { /* popup blocked */ }
  window.location.href = url;
}

// Downloads + installs the APK inside the app (native plugin, no browser
// needed). Falls back to opening the URL externally when the native path is
// unavailable or fails.
export async function downloadUpdate(url) {
  if (!url) return false;
  if (Capacitor.isNativePlatform()) {
    try {
      await NextextNative.downloadAndInstallApk({ url });
      return true;
    } catch (e) {
      if (e?.message?.includes("REQUIRES_INSTALL_PERMISSION")) {
        // The native layer already opened the "Install unknown apps" settings
        // screen — tell the caller why so the UI can show guidance.
        const err = new Error("Allow NexText to install apps in the screen that just opened, then tap Update again.");
        err.code = "INSTALL_PERMISSION";
        throw err;
      }
      console.error("[updater] native APK download failed, falling back to browser:", e);
    }
  }
  openDownloadUrl(url);
  return false;
}

// Downloads the APK into the device's Downloads folder without launching the
// installer. Returns { path, fileName } on success.
export async function saveApkToDevice(url) {
  if (!url) return null;
  if (Capacitor.isNativePlatform()) {
    try {
      return await NextextNative.saveApkToDevice({ url });
    } catch (e) {
      console.error("[updater] native APK save failed:", e);
      throw e;
    }
  }
  openDownloadUrl(url);
  return null;
}

export function getLastSeenRelease() {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function setLastSeenRelease(version) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch { /* silent */ }
}
