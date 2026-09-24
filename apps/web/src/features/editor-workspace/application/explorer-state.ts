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

import type { WorkspaceTreeNode } from "./workspace-tree";

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

/**
 * The roots that start open, given the roots the workspace actually has.
 *
 * This used to be a constant — `["notes", "papers", "report"]` — and the
 * hard-coded list is a bug with a delay on it: the tree grows a root, the
 * constant does not, and the new root is the one section left shut. The logbook
 * found it. A reader with 22 log entries opens their workspace and sees "Log"
 * collapsed with no indication there is anything inside, which is the same
 * complaint as an empty explorer.
 *
 * Taking the roots as an argument means the default follows the tree: a plugin
 * that adds a root gets it open without anyone remembering to.
 */
export function defaultExpanded(roots: readonly string[]): readonly string[] {
  return roots;
}

/**
 * The roots the tree knows about but the stored record does not mention.
 *
 * A record is a *delta* against the roots of the day it was written, and nothing
 * ever rewrites it when a root appears — so a returning reader keeps a list from
 * before the logbook existed and the new root stays shut, which is exactly the
 * reader the "start open" rule was written for. The keys in the record win; a
 * root the record has never heard of is added.
 *
 * This is a **migration**, and the caller runs it once (see `readExpanded`'s
 * `migrate` argument). It has to be, because it cannot tell "the record predates
 * this root" from "the reader closed this root" by looking at the record alone:
 * a collapse and an absence are the same absent key. Run on every read, it
 * reopens every section anybody ever closed.
 */
export function migratedExpanded(
  saved: ReadonlySet<string>,
  roots: readonly string[],
): Set<string> {
  const missing = defaultExpanded(roots).filter((key) => !saved.has(key));
  return missing.length === 0 ? new Set(saved) : new Set([...saved, ...missing]);
}

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
    const raw = store.getItem(EXPLORER_STORAGE_KEY);
    if (raw === null) return new Set(fallback);
    const parsed: unknown = JSON.parse(raw);
    // An empty array is a real answer — the user collapsed everything — so it
    // is honoured, unlike a missing or malformed record. It is also the one
    // record that is never migrated *from*: an empty set is a decision, and
    // filling it in would undo it.
    if (!Array.isArray(parsed)) return new Set(fallback);
    const saved = new Set(parsed.filter((key): key is string => typeof key === "string"));
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

/** Expanded rows, with `key` flipped. Returns a new set; never mutates. */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** Close every branch at once — the explorer's single most-wanted control. */
export function collapseAll(): Set<string> {
  return new Set();
}

/**
 * Open every branch the tree has.
 *
 * Separate from `toggleExpanded` because "expand all" has to walk the tree: a
 * key that was never expanded must still be found, and only branches (nodes
 * with children) belong in the set.
 */
export function expandAll(nodes: readonly WorkspaceTreeNode[]): Set<string> {
  const keys = new Set<string>();
  const walk = (node: WorkspaceTreeNode) => {
    if (node.children.length === 0) return;
    keys.add(node.key);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return keys;
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

export const DEFAULT_OPEN_SECTIONS: readonly string[] = ["files", "lists"];

/** Which sections are open. Anything not in the set is closed. */
export interface SectionState {
  open: ReadonlySet<string>;
}

/** Which sections are open, honouring each section's own default. */
export function readSections(
  store: KeyValueStore | undefined,
  sections: readonly ExplorerSection[],
): SectionState {
  const defaults = (): SectionState => ({
    open: new Set(
      sections.filter((section) => !section.collapsedByDefault).map((section) => section.id),
    ),
  });
  try {
    const raw = store?.getItem(SECTIONS_STORAGE_KEY) ?? null;
    if (raw === null) return defaults();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults();
    return { open: new Set(parsed.filter((id): id is string => typeof id === "string")) };
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

/**
 * Open or close one section, touching no other.
 *
 * Collapsing Files must not close Reading lists — they are independent views,
 * and one shared "collapsed" flag is exactly the bug that makes a stacked
 * explorer feel like it is fighting the user.
 */
export function toggleSection(state: SectionState, id: string): SectionState {
  const open = new Set(state.open);
  if (!open.delete(id)) open.add(id);
  return { open };
}

export function isSectionOpen(state: SectionState, id: string): boolean {
  return state.open.has(id);
}
