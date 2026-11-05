import type { DesktopMenuGroup } from "@/lib/desktop/desktop-bridge";

/** The documentation site; the shell's Help menu opens the same page. */
export const DOCS_URL = "https://www.weaveforge.org/docs/";

/**
 * Menu entries the command palette offers too, in palette order.
 *
 * The shell gives these stable ids (apps/shell/src/menu.rs), so the palette runs
 * the menu's own action instead of a second copy of it.
 */
const PALETTE_MENU_IDS = [
  "action:check-updates",
  "action:docs",
  "action:show-in-explorer",
  "action:choose-workspace",
] as const;

export interface MenuPaletteAction {
  id: string;
  label: string;
}

/** The palette rows the shell's menu backs; none without a menu (browser, macOS). */
export function menuPaletteActions(groups: readonly DesktopMenuGroup[] | null): MenuPaletteAction[] {
  if (!groups) return [];
  const items = groups.flatMap((group) => group.items);
  return PALETTE_MENU_IDS.flatMap((id) => {
    const item = items.find((entry) => entry.id === id && entry.enabled);
    return item ? [{ id, label: item.label.replace(/…$/, "") }] : [];
  });
}

/** Event that opens (or toggles) the keyboard shortcuts sheet, from anywhere. */
export const SHORTCUTS_EVENT = "weaveforge:shortcuts";

export type ShortcutsRequest = "open" | "toggle";

/** Ask the app-wide host to show the shortcuts sheet. */
export function requestShortcuts(how: ShortcutsRequest = "open"): void {
  window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT, { detail: how }));
}

/** Whether the sheet is open after a request: a toggle flips it, anything else opens it. */
export function nextShortcutsOpen(open: boolean, how: unknown): boolean {
  return how === "toggle" ? !open : true;
}
