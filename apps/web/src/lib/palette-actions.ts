import type { DesktopBridge, DesktopMenuGroup } from "@/lib/desktop/desktop-bridge";
import { readyCore } from "@/lib/rust-core";

/** The documentation site; the shell's Help menu opens the same page. */
export const DOCS_URL = "https://www.weaveforge.org/docs/";

export interface MenuPaletteAction {
  id: string;
  label: string;
}

/** The palette rows the shell's menu backs; none without a menu (browser, macOS). */
export function menuPaletteActions(groups: readonly DesktopMenuGroup[] | null): MenuPaletteAction[] {
  return readyCore().menuPaletteActions(groups ?? []);
}

export interface SettingsPaletteAction {
  key: string;
  label: string;
  path: string;
}

/**
 * Palette rows that open a desktop-only Settings section: only where the
 * bridge offers what the section sets, so a browser gets neither.
 */
export function settingsPaletteActions(bridge: DesktopBridge | null): SettingsPaletteAction[] {
  return readyCore().settingsPaletteRows(
    !!bridge && typeof bridge.setPlanWidget === "function",
    !!bridge && typeof bridge.inkAvailable === "function",
  );
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
  return readyCore().nextShortcutsOpen(open, typeof how === "string" ? how : undefined);
}
