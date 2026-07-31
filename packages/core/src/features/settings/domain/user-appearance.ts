import {
  normalizeThemeConfig,
  type SurfaceStyle,
  type ThemeConfig,
} from "./theme-config.js";

/** Per-user light/dark mode, theme variant, and control density preferences. */
export type ControlSize = "compact" | "default" | "comfortable";

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
  if (o.controlSize === "compact" || o.controlSize === "default" || o.controlSize === "comfortable") {
    out.controlSize = o.controlSize;
  }
  if (o.surfaces === "borderless" || o.surfaces === "bordered") out.surfaces = o.surfaces;
  if (typeof o.reactiveMotion === "boolean") out.reactiveMotion = o.reactiveMotion;
  // Re-validated rather than copied: the settings row is user-writable, so a
  // stored theme gets the same scrutiny as the file it was uploaded from.
  if (o.customTheme === null) out.customTheme = null;
  else {
    const customTheme = normalizeThemeConfig(o.customTheme);
    if (customTheme) out.customTheme = customTheme;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parse appearance JSON from persistence; returns null when payload is absent. */
export function parseUserAppearance(raw: unknown): UserAppearance | null {
  if (raw == null) return null;
  return normalizeAppearance(raw) ?? null;
}
