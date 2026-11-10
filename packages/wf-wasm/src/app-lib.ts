/**
 * App-shell rules (Rust `app_lib`): palette rows, saved preference defaults, shortcut toggles, page
 * body fallbacks and key-event checks. Re-exported from index.ts.
 */
export {
  textWithinCap,
} from "../pkg/wf_wasm.js";

export {
  citationFormatStorageKey,
  inkHapticsOn,
  isCommitEnter,
  isEditCommand,
  isHydratedPage,
  menuPaletteActions,
  nextShortcutsOpen,
  noteBodyText,
  parseEditorCitationFormat,
  parseWikilinkCreateMode,
  settingsPaletteRows,
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

