// Single source of truth for the installed APK version. Kept in sync with
// android/app/build.gradle (versionName / versionCode) at release time.
export const APP_VERSION = "1.8.14";
export const APP_VERSION_CODE = 214;

// A monotonically increasing web/build counter. Bumped on every web-side deploy
// so the client can detect a newer web build without an APK change. Format is
// intentionally human-readable (YYYY.MM.DD.N). Not the APK version.
export const WEB_BUILD = "2026.09.10.01";

// Compare two "x.y.z" / "x.y.z.n" version strings. Returns <0, 0, or >0.
export function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
