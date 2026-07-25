/** Per-user light/dark mode, theme variant, and control density preferences. */
export type ControlSize = "compact" | "default" | "comfortable";

export interface UserAppearance {
  mode?: "light" | "dark";
  lightTheme?: string;
  darkTheme?: string;
  /** Icon / toggle button scale across the app. */
  controlSize?: ControlSize;
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
  return Object.keys(out).length ? out : undefined;
}

/** Parse appearance JSON from persistence; returns null when payload is absent. */
export function parseUserAppearance(raw: unknown): UserAppearance | null {
  if (raw == null) return null;
  return normalizeAppearance(raw) ?? null;
}
