import { getContainer } from "@/bootstrap";
import { overleafSidebarRows } from "@/features/report/index";
import { activeProjectRoot } from "@/features/workspace/application/parts";
import { logToApp } from "@/lib/error-report/app-log";
import { type CiteCompletion, paperCiteLabel } from "@/lib/hooks/use-cite-links";
import { isHydratedPage, noteBodyText } from "@/lib/parts";
import { readyCore, typedCore } from "@/lib/rust-core";
import {
  defaultExpanded,
  defaultOpenSections,
  emptyLayout,
  kindNames,
  layoutFromRecord,
  type ListItemEntry,
  memberRank,
  migratedExpanded,
  type PaneLayout,
  parseExplorerKeys,
  type SectionState,
  type WorkspaceTreeNode,
} from "@weaveforge/wasm";

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
 * The chord a command is on, as it should be printed in the UI.
 *
 * The empty state's shortcut grid and any tooltip read *this*, not a string
 * typed into JSX, so a label cannot claim a chord `commandForChord` does not
 * accept — and changing a binding here changes every place it is shown.
 *
 * One chord per command, and the modifier is written once: `⌘P`, not `Ctrl+P
 * or ⌘P`. The editor already treats the two as the same key, so printing both
 * would be noise; `⌘` is the shorter of the two spellings.
 */
const CHORDS: Record<WorkspaceCommand, string> = {
  "quick-open": "⌘P",
  "toggle-mode": "⌘E",
  "new-note": "⌘N",
  "toggle-explorer": "⌘B",
  "toggle-focus": "F11",
  "show-shortcuts": "⌘/",
  "reopen-tab": "⌘⇧T",
  "rename-doc": "F2",
  "toggle-sidebar": "⌘⇧B",
  "duplicate-note": "⌘D",
  "command-palette": "⌘⇧P",
  "workspace-search": "⌘⇧F",
  "split-right": "⌘\\",
  "close-tab": "⌘W",
  "next-tab": "⌘⇥",
  "previous-tab": "⌘⇧⇥",
  "tab-1": "⌘1",
  "tab-2": "⌘2",
  "tab-3": "⌘3",
  "tab-4": "⌘4",
  "tab-5": "⌘5",
  "tab-6": "⌘6",
  "tab-7": "⌘7",
  "tab-8": "⌘8",
  "last-tab": "⌘9",
};

