// Shared message-bubble styles. Used by the conversation renderer (ConversationScreen)
// and the Theme picker (ThemeSheet) so preview == reality. Each style is a descriptor;
// getBubbleRadius / resolveBubble turn it into concrete styles.
export const BUBBLE_STYLES = {
  default:  { r: 14 },
  modern:   { r: 8 },
  soft:     { r: 10 },
  cozy:     { r: 12 },
  classic:  { r: 16 },
  rounded:  { r: 20 },
  chonky:   { r: 24 },
  maxRound: { r: 30 },
  pill:     { r: 30, stack: true },
  bubble:   { r: 18, tail: true },
  minimal:  { r: 6 },
  square:   { r: 4 },
  sharp:    { r: 2 },
  outlined: { r: 14, border: true },
  gradient: { r: 18, gradient: true },
};

export const BUBBLE_STYLE_ORDER = [
  "default", "modern", "soft", "cozy", "classic", "rounded", "chonky",
  "maxRound", "pill", "bubble", "minimal", "square", "sharp", "outlined", "gradient",
];

export const BUBBLE_STYLE_LABELS = {
  default: "Default", modern: "Modern", soft: "Soft", cozy: "Cozy", classic: "Classic",
  rounded: "Rounded", chonky: "Chunky", maxRound: "Super Round", pill: "Pill",
  bubble: "Tail", minimal: "Minimal", square: "Square", sharp: "Sharp",
  outlined: "Outlined", gradient: "Gradient",
};

export function getBubbleRadius(style, groupedWithPrev, groupedWithNext) {
  const d = BUBBLE_STYLES[style] || BUBBLE_STYLES.default;
  const r = d.r;
  // "tail"/"stack": when a message continues a run from the same sender, square
  // the top corners so the bubbles look grouped/connected.
  if ((d.tail || d.stack) && groupedWithPrev) return { tl: 4, tr: 4, br: r, bl: r };
  return { tl: r, tr: r, br: r, bl: r };
}

export function getBubbleStyle() {
  try { return localStorage.getItem("nextext_bubble_style") || "default"; } catch { return "default"; }
}

export function setBubbleStyle(style) {
  try { localStorage.setItem("nextext_bubble_style", style); } catch {}
}

// Full inline style for a bubble container.
export function resolveBubble(style, isMine, t, groupedWithPrev = false, groupedWithNext = false) {
  const { tl, tr, br, bl } = getBubbleRadius(style, groupedWithPrev, groupedWithNext);
  const d = BUBBLE_STYLES[style] || BUBBLE_STYLES.default;
  let background = isMine ? t.bubbleMe : t.bubbleThem;
  let color = isMine ? t.bubbleMeText : t.bubbleThemText;
  if (d.gradient) {
    background = isMine
      ? `linear-gradient(135deg, ${t.primary}, ${t.accent})`
      : `linear-gradient(135deg, ${t.bubbleThem}, ${t.primaryLight})`;
  }
  const border = d.border ? `1.5px solid ${isMine ? t.primary : t.border}` : "none";
  const boxShadow = d.shadow || "0 1px 2px rgba(0,0,0,0.08)";
  return {
    background,
    color,
    borderRadius: `${tl}px ${tr}px ${br}px ${bl}px`,
    border,
    boxShadow,
  };
}
