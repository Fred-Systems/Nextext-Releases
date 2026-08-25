import { registerPlugin } from "@capacitor/core";

// Registered exactly once here and shared by every module that needs it, so we
// never hit the "plugin already registered" warning (which fires when the same
// plugin name is registered from multiple files / HMR reloads).
const NextextNative = registerPlugin("NextextNative");

export default NextextNative;
export { NextextNative };