export function shortcutTable(): Record<WorkspaceCommand, string> {
  return { ...CHORDS };
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
 * Each project keeps its own panes: a tab from project A restored into
 * project B is a document B cannot open. No project means the plain key.
 */
function layoutKey(projectId: string | null | undefined): string {
  return projectId ? `${LAYOUT_STORAGE_KEY}.${projectId}` : LAYOUT_STORAGE_KEY;
}

/**
 * The raw record for a project. Layouts saved before they were per project
 * sit under the plain key: the first project opened adopts that record and
 * the plain key is cleared, so no second project inherits the same tabs.
 */
function readRaw(store: LayoutStore, projectId: string | null | undefined): string | null {
  const key = layoutKey(projectId);
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
  if (!store) return emptyLayout();
  try {
    return layoutFromRecord(readRaw(store, projectId));
  } catch {
    return emptyLayout();
  }
}

export function writeLayout(
  store: KeyValueStore | undefined,
  layout: PaneLayout,
  projectId?: string | null,
): void {
  try {
    store?.setItem(layoutKey(projectId), JSON.stringify(layout));
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

  const paperRows = papers?.papers ?? [];
  const sectionRows = report?.flat ?? [];
  const listRows = lists?.lists ?? [];
  const logRows = log ?? [];
  // A reload rebuilds the set from summaries; a note already hydrated keeps
  // its full body as long as the summary still describes it — the preview
  // is the body's head, so a body that changed underneath shows as a
  // preview that no longer matches, and the tab hydrates again.
  const previous = hydrated;
  const loaded: Document[] = [
    ...vault.flat.map((page) => {
      // `vault.flat` holds summaries, which have no `body` — reading one off
      // them was always `undefined`, so every note in the workspace was
      // indexed with an empty body. `noteBodyText` prefers the full body when
      // the entry has been hydrated and falls back to the preview otherwise.
      const summary = noteBodyText(page);
      const kept = previous.get(page.id);
      const keep = kept !== undefined && !isHydratedPage(page) && kept.startsWith(summary);
      const body = keep ? kept : summary;
      return {
        // A note is one kind whatever its body holds: a note with ink in its
        // header (§4.1) opens in Ink mode rather than being a second kind with
        // a second suffix. `ink_page` stays in the kind table for old tabs.
        kind: "vault_page",
        id: page.id,
        title: page.title,
        body,
        hydrated: keep || isHydratedPage(page),
        path: `notes/${page.title || "Untitled"}.note.md`,
        parentId: page.parentId ?? undefined,
      };
    }),
    // Two documents per paper: its notes and its PDF. The PDF row has no body
    // of its own — the reader fetches the file by the paper's id.
    ...paperRows.flatMap((paper) => [
      {
        kind: "paper",
        id: paper.id,
        title: paper.title,
        body: paper.summary ?? "",
        hydrated: true,
        path: `papers/${paper.title || "Untitled"}.paper.md`,
        tags: paper.tags,
      },
      {
        kind: "paper_pdf",
        id: paper.id,
        title: paper.title,
        body: "",
        hydrated: true,
        path: `papers/${paper.title || "Untitled"}.pdf`,
        tags: paper.tags,
      },
    ]),
    ...sectionRows.map((section) => ({
      kind: "report_section",
      id: section.id,
      title: section.title,
      body: section.notes ?? "",
      hydrated: true,
      path: `report/${section.title || "Untitled"}.report.md`,
    })),
    // A log entry, as a document. Its body is markdown and always whole — the
    // repository reads the row out in one piece — so hydrated is true and no
    // pane has to wait for a second fetch before it may save.
    ...logRows.map((entry) => ({
      kind: "log_entry",
      id: entry.id,
      title: entry.entryDate,
      body: entry.body,
      hydrated: true,
      path: typedCore().logPath(entry.id, entry.entryDate, projectRoot),
    })),
    // An Overleaf project's tab: its editor, with nothing to hydrate or save here.
    ...overleaf.map((project) => ({
      kind: "overleaf",
      id: project.id,
      title: project.name,
      body: "",
      hydrated: true,
      path: `overleaf/${project.name}`,
    })),
  ];

  // The `@` and `[[` rows, in the shape `/notes` builds them: a paper's row
  // carries its authors and year so a cite can be formatted, a note's and a
  // section's just their title. Duplicate titles collapse to one row.
  const seen = new Set<string>();
  const rows: CiteCompletion[] = [];
  for (const paper of paperRows) {
    const key = readyCore().normalizeTitleKey(paper.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(paperCiteLabel(paper));
  }
  const titled = [
    ...vault.flat.map((page) => ({ title: page.title, detail: "note" })),
    ...sectionRows.map((section) => ({ title: section.title, detail: "section" })),
  ];
  for (const row of titled) {
    const key = readyCore().normalizeTitleKey(row.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ title: row.title, label: row.title, detail: row.detail });
  }
  const completions = rows;
  const tree = readyCore().buildWorkspaceTree({
      projectRoot,
      notes: vault.flat.map((page) => ({
        id: page.id,
        title: page.title,
        parentId: page.parentId ?? undefined,
        kind: "vault_page",
        folder: page.folder === true,
      })),
      papers: paperRows.map((paper) => ({
        id: paper.id,
        title: paper.title,
        hasNote: Boolean(paper.summary?.trim()),
      })),
      reportSections: sectionRows.map((section) => ({
        id: section.id,
        title: section.title,
        parentId: section.parentId ?? undefined,
      })),
      logEntries: logRows.map((entry) => ({
        id: entry.id,
        entryDate: entry.entryDate,
      })),
      overleafProjects: overleaf,
  });

  // Reading lists, as a view over the same documents rather than a second
  // copy of them. The membership rows are the many-to-many join in core.
  let listsTree: WorkspaceTreeNode[] = [];
  let membership: ReadonlyMap<string, string[]> = new Map();
  if (lists) {
    const titles = new Map<string, string>();
    for (const doc of loaded) titles.set(`${doc.kind}:${doc.id}`, doc.title);
    const listTitles = new Map(listRows.map((list) => [`reading_list:${list.id}`, list.name]));
    const items: ListItemEntry[] = [];
    if (listRows.length > 0) {
      const rows = await sectionOr(
        container.readingLists.listItemsForLists(listRows.map((list) => list.id)),
        "list items",
        [],
      );
      for (const row of rows) {
        if (row.paperId) {
          items.push({
            listId: row.listId,
            kind: "paper",
            id: row.paperId,
            inheritedFromListId: row.inheritedFromListId,
            duplicateOfItemId: row.duplicateOfItemId,
          });
        } else if (row.vaultPageId) {
          items.push({
            listId: row.listId,
            kind: "vault_page",
            id: row.vaultPageId,
            inheritedFromListId: row.inheritedFromListId,
            duplicateOfItemId: row.duplicateOfItemId,
          });
        }
      }
    }
    // Papers before notes, from `kind.ts`'s own ordering column, so the
    // rule is not a comparison against `"paper"` in two places.
    const memberRankByKind = Object.fromEntries(kindNames().map((kind) => [kind, memberRank(kind)]));
    listsTree = readyCore().buildListsTree({
      lists: listRows.map((list) => ({
        id: list.id,
        title: list.name,
        parentId: list.parentId,
        description: list.description,
      })),
      items,
      titles: Object.fromEntries(titles),
      memberRank: memberRankByKind,
    });
    membership = readyCore().listMembership(items, new Map([...titles, ...listTitles]));
  }

  return { documents: loaded, completions, tree, listsTree, membership };
}
