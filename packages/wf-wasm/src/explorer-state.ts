/**
 * Explorer open-row and open-section rules (Rust `editor_workspace::explorer_state`).
 * The Rust side takes arrays; these wrappers keep the `Set` signatures the panel uses.
 */
import {
  defaultExpanded as rawDefaultExpanded,
  defaultOpenSections as rawDefaultOpenSections,
  isSectionOpen as rawIsSectionOpen,
  migratedExpanded as rawMigratedExpanded,
  parseExplorerKeys as rawParseExplorerKeys,
  toggleExpanded as rawToggleExpanded,
  toggleSection as rawToggleSection,
} from "../pkg/wf_wasm.js";

/** Which sections are open. Anything not in the set is closed. */
export interface SectionState {
  open: ReadonlySet<string>;
}

/** The rows that start open: every root the tree has. */
export function defaultExpanded(roots: readonly string[]): readonly string[] {
  return rawDefaultExpanded([...roots]);
}

/** The section ids open when nothing is stored: every section not declared collapsed. */
export function defaultOpenSections(
  sections: readonly { id: string; collapsedByDefault?: boolean }[],
): string[] {
  return rawDefaultOpenSections(sections) as string[];
}

/** The saved keys plus any root the record never mentioned. Saved keys win. */
export function migratedExpanded(saved: ReadonlySet<string>, roots: readonly string[]): Set<string> {
  return new Set<string>(rawMigratedExpanded([...saved], [...roots]));
}

/** Expanded rows with `key` flipped. Returns a new set; never mutates. */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string> {
  return new Set<string>(rawToggleExpanded([...expanded], key));
}

/** Open or close one section, touching no other. */
export function toggleSection(state: SectionState, id: string): SectionState {
  return { open: new Set<string>(rawToggleSection([...state.open], id)) };
}

export function isSectionOpen(state: SectionState, id: string): boolean {
  return rawIsSectionOpen([...state.open], id);
}

/**
 * The string keys of a stored record, or `null` when the record is absent or
 * unusable. An empty list is a real answer and comes back as `[]`, not `null`.
 */
export function parseExplorerKeys(raw: string | null): string[] | null {
  return rawParseExplorerKeys(raw) as string[] | null;
}
