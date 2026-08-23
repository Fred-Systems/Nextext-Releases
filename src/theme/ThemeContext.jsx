import React, { createContext, useContext, useState, useEffect } from "react";

// "emeraldNight" is the new default: black background, green sent bubbles,
// dark grey received bubbles -- matching WhatsApp's actual dark theme.
export const themes = {
  emeraldNight: { name: "Emerald Night",     primary: "#00A884", primaryLight: "#0B141A", bg: "#0B141A", surface: "#111B21", accent: "#00A884", text: "#E9EDEF", textMuted: "#8696A0", bubbleMe: "#005C4B", bubbleMeText: "#E9EDEF", bubbleThem: "#202C33", bubbleThemText: "#E9EDEF", border: "#222D34" },
  default:      { name: "Sable & Coral",     primary: "#0B5345", primaryLight: "#E8F3EF", bg: "#FAF8F3", surface: "#FFFFFF", accent: "#FF6B5B", text: "#1C1C1E", textMuted: "#6B6B6E", bubbleMe: "#0B5345", bubbleMeText: "#FAF8F3", bubbleThem: "#FFFFFF", bubbleThemText: "#1C1C1E", border: "#EEE9DF" },
  midnight:     { name: "Midnight Violet",   primary: "#7C5CFF", primaryLight: "#1E1B2E", bg: "#0F1117", surface: "#181B24", accent: "#33D6A6", text: "#F5F5F7", textMuted: "#8B8D98", bubbleMe: "#7C5CFF", bubbleMeText: "#FFFFFF", bubbleThem: "#1E212B", bubbleThemText: "#F5F5F7", border: "#252836" },
  sunset:       { name: "Sunset Clay",       primary: "#C2502B", primaryLight: "#FBEAE2", bg: "#FFF8F2", surface: "#FFFFFF", accent: "#E8A33D", text: "#3A2218", textMuted: "#8A6F61", bubbleMe: "#C2502B", bubbleMeText: "#FFF8F2", bubbleThem: "#FFFFFF", bubbleThemText: "#3A2218", border: "#F0DDD0" },
  ocean:        { name: "Ocean Glass",       primary: "#0E7C9D", primaryLight: "#E3F4F8", bg: "#F2FAFC", surface: "#FFFFFF", accent: "#1FB6C9", text: "#0B2E38", textMuted: "#5C7D87", bubbleMe: "#0E7C9D", bubbleMeText: "#FFFFFF", bubbleThem: "#FFFFFF", bubbleThemText: "#0B2E38", border: "#DCEEF2" },
  blush:        { name: "Blush Paper",       primary: "#B25775", primaryLight: "#FBEAEF", bg: "#FFF9FA", surface: "#FFFFFF", accent: "#D88FA3", text: "#3D2730", textMuted: "#8A7178", bubbleMe: "#B25775", bubbleMeText: "#FFF9FA", bubbleThem: "#FFFFFF", bubbleThemText: "#3D2730", border: "#F3E3E8" },
  forest:       { name: "Forest Ink",        primary: "#2D5C3E", primaryLight: "#E7F0EA", bg: "#F6F8F4", surface: "#FFFFFF", accent: "#8FAE3F", text: "#1B2A1F", textMuted: "#5E715F", bubbleMe: "#2D5C3E", bubbleMeText: "#F6F8F4", bubbleThem: "#FFFFFF", bubbleThemText: "#1B2A1F", border: "#E2EADD" },
  charcoalBlue: { name: "Charcoal Blue",     primary: "#4C8DFF", primaryLight: "#161C24", bg: "#0D1117", surface: "#161C24", accent: "#4C8DFF", text: "#E6EDF3", textMuted: "#8B96A5", bubbleMe: "#1F4E8C", bubbleMeText: "#E6EDF3", bubbleThem: "#21262D", bubbleThemText: "#E6EDF3", border: "#242C36" },
  plumNight:    { name: "Plum Night",        primary: "#B784E0", primaryLight: "#241B2E", bg: "#170F1E", surface: "#241B2E", accent: "#E0A8F0", text: "#F0E6F5", textMuted: "#A08CB0", bubbleMe: "#5A3D73", bubbleMeText: "#F0E6F5", bubbleThem: "#2B2035", bubbleThemText: "#F0E6F5", border: "#332740" },
  emberDark:    { name: "Ember Dark",        primary: "#FF7A45", primaryLight: "#241713", bg: "#170F0D", surface: "#241713", accent: "#FFA76A", text: "#F5E6E0", textMuted: "#B08C80", bubbleMe: "#7A3319", bubbleMeText: "#F5E6E0", bubbleThem: "#2B1F1A", bubbleThemText: "#F5E6E0", border: "#33251F" },
  slateDark:    { name: "Slate Dark",        primary: "#7A8A99", primaryLight: "#1A1F24", bg: "#0F1215", surface: "#1A1F24", accent: "#A3B3C2", text: "#E8EBED", textMuted: "#8A949C", bubbleMe: "#3D4A56", bubbleMeText: "#E8EBED", bubbleThem: "#22282D", bubbleThemText: "#E8EBED", border: "#282E33" },
  mintDark:     { name: "Mint Dark",         primary: "#3ED9A8", primaryLight: "#122019", bg: "#0B1512", surface: "#122019", accent: "#3ED9A8", text: "#E4F5EF", textMuted: "#7FA396", bubbleMe: "#1B5240", bubbleMeText: "#E4F5EF", bubbleThem: "#182620", bubbleThemText: "#E4F5EF", border: "#1E2E27" },
  roseGold:     { name: "Rose Gold",         primary: "#D98A9A", primaryLight: "#FCEEF0", bg: "#FFF8F9", surface: "#FFFFFF", accent: "#E0A9B5", text: "#3D2530", textMuted: "#8A6E76", bubbleMe: "#D98A9A", bubbleMeText: "#FFF8F9", bubbleThem: "#FFFFFF", bubbleThemText: "#3D2530", border: "#F5DFE3" },
  skyLight:     { name: "Sky Light",         primary: "#3B8FE0", primaryLight: "#E8F2FC", bg: "#F7FBFF", surface: "#FFFFFF", accent: "#5FA8E8", text: "#1A2B3A", textMuted: "#5E7A8F", bubbleMe: "#3B8FE0", bubbleMeText: "#FFFFFF", bubbleThem: "#FFFFFF", bubbleThemText: "#1A2B3A", border: "#DCE9F5" },
  amberLight:   { name: "Amber Light",       primary: "#D98E1E", primaryLight: "#FCF3E3", bg: "#FFFBF3", surface: "#FFFFFF", accent: "#E8A83D", text: "#3A2E15", textMuted: "#8A7856", bubbleMe: "#D98E1E", bubbleMeText: "#FFFBF3", bubbleThem: "#FFFFFF", bubbleThemText: "#3A2E15", border: "#F0E2C8" },
};

