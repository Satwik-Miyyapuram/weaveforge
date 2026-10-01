import {
  normalizeThemeConfig,
  THEME_COLOR_KEYS,
  THEME_FONT_KEYS,
  THEME_RADIUS_KEYS,
  type SurfaceStyle,
  type ThemeConfig,
} from "@weaveforge/core";

export type { SurfaceStyle, ThemeConfig };

const LIGHT_THEMES = [
  "brutal",
  "crt",
  "light",
  "latte",
  "honey",
  "vivid-light",
  "pastel-light",
  "confetti-light",
] as const;
export const DARK_THEMES = [
  "brutal-dark",
  "dark",
  "mocha",
  "dracula",
  "amoled",
  "contrast",
  "vivid-dark",
  "pastel-dark",
  "confetti-dark",
] as const;
const CONTROL_SIZES = ["compact", "default", "comfortable"] as const;

export type LightThemeId = (typeof LIGHT_THEMES)[number];
export type DarkThemeId = (typeof DARK_THEMES)[number];
export type ThemeMode = "light" | "dark";
export type ControlSizeId = (typeof CONTROL_SIZES)[number];

/** Default light / dark palette ids when nothing is stored yet. */
export const DEFAULT_LIGHT_THEME: LightThemeId = "brutal";
export const DEFAULT_DARK_THEME: DarkThemeId = "brutal-dark";

export const CONTROL_SIZE_OPTIONS: ReadonlyArray<{ id: ControlSizeId; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "default", label: "Default" },
  { id: "comfortable", label: "Comfortable" },
];

export const LIGHT_THEME_OPTIONS: ReadonlyArray<{ id: LightThemeId; label: string }> = [
  { id: "brutal", label: "Poster" },
  { id: "crt", label: "CRT" },
  { id: "light", label: "Paper" },
  { id: "latte", label: "Latte" },
  { id: "honey", label: "Honey" },
  { id: "vivid-light", label: "Vivid Light" },
  { id: "pastel-light", label: "Pastel Light" },
  { id: "confetti-light", label: "Confetti" },
];

export const DARK_THEME_OPTIONS: ReadonlyArray<{ id: DarkThemeId; label: string }> = [
  { id: "brutal-dark", label: "Poster dark" },
  { id: "amoled", label: "Amoled" },
  { id: "dark", label: "Slate" },
  { id: "mocha", label: "Mocha" },
  { id: "dracula", label: "Dracula" },
  { id: "contrast", label: "High Contrast" },
  { id: "vivid-dark", label: "Vivid Dark" },
  { id: "pastel-dark", label: "Pastel Dark" },
  { id: "confetti-dark", label: "Confetti Dark" },
];

const LIGHT_SET = new Set<string>(LIGHT_THEMES);
const DARK_SET = new Set<string>(DARK_THEMES);

export function sanitizeThemeId(id: string | null, mode: ThemeMode): string {
  const fallback = mode === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
  if (!id) return fallback;
  const allowed = mode === "dark" ? DARK_SET : LIGHT_SET;
  return allowed.has(id) ? id : fallback;
}

/** Apply mode + theme variant to document.documentElement. */
export function applyTheme(mode: ThemeMode, themeId: string): void {
  const root = document.documentElement;
  root.dataset.mode = mode;
  const safe = sanitizeThemeId(themeId, mode);
  if (safe === "light") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = safe;
  }
}

/* ------------------------------------------------------------------ *
 * Surfaces (borderless vs bordered)
 * ------------------------------------------------------------------ */

export const SURFACE_STYLE_OPTIONS: ReadonlyArray<{ id: SurfaceStyle; label: string }> = [
  { id: "borderless", label: "Borderless (depth)" },
  { id: "bordered", label: "Bordered (high contrast)" },
];

export function sanitizeSurfaceStyle(id: string | null | undefined): SurfaceStyle {
  return id === "bordered" ? "bordered" : "borderless";
}

/**
 * Apply the surface treatment. The whole depth layer in styles/surfaces.css hangs off
 * `[data-surfaces="borderless"]`, so flipping this attribute restores every
 * hairline at once — which is the point: shadows have almost no contrast
 * ratio, so a high-contrast user needs the borders back, not a dimmer shadow.
 */
export function applySurfaceStyle(style: SurfaceStyle): void {
  document.documentElement.dataset.surfaces = sanitizeSurfaceStyle(style);
}

export function readStoredSurfaceStyle(): SurfaceStyle {
  try {
    return sanitizeSurfaceStyle(localStorage.getItem("thesis.surfaces"));
  } catch {
    return "borderless";
  }
}

/* ------------------------------------------------------------------ *
 * Card tint (brutal + CRT only)
 * ------------------------------------------------------------------ */

