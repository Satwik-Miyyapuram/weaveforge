export const LIGHT_THEMES = ["light", "latte", "honey", "vivid-light", "pastel-light"] as const;
export const DARK_THEMES = ["dark", "mocha", "dracula", "amoled", "contrast", "vivid-dark", "pastel-dark"] as const;
export const CONTROL_SIZES = ["compact", "default", "comfortable"] as const;

export type LightThemeId = (typeof LIGHT_THEMES)[number];
export type DarkThemeId = (typeof DARK_THEMES)[number];
export type ThemeMode = "light" | "dark";
export type ControlSizeId = (typeof CONTROL_SIZES)[number];

/** Default light / dark palette ids when nothing is stored yet. */
export const DEFAULT_LIGHT_THEME: LightThemeId = "light";
export const DEFAULT_DARK_THEME: DarkThemeId = "amoled";

export const CONTROL_SIZE_OPTIONS: ReadonlyArray<{ id: ControlSizeId; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "default", label: "Default" },
  { id: "comfortable", label: "Comfortable" },
];

export const LIGHT_THEME_OPTIONS: ReadonlyArray<{ id: LightThemeId; label: string }> = [
  { id: "light", label: "Paper" },
  { id: "latte", label: "Latte" },
  { id: "honey", label: "Honey" },
  { id: "vivid-light", label: "Vivid Light" },
  { id: "pastel-light", label: "Pastel Light" },
];

export const DARK_THEME_OPTIONS: ReadonlyArray<{ id: DarkThemeId; label: string }> = [
  { id: "amoled", label: "Amoled" },
  { id: "dark", label: "Slate" },
  { id: "mocha", label: "Mocha" },
  { id: "dracula", label: "Dracula" },
  { id: "contrast", label: "High Contrast" },
  { id: "vivid-dark", label: "Vivid Dark" },
  { id: "pastel-dark", label: "Pastel Dark" },
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
  return `(function(){try{var lt=${lt},dt=${dt},cs=${cs},dl=${dl},dd=${dd};function ok(id,list,f){return id&&list.indexOf(id)>=0?id:f;}function mode(){var m=localStorage.getItem("thesis.mode");if(m==="light"||m==="dark")return m;var old=localStorage.getItem("thesis.theme");if(old==="light")return"light";if(old)return"dark";return matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}var m=mode();var l=ok(localStorage.getItem("thesis.theme.light"),lt,dl);var d=ok(localStorage.getItem("thesis.theme.dark"),dt,dd);document.documentElement.dataset.mode=m;var t=m==="dark"?d:l;if(t!=="light")document.documentElement.dataset.theme=t;document.documentElement.dataset.controlSize=ok(localStorage.getItem("thesis.controlSize"),cs,"default");var bg=getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();if(!bg&&m==="dark")bg="#000000";if(bg){var meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement("meta");meta.setAttribute("name","theme-color");document.head.appendChild(meta);}meta.setAttribute("content",bg);}}catch(e){}})();`;
}

/** Minified boot script for layout.tsx (no imports). */
export const THEME_BOOT_SCRIPT = buildThemeBootScript();
