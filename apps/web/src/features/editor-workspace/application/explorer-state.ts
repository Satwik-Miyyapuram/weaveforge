/**
 * Which explorer rows are expanded, and where that survives a reload.
 *
 * `localStorage`, per device, alongside the theme and paste preferences — an
 * explorer that reopens fully collapsed makes the user re-navigate to the note
 * they were editing every time the app restarts, and "which folders I keep open
 * on this machine" is not something to sync to other devices.
 *
 * The storage handle is a parameter rather than the global so the rules can be
 * tested without a DOM, and so a private-mode failure is one caller's problem.
 */

import {
  defaultExpanded,
  defaultOpenSections,
  migratedExpanded,
  parseExplorerKeys,
  type SectionState,
  type WorkspaceTreeNode,
} from "@weaveforge/wasm";

export type { SectionState };

export const EXPLORER_STORAGE_KEY = "weaveforge.explorer.expanded";
/**
 * Set once the record has been corrected for the roots the tree has.
 *
 * Its own key, and not a shape inside the record: see `readMigrated`.
 */
const MIGRATED_KEY = "weaveforge.explorer.roots-migrated";
const HIDDEN_KEY = "weaveforge.explorer.hidden";

/** Whether the panel is put away. Off the first time, like VS Code's side bar. */
export function readHidden(store: Storage | undefined): boolean {
  try {
    return store?.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHidden(store: Storage | undefined, hidden: boolean): void {
  try {
    if (hidden) store?.setItem(HIDDEN_KEY, "1");
    else store?.removeItem(HIDDEN_KEY);
  } catch {
    // Storage is a convenience; the panel works without it.
  }
}
export const SECTIONS_STORAGE_KEY = "weaveforge.explorer.sections";

export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * The rows to open, from storage when there is a record and from the tree when
 * there is not.
 *
 * `roots` is required rather than defaulted so a caller cannot quietly get the
 * old hard-coded behaviour back by forgetting it. `migrate` is the caller saying
 * "this is the read that may correct a record written before a root existed" —
 * it should be true on exactly one read per session, the first one with roots to
 * compare against. See `migratedExpanded` for why it is not done unconditionally.
 */
export function readExpanded(
  store: KeyValueStore | undefined,
  roots: readonly string[],
  migrate = false,
): Set<string> {
  const fallback = defaultExpanded(roots);
  if (!store) return new Set(fallback);
  try {
    // Parsing is Rust's (`parse_explorer_keys`): absent or unusable is null, and
    // an empty list is a real answer, honoured rather than treated as missing.
    const keys = parseExplorerKeys(store.getItem(EXPLORER_STORAGE_KEY));
    if (keys === null) return new Set(fallback);
    const saved = new Set(keys);
    // An empty record is a decision — "I collapsed everything" — and is never
    // migrated *from*: filling it in would undo the one answer that is a choice
    // rather than a record of a shape.
    if (saved.size === 0) return saved;
    // The migration runs once per *browser*, not once per session. A per-session
    // flag is not enough, and believing it was is how the first version of this
    // shipped: a reader who collapsed the Log got it back on the next launch,
    // because a fresh session cannot tell "this record predates the root" from
    // "the reader closed it" — both are an absent key. The flag in storage is
    // what tells them apart.
    return migrate && !readMigrated(store) ? migratedExpanded(saved, roots) : saved;
  } catch {
    return new Set(fallback);
  }
}

/**
 * Whether this browser has already been corrected for the roots it lacked.
 *
 * A separate key rather than a shape inside the record, because the record's
 * shape is exactly what is ambiguous: an absent root may be a collapse.
 */
export function readMigrated(store: KeyValueStore | undefined): boolean {
  try {
    return store?.getItem(MIGRATED_KEY) === "1";
  } catch {
    return true;
  }
}

export function writeMigrated(store: KeyValueStore | undefined): void {
  try {
    store?.setItem(MIGRATED_KEY, "1");
  } catch {
    // Storage disabled: the correction then happens once per session, which is
    // the old behaviour and still better than nothing.
  }
}

export function writeExpanded(store: KeyValueStore | undefined, expanded: Iterable<string>): void {
  try {
    store?.setItem(EXPLORER_STORAGE_KEY, JSON.stringify([...expanded]));
  } catch {
    // Storage disabled. The tree still expands for this session.
  }
}

/**
 * The sections the explorer stacks, each collapsible on its own.
 *
 * A section is a view over documents, not a place documents live: Files is the
 * mirror folder, Reading lists is the same papers and notes seen through the
 * lists they belong to, Outline is the headings of the document on screen. That
 * is the VS Code arrangement, and it is why the same paper can appear in two
 * sections without either being a duplicate of the other.
 */
export interface ExplorerSection {
  id: string;
  title: string;
  /** Top-level rows. Each carries its own children. */
  tree: readonly WorkspaceTreeNode[];
  /** Sections that start collapsed, like VS Code's Outline. */
  collapsedByDefault?: boolean;
}

/** Which sections are open, honouring each section's own default. */
export function readSections(
  store: KeyValueStore | undefined,
  sections: readonly ExplorerSection[],
): SectionState {
  const defaults = (): SectionState => ({ open: new Set(defaultOpenSections(sections)) });
  try {
    const ids = parseExplorerKeys(store?.getItem(SECTIONS_STORAGE_KEY) ?? null);
    if (ids === null) return defaults();
    return { open: new Set(ids) };
  } catch {
    return defaults();
  }
}

export function writeSections(store: KeyValueStore | undefined, state: SectionState): void {
  try {
    store?.setItem(SECTIONS_STORAGE_KEY, JSON.stringify([...state.open]));
  } catch {
    // Storage disabled. The sections still collapse for this session.
  }
}
