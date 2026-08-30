// Shared message-bubble corner styles. Used by the conversation renderer
// (ConversationScreen) and the Theme picker (ThemeSheet) so there is a single
// source of truth. Each style returns the corner radius (px) for the current
// message bubble; some vary by grouping to mimic chat "tails".
export const BUBBLE_STYLES = {
  default: () => 14,
  modern: () => 8,
  soft: () => 10,
  cozy: () => 12,
  classic: () => 16,
  rounded: () => 20,
  chonky: () => 24,
  maxRound: () => 28,
  pill: (gPrev, gNext) => (gPrev || gNext ? 18 : 26),
  bubble: (gPrev) => (gPrev ? 4 : 18),
  minimal: () => 6,
  square: () => 5,
  sharp: () => 2,
  outlined: () => 14,
};

// Display order + human labels for the picker.
export const BUBBLE_STYLE_ORDER = [
  "default", "modern", "soft", "cozy", "classic", "rounded", "chonky",
  "maxRound", "pill", "bubble", "minimal", "square", "sharp", "outlined",
];

export const BUBBLE_STYLE_LABELS = {
  default: "Default", modern: "Modern", soft: "Soft", cozy: "Cozy",
  classic: "Classic", rounded: "Rounded", chonky: "Chunky", maxRound: "Super Round",
  pill: "Pill", bubble: "Tail", minimal: "Minimal", square: "Square",
  sharp: "Sharp", outlined: "Outlined",
};

export function getBubbleRadius(style, groupedWithPrev, groupedWithNext) {
  const fn = BUBBLE_STYLES[style] || BUBBLE_STYLES.default;
  return fn(groupedWithPrev, groupedWithNext);
}

export function getBubbleStyle() {
  try { return localStorage.getItem("nextext_bubble_style") || "default"; } catch { return "default"; }
}

export function setBubbleStyle(style) {
  try { localStorage.setItem("nextext_bubble_style", style); } catch {}
}

// Resolved style object for a bubble (background + radius + outline), given the
// current theme and whether it's the user's own message.
export function resolveBubble(style, isMine, t) {
  const radius = getBubbleRadius(style, false, false);
  return {
    background: isMine ? t.bubbleMe : t.bubbleThem,
    color: isMine ? t.bubbleMeText : t.bubbleThemText,
    borderRadius: radius,
    border: style === "outlined" ? `1.5px solid ${isMine ? t.primary : t.border}` : "none",
    boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
  };
}
