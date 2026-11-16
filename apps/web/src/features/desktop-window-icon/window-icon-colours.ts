/**
 * Picks the colours of the running app's window and taskbar icon.
 *
 * The icon follows the active theme's ink and dot, but only when each colour
 * reaches WCAG 3:1 against the taskbar background for the OS mode. Otherwise the
 * static C1 colour for that mode is used, so the icon never disappears.
 */

export type OsMode = "light" | "dark";

export type IconColours = { ink: string; dot: string };

export const MIN_CONTRAST = 3;

/** Static C1 CRT colours, also the icons written by apps/shell/scripts/build-icons.mjs. */
export const STATIC_COLOURS: Record<OsMode, IconColours> = {
  light: { ink: "#2b222b", dot: "#1f6dab" },
  dark: { ink: "#ffe7c1", dot: "#5aa0d8" },
};

/** Windows taskbar backgrounds for each OS mode. */
export const TASKBAR_BACKGROUND: Record<OsMode, string> = {
  light: "#f3f3f3",
  dark: "#202020",
};

const HEX = /^#([0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i;

/** Returns a lowercase #rrggbb for hex or rgb()/rgba() input, or null for anything else. */
export function parseColour(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  const hex = HEX.exec(text);
  const digits = hex?.[1];
  if (digits) return `#${digits.toLowerCase()}`;
  const rgb = RGB.exec(text);
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number);
    if (channels.some((c) => c > 255)) return null;
    return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function pickOne(theme: string | null | undefined, fallback: string, background: string): string {
  const colour = parseColour(theme);
  if (colour && contrast(colour, background) >= MIN_CONTRAST) return colour;
  return fallback;
}

/** The icon colours for a theme's ink and dot on the taskbar of the given OS mode. */
export function pickWindowIconColours(
  theme: { ink: string | null | undefined; dot: string | null | undefined },
  mode: OsMode,
): IconColours {
  const background = TASKBAR_BACKGROUND[mode];
  const fallback = STATIC_COLOURS[mode];
  return {
    ink: pickOne(theme.ink, fallback.ink, background),
    dot: pickOne(theme.dot, fallback.dot, background),
  };
}
