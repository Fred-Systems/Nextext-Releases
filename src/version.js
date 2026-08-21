import pkg from "../package.json";

// Single source of truth for the running app version. Kept in package.json and
// mirrored into android/app/build.gradle at release time. The Settings screen,
// splash, and any "update available" UI read APP_VERSION so the user can always
// confirm which build they're on.
export const APP_VERSION = pkg.version;
