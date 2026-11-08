import { DARK_THEMES } from "@/lib/theme/theme";

const DARK_SET = new Set<string>(DARK_THEMES);

/**
 * Whether the app is in a dark theme: an explicit dark theme id or dark mode.
 * HTML papers follow it; PDF pages never do (they always render light).
 */
export function shouldUseDarkPdfRendering(
  themeId: string | null | undefined,
  mode?: string | null,
): boolean {
  if (mode === "dark") return true;
  if (!themeId) return false;
  return DARK_SET.has(themeId);
}
