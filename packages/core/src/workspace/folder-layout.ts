/** Types for folder-layout. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

export const WORKSPACE_META_DIR = ".weaveforge";

export type WorkspaceEntityType =
  | "vault_page"
  | "ink_page"
  | "paper"
  | "reading_list"
  | "report_section"
  | "experiment"
  | "milestone"
  | "log_entry";

/** Top-level directory per entity type. */
export const ENTITY_DIRS: Record<WorkspaceEntityType, string> = {
  vault_page: "notes",
  // An ink note is a note: it lives in the same tree, reads in the same pane and
  // resolves `[[links]]` against the same table. Only its body differs — the
  // strokes are beside it in `.ink/<id>/`, never in the markdown (§4.6).
  ink_page: "notes",
  paper: "papers",
  reading_list: "reading-lists",
  report_section: "report",
  experiment: "experiments",
  milestone: "plan",
  log_entry: "logbook",
};

/**
 * The type, spelled into the filename: `methods--a1b2c3.note.md`.
 *
 * The directory already says what a file is, but the directory is the first
 * thing that falls away — in a tab, in quick-open, in a search result, in the
 * OS "recent files" list, `methods--a1b2c3.md` could be a note, a paper's note
 * or a report section. The suffix travels with the name.
 *
 * It is a hint and never a source of truth: `weaveforge-id` frontmatter and
 * the containing directory decide what a file is, in that order, so a folder
 * written before this existed still imports and a file moved by hand into the
 * wrong directory is read as what its directory says.
 */
export const KIND_SUFFIX: Record<WorkspaceEntityType, string> = {
  vault_page: "note",
  // `.ink.md`: the note is still markdown — the text layer is the body, and the
  // strokes are per-page binary chunks in the `.ink/<id>/` sidecar (§4.1).
  ink_page: "ink",
  paper: "paper",
  reading_list: "list",
  report_section: "report",
  experiment: "experiment",
  milestone: "milestone",
  log_entry: "log",
};

/**
 * Filesystem-safe, human-readable slug. Reserved Windows device names get a
 * suffix — a file called `con.md` cannot be created on Windows, and a folder
 * that will not round-trip on one platform is not portable.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Every project gets its own folder, and every entity path is inside one.
 *
 * The layout used to put `papers/`, `notes/`, `report/` at the top of the
 * workspace with no project in the path, which made the folder ambiguous the
 * moment there was more than one project: the mirror keeps one manifest of what
 * it wrote, so a run for project B saw project A's files as files it no longer
 * produces and deleted them. One folder per project is what makes "departures"
 * mean departures from *this* project.
 *
 * `slug--id6`, the same shape every file in this layout uses, rather than a bare
 * slug: two projects may share a name, and renaming one should not have to be
 * resolved against another.
 */
/** The project a run is scoped to. Read from the container, never guessed. */
export interface WorkspaceProject {
  id: string;
  name: string;
}

export interface FolderNode {
  id: string;
  title: string;
  parentId?: string;
}

/** Assets live in one tree so a body's relative links resolve from anywhere. */
export const ASSET_DIR = "assets";

/** Where a paper's PDF is kept in the folder: `papers/pdf/<paperId>.pdf`. */
export const PAPER_PDF_DIR = "papers/pdf";

/** Where a paper's full-text web page is kept: `papers/html/<paperId>.html`. */
export const PAPER_HTML_DIR = "papers/html";

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface FolderLayoutFns {
  /** The type a path's suffix claims, or null when it carries none. */
  parseKindSuffix(path: string): WorkspaceEntityType | null;
  /** The filename with its kind suffix and extension removed. */
  stripKindSuffix(name: string): string;
  slugFor(title: string, fallback?: string): string;
  /** Short id suffix used to break slug collisions inside one directory. */
  idSuffix(id: string): string;
  projectDir(project: WorkspaceProject): string;
  /** A project's own bookkeeping: `<project>/.weaveforge/`. */
  projectMetaDir(projectRoot: string): string;
  /**
 * Directory path for a tree entity, using the folder-note convention: a node
 * with children becomes a directory holding a same-named file for its own body.
 * This is what Obsidian does, and it is the shape `import-notes.ts` already
 * parses on the way in.
 */
  treePaths(nodes: readonly FolderNode[], type: WorkspaceEntityType, projectRoot?: string): Map<string, string>;
  /** Flat path for a non-tree entity, with an id suffix so titles may repeat. */
  flatPath(type: WorkspaceEntityType, id: string, title: string, projectRoot?: string): string;
  /** Logbook is dated rather than titled: `logbook/2026/03/2026-03-14--ab12cd.log.md`. */
  logPath(id: string, entryDate: string, projectRoot?: string): string;
  /**
 * The folder's copy of a paper's PDF. A desktop copy with a folder open keeps
 * every PDF it has fetched here — the folder is the user's, syncs and goes
 * under git like the notes do, and reads back with no network — where a
 * browser has only its own cache and fetches again when that is gone.
 */
  paperPdfPath(paperId: string, projectRoot?: string): string;
  /**
 * The folder's copy of a paper that is published as a web page rather than a
 * PDF (arXiv's HTML, PubMed Central, a journal's full-text page). Kept already
 * sanitised — no scripts, no forms — so the file is safe to open on its own.
 */
  paperHtmlPath(paperId: string, projectRoot?: string): string;
  /**
 * Where a stored blob lands in the folder.
 *
 * `storagePath` keeps its owner and entity segments (`{userId}/{pageId}/{file}`)
 * rather than being flattened to the filename: two notes may hold images called
 * `diagram.png`, and the segments are what stop them colliding.
 */
  assetPath(scope: "notes" | "papers" | "report", storagePath: string): string;
}
