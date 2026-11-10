/**
 * App-shell rules (Rust `app_lib`): palette rows, saved preference defaults, shortcut toggles, page
 * body fallbacks and key-event checks. Re-exported from index.ts.
 */
import {
  citationFormatStorageKey as rawCitationFormatStorageKey,
  inkHapticsOn as rawInkHapticsOn,
  isCommitEnter as rawIsCommitEnter,
  isEditCommand as rawIsEditCommand,
  isHydratedPage as rawIsHydratedPage,
  menuPaletteActions as rawMenuPaletteActions,
  nextShortcutsOpen as rawNextShortcutsOpen,
  noteBodyText as rawNoteBodyText,
  parseEditorCitationFormat as rawParseEditorCitationFormat,
  parseWikilinkCreateMode as rawParseWikilinkCreateMode,
  settingsPaletteRows as rawSettingsPaletteRows,
  textWithinCap as rawTextWithinCap,
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

/** Whether the shortcuts sheet is open after a request. */
export function nextShortcutsOpen(open: boolean, how: string | undefined): boolean {
  return rawNextShortcutsOpen(open, how);
}

/** Whether ink haptics are on for a saved value. */
export function inkHapticsOn(raw: string | undefined): boolean {
  return rawInkHapticsOn(raw);
}

/** The storage key for a project's citation format. */
export function citationFormatStorageKey(projectId: string | undefined): string {
  return rawCitationFormatStorageKey(projectId);
}

/** The saved citation format when the editor offers it, else `wikilink`. */
export function parseEditorCitationFormat(raw: string | undefined): string {
  return rawParseEditorCitationFormat(raw);
}

/** `never` or `create`, the wikilink create mode for a saved value. */
export function parseWikilinkCreateMode(raw: string | undefined): string {
  return rawParseWikilinkCreateMode(raw);
}

/** Whether `text` is within the index cap (16Mi UTF-16 units). Above it, callers keep the TS rule. */
export function textWithinCap(text: string): boolean {
  return rawTextWithinCap(text);
}

/** The full body when non-empty, else the preview, else empty. Caller checks `textWithinCap` first. */
export function noteBodyText(body: string | undefined, bodyPreview: string | undefined): string {
  return rawNoteBodyText(body, bodyPreview);
}

/** Whether a page has a body and no non-empty preview stands in for it. Caller checks `textWithinCap` first. */
export function isHydratedPage(body: string | undefined, bodyPreview: string | undefined): boolean {
  return rawIsHydratedPage(body, bodyPreview);
}

/** Whether a key event commits a field: Enter outside an IME composition. */
export function isCommitEnter(key: string, keyCode: number | undefined, isComposing: boolean): boolean {
  return rawIsCommitEnter(key, keyCode, isComposing);
}

/** Whether a desktop menu command is an edit command (paste or an execCommand edit). */
export function isEditCommand(command: string): boolean {
  return rawIsEditCommand(command);
}
