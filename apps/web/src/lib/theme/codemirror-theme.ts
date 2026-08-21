import type { Extension } from "@codemirror/state";
import { createTheme, type Settings } from "@uiw/codemirror-themes";
import { type ThemeMode } from "@/lib/theme/theme";
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

/** Build a CodeMirror theme extension matching the current website theme. */
export function createCodeMirrorThemeForSite(mode?: ThemeMode): Extension {
  const resolvedMode =
    mode ?? (typeof document !== "undefined" && document.documentElement.dataset.mode === "dark"
      ? "dark"
      : "light");
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
