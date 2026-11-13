import type { ThemeMode } from "@/lib/theme/theme";
import type { TagStyle } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { createTheme, type Settings } from "@uiw/codemirror-themes";

// --- markdown-cm-syntax ---
/**
 * Markdown syntax overlay — appended after uiw preset styles so these win for
 * prose tokens. Per-level heading colors match VS Code's rainbow ATX headings.
 * Uses explicit CSS classes so `#` marks can inherit the line heading color.
 */
export const markdownSyntaxOverlay: TagStyle[] = [
  { tag: t.heading1, class: "cm-md-h1", fontWeight: "700" },
  { tag: t.heading2, class: "cm-md-h2", fontWeight: "700" },
  { tag: t.heading3, class: "cm-md-h3", fontWeight: "700" },
  { tag: t.heading4, class: "cm-md-h4", fontWeight: "700" },
  { tag: t.heading5, class: "cm-md-h5", fontWeight: "700" },
  { tag: t.heading6, class: "cm-md-h6", fontWeight: "700" },
  { tag: t.heading, class: "cm-md-h1", fontWeight: "700" },
  { tag: t.processingInstruction, class: "cm-md-mark" },
  { tag: t.strong, fontWeight: "700", color: "var(--ink)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--ink)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--link)", textDecoration: "underline" },
  { tag: t.url, color: "var(--muted)" },
  { tag: [t.string, t.special(t.string), t.inserted], color: "var(--st-warn-fg)" },
  { tag: [t.meta, t.comment], color: "var(--faint)" },
  { tag: [t.angleBracket, t.punctuation, t.separator], color: "var(--muted)" },
  { tag: t.monospace, color: "var(--accent)", fontFamily: "var(--font-mono)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "var(--muted)" },

  // Fenced code inside a note. These used to come from the vendor themes,
  // which hardcoded one palette's hexes whatever the site theme was; taking
  // them from the same tokens as the rest of the editor keeps a fenced block
  // legible on Amoled and on Honey alike.
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "var(--st-danger-fg)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--st-info-fg)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--accent)" },
  { tag: [t.number, t.bool, t.atom], color: "var(--st-positive-fg)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--ink)" },
  { tag: [t.operator, t.derefOperator, t.bracket], color: "var(--muted)" },
  { tag: t.invalid, color: "var(--st-danger-fg)" },
];

// --- codemirror-theme ---
/** Editor chrome aligned with site design tokens (updates when `data-theme` changes). */
const siteChrome: Settings = {
  background: "var(--elev)",
  foreground: "var(--ink)",
  caret: "var(--accent)",
  selection: "var(--editor-selection)",
  selectionMatch: "color-mix(in srgb, var(--accent) 16%, transparent)",
  lineHighlight: "var(--editor-active-line)",
  gutterBackground: "transparent",
  gutterForeground: "var(--muted)",
  gutterActiveForeground: "var(--ink)",
  gutterBorder: "transparent",
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
