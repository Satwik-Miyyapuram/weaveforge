import { getContainer } from "@/bootstrap";
import { overleafSidebarRows } from "@/features/report/index";
import { activeProjectRoot } from "@/features/workspace/application/parts";
import { logToApp } from "@/lib/error-report/app-log";
import { type CiteCompletion } from "@/lib/hooks/use-cite-links";
import { readyCore } from "@/lib/rust-core";
import type { PaneLayout, SectionState, WorkspaceTreeNode } from "@weaveforge/wasm";

// --- explorer-state ---
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
  const fallback = readyCore().defaultExpanded(roots);
  if (!store) return new Set(fallback);
  try {
    // Parsing is Rust's (`parse_explorer_keys`): absent or unusable is null, and
    // an empty list is a real answer, honoured rather than treated as missing.
    const keys = readyCore().parseExplorerKeys(store.getItem(EXPLORER_STORAGE_KEY));
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
    return migrate && !readMigrated(store) ? readyCore().migratedExpanded(saved, roots) : saved;
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
  const defaults = (): SectionState => ({ open: new Set(readyCore().defaultOpenSections(sections)) });
  try {
    const ids = readyCore().parseExplorerKeys(store?.getItem(SECTIONS_STORAGE_KEY) ?? null);
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

// --- keybindings ---
/**
 * Workspace shortcuts, as a lookup rather than a pile of `if`s in the screen.
 *
 * Kept pure so the awkward cases are testable: a shortcut must not fire while
 * the user is typing into the quick-open box, `Ctrl-W` has to be claimed before
 * the host window reads it as "close tab", and Cmd is the modifier on macOS
 * where Ctrl is not.
 */
export type WorkspaceCommand =
  | "quick-open"
  | "split-right"
  | "close-tab"
  | "next-tab"
  | "previous-tab"
  | "toggle-mode"
  | "new-note"
  | "toggle-explorer"
  | "toggle-focus"
  | "show-shortcuts"
  | "reopen-tab"
  | "rename-doc"
  | "toggle-sidebar"
  | "duplicate-note"
  | "command-palette"
  | "workspace-search"
  | TabNumberCommand;

/** `⌘1`–`⌘8` pick a tab by position and `⌘9` the last one, as a browser does. */
export type TabNumberCommand = `tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}` | "last-tab";

export interface KeyChord {
  key: string;
  /** The physical key. Digits are read from here, since AZERTY types them as symbols. */
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * The command a chord means, or `null`. The rule is in Rust
 * (`wf-core` `editor_workspace::keybindings`), so web and tests agree on it.
 *
 * `Ctrl` and `Cmd` are the same modifier: a mac keyboard sends Cmd, a PC
 * keyboard sends Ctrl, and both mean "the modifier" to the person pressing it.
 *
 * `tabCount` is how many tabs the focused pane has. A tab-number chord with no
 * tab behind it is not claimed, so the browser keeps it (its own tab switch).
 */
export function commandForChord(chord: KeyChord, tabCount = Number.POSITIVE_INFINITY): WorkspaceCommand | null {
  return readyCore().commandForChord(chord, tabCount) as WorkspaceCommand | null;
}

/**
 * Whether a shortcut should be ignored because the user is typing.
 *
 * The editor itself is an exception: CodeMirror is a text surface, but the
 * whole point of `Ctrl-W` in an editor shell is closing the document you are
 * editing, so only genuine form fields swallow the chord. That is why this
 * is not `isEditableReaderTarget` (Rust `is_editable_reader_target`), which counts
 * contenteditable as owning its keys.
 */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  return readyCore().isTypingTarget(target.tagName ?? null, !!target.isContentEditable);
}

// --- layout-storage ---
/**
 * The pane layout, across restarts.
 *
 * Stored per device next to the explorer's collapse state, and validated on the
 * way back in rather than trusted: the record outlives the version that wrote
 * it, and a layout is a recursive structure where one wrong field renders as a
 * blank workspace with no way back. Anything that does not parse is one empty
 * pane — which is exactly what a first run looks like, so the failure is
 * survivable rather than a dead screen.
 *
 * The parse is Rust's (`layoutFromRecord`); this module only reads and writes
 * the storage key.
 */
export const LAYOUT_STORAGE_KEY = "weaveforge.editor.layout";

/** Storage that can also forget a key; `localStorage` is one. */
type LayoutStore = KeyValueStore & { removeItem?: (key: string) => void };

/**
 * Each project keeps its own panes (`readyCore().layoutStorageKey`): a tab from
 * project A restored into project B is a document B cannot open.
 *
 * The raw record for a project. Layouts saved before they were per project
 * sit under the plain key: the first project opened adopts that record and
 * the plain key is cleared, so no second project inherits the same tabs.
 */
function readRaw(store: LayoutStore, projectId: string | null | undefined): string | null {
  const key = readyCore().layoutStorageKey(projectId ?? undefined);
  const own = store.getItem(key);
  if (own || key === LAYOUT_STORAGE_KEY) return own;
  const legacy = store.getItem(LAYOUT_STORAGE_KEY);
  if (!legacy) return null;
  store.setItem(key, legacy);
  store.removeItem?.(LAYOUT_STORAGE_KEY);
  return legacy;
}

export function readLayout(
  store: LayoutStore | undefined,
  projectId?: string | null,
): PaneLayout {
  if (!store) return readyCore().emptyLayout();
  try {
    return readyCore().layoutFromRecord(readRaw(store, projectId));
  } catch {
    return readyCore().emptyLayout();
  }
}

export function writeLayout(
  store: KeyValueStore | undefined,
  layout: PaneLayout,
  projectId?: string | null,
): void {
  try {
    store?.setItem(readyCore().layoutStorageKey(projectId ?? undefined), JSON.stringify(layout));
  } catch {
    // Storage disabled. The layout still holds for this session.
  }
}

// --- workspace-load ---
/**
 * The workspace's documents, in one load: every note, paper and report
 * section as a `Document`, the `@`/`[[` completion rows, the explorer tree,
 * and the reading lists as a view over the same rows.
 *
 * Out of the screen because it is the one part of it that is not wiring: a
 * reload is a pure function of the container's screen data and the bodies
 * already hydrated, and the screen only has to put the result into state.
 */
// --- section-fallback ---
/**
 * One explorer section's load, isolated: a section that fails falls back (and
 * so hides) without taking the others down, and the failure is logged rather
 * than vanishing.
 */
export function sectionOr<T, F>(load: Promise<T>, section: string, fallback: F): Promise<T | F> {
  return load.catch((err: unknown) => {
    logToApp({
      level: "warn",
      source: "workspace",
      message: `The ${section} section could not load`,
      detail: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  });
}

// --- workspace-load ---
export interface Document {
  kind: string;
  id: string;
  title: string;
  body: string;
  /**
   * Whether `body` is the whole document. A note arrives from `vault.flat` as
   * a summary whose `bodyPreview` is the first 320 characters — enough to index
   * and to label, not enough to edit: an ink note's figure lines and page
   * breaks sit past that cut, and a save from a preview would write the
   * truncation over the note. A tab hydrates its document before mounting an
   * editor on it.
   */
  hydrated: boolean;
  /** Where the document sits, for the breadcrumbs. */
  path: string;
  /** A note's folder; the tree nests notes by parent. */
  parentId?: string;
  /** A paper's keyword tags, for `#tag` completion. Notes carry theirs inline. */
  tags?: readonly string[];
}

/** What a reload puts into the screen's state. */
export interface WorkspaceData {
  documents: Document[];
  completions: CiteCompletion[];
  tree: WorkspaceTreeNode[];
  listsTree: WorkspaceTreeNode[];
  membership: ReadonlyMap<string, string[]>;
}

/**
 * Load the workspace. `hydrated` is the full note bodies fetched so far, by
 * id: a reload rebuilds the set from summaries, and a note already hydrated
 * keeps its full body as long as the summary still describes it.
 *
 * The reads and the list-items fetch are the only I/O here. The documents,
 * completions, trees and list membership are one Rust pass (`assembleWorkspace`).
 */
export async function loadWorkspace(hydrated: ReadonlyMap<string, string>): Promise<WorkspaceData> {
  // One lookup for the whole load: the tree, the log rows and every other path
  // here describe the same project's folder.
  const projectRoot = await activeProjectRoot();
  const container = getContainer();
  const [vault, papers, report, lists, log, overleaf] = await Promise.all([
    container.vault.loadScreenData(),
    sectionOr(container.papers.loadScreenData(), "papers", null),
    sectionOr(container.report.loadScreenData(), "report", null),
    sectionOr(container.readingLists.loadScreenData(), "reading lists", null),
    // A log entry is markdown and is edited like one, so it is loaded like the
    // other text kinds. Its own screen's read, reused rather than a second query
    // — and caught, because a logbook that will not load must not take Notes,
    // Papers and the Report down with it.
    sectionOr(container.logbook.loadEntries(), "log", null),
    sectionOr(overleafSidebarRows(), "overleaf", []),
  ]);

  const listRows = lists?.lists ?? [];
  // Reading-list items are the one fetch the assembly needs and does not make.
  // They are asked for only when the lists loaded and there is a list to ask about.
  const listItems =
    lists && listRows.length > 0
      ? await sectionOr(
          container.readingLists.listItemsForLists(listRows.map((list) => list.id)),
          "list items",
          [],
        )
      : [];

  return readyCore().assembleWorkspace({
    projectRoot,
    vault: vault.flat,
    papers: papers?.papers ?? [],
    reportSections: report?.flat ?? [],
    listsLoaded: Boolean(lists),
    lists: listRows,
    listItems,
    logs: log ?? [],
    overleaf,
    hydrated: [...hydrated].map(([id, body]) => ({ id, body })),
  });
}
