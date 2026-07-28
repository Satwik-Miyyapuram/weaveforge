import { DARK_THEMES } from "../../../lib/theme.js";

const DARK_SET = new Set<string>(DARK_THEMES);

/**
 * Whether the PDF canvas should use dark-reader rendering (invert + hue-rotate)
 * for the active theme id. Catppuccin mocha and other dark themes qualify.
 */
export function shouldUseDarkPdfRendering(themeId: string | null | undefined): boolean {
  if (!themeId) return false;
  return DARK_SET.has(themeId);
}

/** CSS filter applied to the PDF canvas stack in dark mode. */
export function darkPdfCanvasFilter(): string {
  return "invert(1) hue-rotate(180deg)";
}
