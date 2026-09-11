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
export const SECTIONS_STORAGE_KEY = "weaveforge.explorer.sections";

/** The roots start open: an explorer with nothing visible looks broken. */
export const DEFAULT_EXPANDED: readonly string[] = ["notes", "papers", "report"];

export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function readExpanded(store: KeyValueStore | undefined): Set<string> {
  if (!store) return new Set(DEFAULT_EXPANDED);
  try {
    const raw = store.getItem(EXPLORER_STORAGE_KEY);
    if (raw === null) return new Set(DEFAULT_EXPANDED);
    const parsed: unknown = JSON.parse(raw);
    // An empty array is a real answer — the user collapsed everything — so it
    // is honoured, unlike a missing or malformed record.
    if (!Array.isArray(parsed)) return new Set(DEFAULT_EXPANDED);
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    return new Set(DEFAULT_EXPANDED);
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