const CUSTOM_THEME_KEY = "nextext_custom_theme";
const THEME_KEY_STORAGE = "nextext_theme_key";
const AUTO_ROTATE_KEY = "nextext_auto_rotate";
const AUTO_ROTATE_LAST_KEY = "nextext_auto_rotate_last";
const HIDE_NAV_KEY = "nextext_hide_nav";
const CHAT_TEXT_SCALE_KEY = "nextext_chat_text_scale";
const APP_FONT_KEY = "nextext_app_font";
const COMPOSER_HEIGHT_KEY = "nextext_composer_height";
const MESSAGE_WIDTH_KEY = "nextext_message_width";

const FONTS = [
  { id: "system", label: "System Default", value: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif" },
  { id: "serif", label: "Serif", value: "Georgia,'Times New Roman',serif" },
  { id: "mono", label: "Monospace", value: "ui-monospace,Consolas,'Courier New',monospace" },
  { id: "round", label: "Rounded", value: "'Nunito','Quicksand',system-ui,sans-serif" },
  { id: "condensed", label: "Condensed", value: "'Roboto Condensed','Source Sans Pro',sans-serif" },
];

export { FONTS };

const ThemeContext = createContext(null);

// Auto-rotation interval options, in days (0 = off, -1 = handled separately as "custom")
export const ROTATE_INTERVALS = [
  { label: "Off", days: 0 },
  { label: "Every day", days: 1 },
  { label: "Once a week", days: 7 },
  { label: "Twice a week", days: 3.5 },
  { label: "3 times a week", days: 2.33 },
  { label: "Every two weeks", days: 14 },
  { label: "Every 3 weeks", days: 21 },
  { label: "Once a month", days: 30 },
];

function loadCustomTheme() {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function ThemeProvider({ children }) {
  const [themeKey, setThemeKeyState] = useState(() => localStorage.getItem(THEME_KEY_STORAGE) || "emeraldNight");
  const [customTheme, setCustomTheme] = useState(loadCustomTheme);
  const [rotateDays, setRotateDaysState] = useState(() => Number(localStorage.getItem(AUTO_ROTATE_KEY)) || 0);
  const [hideNav, setHideNavState] = useState(() => localStorage.getItem(HIDE_NAV_KEY) === "true");
  const [chatTextScale, setChatTextScaleState] = useState(() => Number(localStorage.getItem(CHAT_TEXT_SCALE_KEY)) || 1);
  const [appFontId, setAppFontIdState] = useState(() => localStorage.getItem(APP_FONT_KEY) || "system");
  const [composerHeight, setComposerHeightState] = useState(() => Number(localStorage.getItem(COMPOSER_HEIGHT_KEY)) || 1);
  // "compact" (~58%), "standard" (~74%), "wide" (~90%). Default "wide" so each
  // message takes up most of the screen by default, with the option to switch.
  const [messageWidth, setMessageWidthState] = useState(() => localStorage.getItem(MESSAGE_WIDTH_KEY) || "wide");
  const [composerButtonOrder, setComposerButtonOrderState] = useState(() => localStorage.getItem("nextext_composer_button_order") || "stt-voice");

  const setThemeKey = (key) => {
    setThemeKeyState(key);
    localStorage.setItem(THEME_KEY_STORAGE, key);
  };

  const setCustomThemeColors = (colors) => {
    const merged = { ...(customTheme || themes[themeKey]), ...colors, name: "Custom" };
    setCustomTheme(merged);
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(merged));
    setThemeKey("custom");
  };

  const setRotateDays = (days) => {
    setRotateDaysState(days);
    localStorage.setItem(AUTO_ROTATE_KEY, String(days));
  };

  const setHideNav = (val) => {
    setHideNavState(val);
    localStorage.setItem(HIDE_NAV_KEY, String(val));
  };

  const setChatTextScale = (val) => {
    setChatTextScaleState(val);
    localStorage.setItem(CHAT_TEXT_SCALE_KEY, String(val));
  };

  const setAppFontId = (id) => {
    setAppFontIdState(id);
    localStorage.setItem(APP_FONT_KEY, id);
  };

  const setComposerHeight = (val) => {
    setComposerHeightState(val);
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(val));
  };

  const setMessageWidth = (val) => {
    setMessageWidthState(val);
    localStorage.setItem(MESSAGE_WIDTH_KEY, val);
  };

  const setComposerButtonOrder = (val) => {
    setComposerButtonOrderState(val);
    localStorage.setItem("nextext_composer_button_order", val);
  };

  const appFont = FONTS.find((f) => f.id === appFontId)?.value || FONTS[0].value;

  // Auto-rotation: picks a random theme (excluding "custom") once the
  // configured interval has elapsed since the last rotation.
  useEffect(() => {
    if (!rotateDays) return;
    const check = () => {
      const lastMs = Number(localStorage.getItem(AUTO_ROTATE_LAST_KEY)) || 0;
      const elapsedDays = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
      if (elapsedDays >= rotateDays) {
        const keys = Object.keys(themes);
        const nextKey = keys[Math.floor(Math.random() * keys.length)];
        setThemeKey(nextKey);
        localStorage.setItem(AUTO_ROTATE_LAST_KEY, String(Date.now()));
      }
    };
    check();
    const interval = setInterval(check, 60 * 60 * 1000); // re-check hourly, cheap and sufficient
    return () => clearInterval(interval);
  }, [rotateDays]);

  const t = themeKey === "custom" && customTheme ? customTheme : (themes[themeKey] || themes.emeraldNight);

  return (
    <ThemeContext.Provider value={{ t, themeKey, setThemeKey, customTheme, setCustomThemeColors, rotateDays, setRotateDays, hideNav, setHideNav, chatTextScale, setChatTextScale, appFontId, setAppFontId, appFont, composerHeight, setComposerHeight, messageWidth, setMessageWidth, composerButtonOrder, setComposerButtonOrder }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Returns true when a theme's background is dark enough that light-on-dark
// UI (notifications, etc.) should be used.
export function isThemeDark(theme) {
  const bg = theme?.bg || "#FFFFFF";
  const c = bg.replace("#", "");
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.5;
}