export type CardTint = "full" | "bar" | "border" | "none";

/**
 * A desktop card has room for a colour band down its left edge; a phone card
 * does not, so the phone offers a coloured border in its place. Settings shows
 * each screen its own three (styles/appearance.css).
 */
export const CARD_TINT_OPTIONS: ReadonlyArray<{ id: CardTint; label: string; note: string }> = [
  { id: "full", label: "Full tint", note: "Whole card takes the colour" },
  { id: "bar", label: "Bar", note: "A colour band on the left" },
  { id: "border", label: "Border", note: "A coloured outline" },
  { id: "none", label: "No tint", note: "Status as a chip only" },
];

export function sanitizeCardTint(id: string | null | undefined): CardTint {
  return id === "bar" || id === "border" || id === "none" ? id : "full";
}

/** styles/card-tint.css reads `data-tint`, in every theme. */
export function applyCardTint(tint: CardTint): void {
  document.documentElement.dataset.tint = sanitizeCardTint(tint);
}

export function readStoredCardTint(): CardTint {
  try {
    return sanitizeCardTint(localStorage.getItem("thesis.cardTint"));
  } catch {
    return "full";
  }
}

/* ------------------------------------------------------------------ *
 * CRT extras: leaning cards and scanlines
 * ------------------------------------------------------------------ */

/**
 * Both are on by default and only CRT draws them, so the attribute is written
 * only to turn one off. A theme file can lean cards on any theme through
 * `data-theme-tilt`, which `applyCustomTheme` owns; this switch still wins.
 */
export function applyCardTilt(on: boolean): void {
  const root = document.documentElement;
  if (on) delete root.dataset.tilt;
  else root.dataset.tilt = "off";
}

export function readStoredCardTilt(): boolean {
  try {
    return localStorage.getItem("thesis.cardTilt") !== "0";
  } catch {
    return true;
  }
}

export function applyScanlines(on: boolean): void {
  const root = document.documentElement;
  if (on) delete root.dataset.scanlines;
  else root.dataset.scanlines = "off";
}

