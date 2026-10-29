import {
  normalizeThemeConfig,
  type SurfaceStyle,
  type ThemeConfig,
} from "./theme-config.js";

/** Icon / toggle button densities, smallest first. */
export const CONTROL_SIZES = ["compact", "default", "comfortable"] as const;
/** Per-user light/dark mode, theme variant, and control density preferences. */
export type ControlSize = (typeof CONTROL_SIZES)[number];
/** How the brutal and CRT themes may colour a paper card by its reading status. */
export const CARD_TINTS = ["full", "bar", "border", "none"] as const;
/** How the brutal and CRT themes colour a paper card by its reading status. */
export type CardTint = (typeof CARD_TINTS)[number];
/** Animation speed multipliers, slowest first; 1 is the designed speed. */
export const ANIMATION_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
/** How fast every animation runs relative to its designed duration. */
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number];

function isOneOf<T extends string | number>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value);
}

export interface UserAppearance {
  mode?: "light" | "dark";
  lightTheme?: string;
  darkTheme?: string;
  /** Icon / toggle button scale across the app. */
  controlSize?: ControlSize;
  /**
   * Surface separation. "borderless" separates panels with elevation alone;
   * "bordered" restores the hairlines, which high-contrast users need because
   * a shadow carries almost no contrast ratio.
   */
  surfaces?: SurfaceStyle;
  /**
   * Pointer-reactive animation layer (tilt, cursor glow, press physics). Off by
   * default: it is additive polish, not part of the motion the app already had.
   */
  reactiveMotion?: boolean;
  /** Every animation's speed, 0.25x to 4x. Absent means 1x. */
  animationSpeed?: AnimationSpeed;
  /**
   * Paper card status colour on the brutal and CRT themes: the whole card
   * tinted, a bar down its edge, or nothing. Other themes ignore it.
   */
  cardTint?: CardTint;
  /**
   * CRT's leaning cards. On by default there; off squares them up. Only the
   * CRT theme reads it — a theme file can lean cards on any theme.
   */
  cardTilt?: boolean;
  /** CRT's scanline overlay. On by default; other themes have none. */
  scanlines?: boolean;
  /**
   * Validated theme uploaded as `config.json`. Absent means "unchanged";
   * explicit `null` means "remove the uploaded theme", which a patch needs to
   * be able to say without being read as "leave it alone".
   */
  customTheme?: ThemeConfig | null;
}

export function normalizeAppearance(raw: unknown): UserAppearance | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Partial<UserAppearance>;
  const out: UserAppearance = {};
  if (o.mode === "light" || o.mode === "dark") out.mode = o.mode;
  if (typeof o.lightTheme === "string") {
    const lightTheme = o.lightTheme.trim();
    if (lightTheme) out.lightTheme = lightTheme;
  }
  if (typeof o.darkTheme === "string") {
    const darkTheme = o.darkTheme.trim();
    if (darkTheme) out.darkTheme = darkTheme;
  }
  if (isOneOf(CONTROL_SIZES, o.controlSize)) out.controlSize = o.controlSize;
  if (o.surfaces === "borderless" || o.surfaces === "bordered") out.surfaces = o.surfaces;
  if (typeof o.reactiveMotion === "boolean") out.reactiveMotion = o.reactiveMotion;
  if (isOneOf(ANIMATION_SPEEDS, o.animationSpeed)) out.animationSpeed = o.animationSpeed;
  if (isOneOf(CARD_TINTS, o.cardTint)) out.cardTint = o.cardTint;
  if (typeof o.cardTilt === "boolean") out.cardTilt = o.cardTilt;
  if (typeof o.scanlines === "boolean") out.scanlines = o.scanlines;
  // Re-validated rather than copied: the settings row is user-writable, so a
  // stored theme gets the same scrutiny as the file it was uploaded from.
  if (o.customTheme === null) out.customTheme = null;
  else {
    const customTheme = normalizeThemeConfig(o.customTheme);
    if (customTheme) out.customTheme = customTheme;
  }
  return Object.keys(out).length ? out : undefined;
}
