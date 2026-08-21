import type { Extension } from "@codemirror/state";
import type { TagStyle } from "@codemirror/language";
import { createTheme, type Settings } from "@uiw/codemirror-themes";
import { draculaInit } from "@uiw/codemirror-theme-dracula";
import { githubLightInit } from "@uiw/codemirror-theme-github";
import { tokyoNightInit } from "@uiw/codemirror-theme-tokyo-night";
import { vscodeDarkInit, vscodeLightInit } from "@uiw/codemirror-theme-vscode";
import {
  readStoredMode,
  sanitizeThemeId,
  type DarkThemeId,
  type LightThemeId,
  type ThemeMode,
} from "@/lib/theme/theme";
import { markdownSyntaxOverlay } from "@/lib/markdown-cm-syntax";

/** Editor chrome aligned with site design tokens (updates when `data-theme` changes). */
const siteChrome: Settings = {
  background: "var(--elev)",
  foreground: "var(--ink)",
  caret: "var(--accent)",
  selection: "color-mix(in srgb, var(--accent) 30%, transparent)",
  selectionMatch: "color-mix(in srgb, var(--accent) 16%, transparent)",
  lineHighlight: "color-mix(in srgb, var(--accent) 7%, transparent)",
  gutterBackground: "transparent",
  gutterForeground: "var(--muted)",
  gutterActiveForeground: "var(--ink)",
  gutterBorder: "var(--line)",
  fontFamily: "var(--font-mono)",
};

type ThemeFactory = (settings: Settings, styles: TagStyle[]) => Extension;

const LIGHT_CM_THEMES: Record<LightThemeId, ThemeFactory> = {
  light: (settings, styles) => githubLightInit({ settings, styles }),
  latte: (settings, styles) => vscodeLightInit({ settings, styles }),
  honey: (settings, styles) => githubLightInit({ settings, styles }),
  "vivid-light": (settings, styles) => vscodeLightInit({ settings, styles }),
  "pastel-light": (settings, styles) => githubLightInit({ settings, styles }),
  "confetti-light": (settings, styles) => githubLightInit({ settings, styles }),
};

const DARK_CM_THEMES: Record<DarkThemeId, ThemeFactory> = {
  dark: (settings, styles) => vscodeDarkInit({ settings, styles }),
  mocha: (settings, styles) => tokyoNightInit({ settings, styles }),
  dracula: (settings, styles) => draculaInit({ settings, styles }),
  amoled: (settings, styles) => vscodeDarkInit({ settings, styles }),
  contrast: (settings, styles) => vscodeDarkInit({ settings, styles }),
  "vivid-dark": (settings, styles) => tokyoNightInit({ settings, styles }),
  "pastel-dark": (settings, styles) => tokyoNightInit({ settings, styles }),
  "confetti-dark": (settings, styles) => tokyoNightInit({ settings, styles }),
};

export function readActiveThemeId(mode?: ThemeMode): LightThemeId | DarkThemeId {
  const resolvedMode =
    mode ?? (typeof document !== "undefined" ? readStoredMode() : "light");
  const raw =
    typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;
  return sanitizeThemeId(raw ?? null, resolvedMode) as LightThemeId | DarkThemeId;
}

/** Build a CodeMirror theme extension matching the current website theme. */
export function createCodeMirrorThemeForSite(mode?: ThemeMode): Extension {
  const resolvedMode =
    mode ?? (typeof document !== "undefined" && document.documentElement.dataset.mode === "dark"
      ? "dark"
      : "light");
  const themeId = readActiveThemeId(resolvedMode);
  const factory =
    resolvedMode === "dark"
      ? DARK_CM_THEMES[themeId as DarkThemeId]
      : LIGHT_CM_THEMES[themeId as LightThemeId];

  if (factory) {
    return factory(siteChrome, markdownSyntaxOverlay);
  }

  return createTheme({
    theme: resolvedMode,
    settings: siteChrome,
    styles: markdownSyntaxOverlay,
  });
}

export function watchSiteTheme(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  const obs = new MutationObserver(onChange);
  obs.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
  return () => obs.disconnect();
}
