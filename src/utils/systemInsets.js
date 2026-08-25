import { Capacitor } from "@capacitor/core";
import NextextNative from "../native/nextextNative";

let cached = null;

export async function getSystemInsets() {
  if (cached) return cached;
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await NextextNative.getSystemInsets();
      cached = { top: res.top || 0, bottom: res.bottom || 0 };
      return cached;
    } catch { /* fall through */ }
  }
  cached = { top: 0, bottom: 0 };
  return cached;
}

export async function getBottomInset() {
  const insets = await getSystemInsets();
  return Math.max(insets.bottom, 20);
}