export function readStoredScanlines(): boolean {
  try {
    return localStorage.getItem("thesis.scanlines") !== "0";
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ *
 * Reactive motion
 * ------------------------------------------------------------------ */

/**
 * Off by default. Everything the app animated before this flag existed keeps
 * animating regardless; the flag gates only the pointer-reactive layer added
 * on top (tilt, cursor glow, press physics, stagger-in).
 */
export function applyReactiveMotion(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.motion = "reactive";
  else delete root.dataset.motion;
}

export function readStoredReactiveMotion(): boolean {
  try {
    return localStorage.getItem("thesis.reactiveMotion") === "1";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Uploaded theme
 * ------------------------------------------------------------------ */

/**
 * Names of every custom property a config may set, so removing a theme can
 * clear exactly what was set without tracking the previous config.
 */
function customVarNames(): string[] {
  return [
    ...THEME_COLOR_KEYS.map((k) => `--${k}`),
    ...THEME_FONT_KEYS.map((k) => `--font-${k}`),
    ...THEME_RADIUS_KEYS.map((k) => `--radius-${k}`),
  ];
}

/**
 * Write a validated config onto `<html>` as inline custom properties, so it
 * layers over whichever built-in theme is active instead of replacing the
 * stylesheet. `setProperty` with an allowlisted name is the only write; the
 * config's text never reaches a stylesheet as text.
 */
export function applyCustomTheme(config: ThemeConfig | null): void {
  const root = document.documentElement;
  const style = root.style;
  for (const name of customVarNames()) style.removeProperty(name);
  if (!config) {
    delete root.dataset.customTheme;
    delete root.dataset.themeTilt;
    return;
  }
  if (config.cardTilt === undefined) delete root.dataset.themeTilt;
  else root.dataset.themeTilt = config.cardTilt ? "on" : "off";
  const allowed = new Set(customVarNames());
  for (const [name, value] of Object.entries(config.vars)) {
    if (allowed.has(name)) style.setProperty(name, value);
  }
  style.setProperty("--motion-scale", String(config.motionScale));
  root.dataset.customTheme = "on";
}

export function readStoredCustomTheme(): ThemeConfig | null {
  try {
    const raw = localStorage.getItem("thesis.customTheme");
    if (!raw) return null;
    return normalizeThemeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function sanitizeControlSize(id: string | null | undefined): ControlSizeId {
  if (id === "compact" || id === "default" || id === "comfortable") return id;
  return "default";
}

/** Apply icon/toggle scale token to document.documentElement. */
export function applyControlSize(size: ControlSizeId): void {
  document.documentElement.dataset.controlSize = sanitizeControlSize(size);
}

export function readStoredControlSize(): ControlSizeId {
  try {
    return sanitizeControlSize(localStorage.getItem("thesis.controlSize"));
  } catch {
    return "default";
  }
}

export function readStoredMode(): ThemeMode {
  try {
    const m = localStorage.getItem("thesis.mode");
    if (m === "light" || m === "dark") return m;
    const old = localStorage.getItem("thesis.theme");
    if (old === "light") return "light";
    if (old) return "dark";
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function readStoredThemeIds(): { light: string; dark: string } {
  let light: string = DEFAULT_LIGHT_THEME;
  let dark: string = DEFAULT_DARK_THEME;
  try {
    light = localStorage.getItem("thesis.theme.light") || DEFAULT_LIGHT_THEME;
    dark = localStorage.getItem("thesis.theme.dark") || DEFAULT_DARK_THEME;
  } catch {
    /* ignore */
  }
  return {
    light: sanitizeThemeId(light, "light"),
    dark: sanitizeThemeId(dark, "dark"),
  };
}

function buildThemeBootScript(): string {
  const lt = JSON.stringify([...LIGHT_THEMES]);
  const dt = JSON.stringify([...DARK_THEMES]);
  const cs = JSON.stringify([...CONTROL_SIZES]);
  const dl = JSON.stringify(DEFAULT_LIGHT_THEME);
  const dd = JSON.stringify(DEFAULT_DARK_THEME);
  const vn = JSON.stringify(customVarNames());
  // Surfaces, motion and any uploaded palette have to land before first paint
  // for the same reason the theme does — otherwise the page renders bordered
  // and un-themed for a frame and then jumps. The config was validated on
  // upload; the regex here is a cheap re-check so a hand-edited localStorage
  // entry still cannot put arbitrary text into a declaration.
  const extras =
    `var sf=localStorage.getItem("thesis.surfaces")==="bordered"?"bordered":"borderless";` +
    `document.documentElement.dataset.surfaces=sf;` +
    `var ct=localStorage.getItem("thesis.cardTint");document.documentElement.dataset.tint=ct==="bar"||ct==="border"||ct==="none"?ct:"full";` +
    `if(localStorage.getItem("thesis.cardTilt")==="0")document.documentElement.dataset.tilt="off";` +
    `if(localStorage.getItem("thesis.scanlines")==="0")document.documentElement.dataset.scanlines="off";` +
    `if(localStorage.getItem("thesis.reactiveMotion")==="1")document.documentElement.dataset.motion="reactive";` +
    `var vn=${vn},rawT=localStorage.getItem("thesis.customTheme");` +
    `if(rawT){var cfg=JSON.parse(rawT),cv=(cfg&&cfg.vars)||{},okv=/^[#a-zA-Z0-9 ,.%\\/()"_-]{1,120}$/;` +
    `for(var i=0;i<vn.length;i++){var vk=vn[i],vv=cv[vk];` +
    `if(typeof vv==="string"&&okv.test(vv))document.documentElement.style.setProperty(vk,vv);}` +
    `var ms=cfg&&cfg.motionScale;` +
    `if(typeof ms==="number"&&ms>=0.5&&ms<=2)document.documentElement.style.setProperty("--motion-scale",String(ms));` +
    `if(cfg&&typeof cfg.cardTilt==="boolean")document.documentElement.dataset.themeTilt=cfg.cardTilt?"on":"off";` +
    `document.documentElement.dataset.customTheme="on";}`;
  return `(function(){try{var lt=${lt},dt=${dt},cs=${cs},dl=${dl},dd=${dd};function ok(id,list,f){return id&&list.indexOf(id)>=0?id:f;}function mode(){var m=localStorage.getItem("thesis.mode");if(m==="light"||m==="dark")return m;var old=localStorage.getItem("thesis.theme");if(old==="light")return"light";if(old)return"dark";return matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}var m=mode();var l=ok(localStorage.getItem("thesis.theme.light"),lt,dl);var d=ok(localStorage.getItem("thesis.theme.dark"),dt,dd);document.documentElement.dataset.mode=m;var t=m==="dark"?d:l;if(t!=="light")document.documentElement.dataset.theme=t;document.documentElement.dataset.controlSize=ok(localStorage.getItem("thesis.controlSize"),cs,"default");${extras}var bg=getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();if(!bg&&m==="dark")bg="#000000";if(bg){var meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement("meta");meta.setAttribute("name","theme-color");document.head.appendChild(meta);}meta.setAttribute("content",bg);}}catch(e){}})();`;
}

/** Minified boot script for layout.tsx (no imports). */
export const THEME_BOOT_SCRIPT = buildThemeBootScript();
