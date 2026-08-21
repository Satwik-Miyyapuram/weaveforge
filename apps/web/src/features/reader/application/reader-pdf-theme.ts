import { DARK_THEMES } from "@/lib/theme/theme";

const DARK_SET = new Set<string>(DARK_THEMES);

/**
 * Whether the PDF canvas should use dark-reader rendering (invert + hue-rotate).
 * Honour either an explicit dark theme id or dark mode.
 */
export function shouldUseDarkPdfRendering(
  themeId: string | null | undefined,
  mode?: string | null,
): boolean {
  if (mode === "dark") return true;
  if (!themeId) return false;
  return DARK_SET.has(themeId);
}

/** CSS filter applied to the PDF canvas stack in dark mode. */
export function darkPdfCanvasFilter(): string {
  return "invert(1) hue-rotate(180deg)";
}
