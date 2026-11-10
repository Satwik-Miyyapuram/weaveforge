/**
 * App-shell rules (Rust `app_lib`): palette rows, saved preference defaults, shortcut toggles, page
 * body fallbacks and key-event checks. Re-exported from index.ts.
 */
import {
  menuPaletteActions as rawMenuPaletteActions,
  settingsPaletteRows as rawSettingsPaletteRows,
} from "../pkg/wf_wasm.js";

export {
  textWithinCap,
} from "../pkg/wf_wasm.js";

export {
  citationFormatStorageKey,
  inkHapticsOn,
  isCommitEnter,
  isEditCommand,
  isHydratedPage,
  nextShortcutsOpen,
  noteBodyText,
  parseEditorCitationFormat,
  parseWikilinkCreateMode,
} from "../pkg/wf_wasm.js";

/** A desktop menu item, as the shell sends it. */
export interface AppLibMenuItem {
  id: string;
  label: string;
  enabled: boolean;
}

/** A desktop menu group. */
export interface AppLibMenuGroup {
  items: AppLibMenuItem[];
}

/** A palette row backed by a menu item. */
export interface AppLibMenuPaletteRow {
  id: string;
  label: string;
}

/** A palette row that opens a desktop-only Settings section. */
export interface AppLibSettingsPaletteRow {
  key: string;
  label: string;
  path: string;
}

/** The palette rows the desktop menu backs, in palette order. */
export function menuPaletteActions(groups: readonly AppLibMenuGroup[]): AppLibMenuPaletteRow[] {
  return rawMenuPaletteActions(groups) as AppLibMenuPaletteRow[];
}

/** The Settings palette rows the bridge can back. */
export function settingsPaletteRows(hasPlanWidget: boolean, hasInk: boolean): AppLibSettingsPaletteRow[] {
  return rawSettingsPaletteRows(hasPlanWidget, hasInk) as AppLibSettingsPaletteRow[];
}

