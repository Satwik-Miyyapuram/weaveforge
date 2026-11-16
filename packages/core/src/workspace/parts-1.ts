import { INK_NOTE_TYPE } from "../ink/parts-2.js";
import { WorkspacePathError } from "../shared/errors.js";
import { rust, type VaultPageBase } from "../shared/rust.js";
import {
  DEFAULT_SYNC_BRANCH,
  type GitPullResult,
  type GitPushResult,
  type GitRemoteStatus,
  type IWorkspaceGitRemote,
} from "./parts-2.js";
import type { WorkspaceSnapshot } from "./parts-2.js";

// --- folder-layout ---
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

// --- deserialize-workspace ---
/**
 * Shapes of a folder import: parsed entities and the diff against what is stored.
 * Parsing and the diff (`parseWorkspaceFolder`, `diffWorkspace`) are Rust, reached
 * through `rust()`. The folder is untrusted input: ids are matched conservatively
 * there, and paths are validated by the caller before reaching here.
 */
export interface ParsedEntity {
  /** Absent when the file carries no `weaveforge-id` — a hand-created file. */
  id?: string;
  type: WorkspaceEntityType;
  title: string;
  body: string;
  path: string;
  fields: Record<string, string | number | boolean | string[]>;
}

// Every type has a directory, so the directory table lists them all. An ink
// note declares its type in frontmatter as well as in its `.ink.md` suffix;
// without the declaration the directory would win and a note with strokes would
// import as a plain note — see the precedence note below.
const KNOWN_TYPES = new Set<string>(Object.keys(ENTITY_DIRS));

/**
 * Infer the type from the directory when frontmatter omits it.
 *
 * The first segment that names an entity type wins, so both layouts read:
 * `notes/idea.md` at the root, and `msc-thesis--8d7317/notes/idea.md` once the
 * folder is scoped to a project. A hand-written file inside a project folder is
 * the case this is for: it carries no `weaveforge-type` and no kind suffix, so
 * the directory is the only thing that can say what it is.
 */
const DIR_TYPES: Record<string, WorkspaceEntityType> = Object.fromEntries(
  (Object.entries(ENTITY_DIRS) as [WorkspaceEntityType, string][])
    // `notes/` holds ink notes too, but a file there without a declaration is a note.
    .filter(([type]) => type !== INK_NOTE_TYPE)
    .map(([type, dir]) => [dir, type]),
);

export function parseWorkspaceFile(path: string, content: string): ParsedEntity | null {
  const segments = path.split("/");
  // `.weaveforge/` at the root, or beside a project's files: bookkeeping either
  // way, and never an entity.
  if (segments.includes(WORKSPACE_META_DIR) || !path.endsWith(".md")) return null;
  if (segments[segments.length - 1] === "README.md") return null;

  const { frontmatter, body } = rust().readFrontmatter(content);
  const declared = rust().frontmatterString(frontmatter, "weaveforge-type");
  const fromDir = DIR_TYPES[segments[0] ?? ""] ?? DIR_TYPES[segments[1] ?? ""];
  // Frontmatter, then the directory, then the filename suffix. The suffix is
  // last because a file dragged into another directory is what its directory
  // says it is, and it is present at all so a loose `ideas.note.md` still
  // imports as a note.
  const type =
    declared && KNOWN_TYPES.has(declared)
      ? (declared as WorkspaceEntityType)
      : (fromDir ?? (rust().parseKindSuffix(path) as WorkspaceEntityType | undefined));
  if (!type) return null;

  const fileName = path.split("/").pop() ?? path;
  const title =
    rust().frontmatterString(frontmatter, "title") ??
    // Fall back to the filename minus any id suffix, so a hand-created
    // `notes/My idea.md` imports with a sensible title.
    rust().stripKindSuffix(fileName).replace(/--[a-zA-Z0-9]{1,8}$/, "");

  const fields: ParsedEntity["fields"] = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === "weaveforge-id" || key === "weaveforge-type" || key === "title") continue;
    fields[key] = value as ParsedEntity["fields"][string];
  }

  // An ink note is stored as a note whose body starts with the ink header (see
  // `ink-note.ts`), so the folder's `ink_page` comes back as a `vault_page` with
  // its frontmatter ink keys folded into that line. The importer then treats it
  // as the note it is, and the strokes stay in `.ink/<id>/` where they were.
  if (type === INK_NOTE_TYPE) {
    return {
      id: rust().frontmatterString(frontmatter, "weaveforge-id"),
      type: "vault_page",
      title: title.trim() || "Untitled",
      body: rust().writeInkNoteBody(rust().readInkNoteMeta(frontmatter), body.trimStart()),
      path,
      fields,
    };
  }

  return {
    id: rust().frontmatterString(frontmatter, "weaveforge-id"),
    type,
    title: title.trim() || "Untitled",
    body: body.trimStart(),
    path,
    fields,
  };
}

/**
 * What an import would do to one thing.
 *
 * `removed` is only ever produced by the JSON data files: a markdown entity has
 * no row to delete — a file that goes is simply no longer mirrored — whereas a
 * relation, a tag or a membership that the folder stopped listing is a row the
 * reader deleted, and saying so is the honest report of it.
 */
export type ImportAction = "created" | "updated" | "unchanged" | "conflict" | "removed";

/**
 * Telling apart "the folder changed" from "the workspace changed".
 *
 * Without this the import diff can only say that two copies of a note differ,
 * which is not enough to act on: applying a difference that came from the
 * workspace's own side overwrites a real edit with an older copy, and the user
 * has no way back. What is missing is the third side -- the note as it stood
 * when the two last agreed, which is exactly what the mirror wrote.
 *
 * So each mirror run records a digest of every file it left in the folder, and
 * the next import compares three digests rather than two texts:
 *
 * - the folder's copy differs from the base -> somebody edited it out there
 * - the workspace's copy differs from the base -> somebody edited it in here
 * - both -> a conflict, which is asked about rather than resolved
 *
 * The digest is FNV-1a, not a cryptographic hash, and deliberately so. It is
 * only ever compared against a value this app produced from the same text on
 * the same machine; nothing is authenticated by it, and a collision costs a
 * missed change rather than a forged one. A crypto digest would mean either a
 * dependency or an async API in a path that is otherwise plain string work.
 */
export type ChangeSide = "neither" | "folder" | "workspace" | "both" | "unknown";

/**
 * Why an entry conflicts, which decides what may be done about it.
 *
 * `both-changed` can be settled any way the user likes -- the two copies are
 * both notes and either is a legitimate answer. `type-mismatch` cannot: the id
 * in the file belongs to a different kind of entity, so there is nothing to
 * update, and importing the file as a new note is the only safe outcome.
 */
export type ConflictKind = "both-changed" | "type-mismatch" | "markers";

export interface ImportDiffEntry {
  action: ImportAction;
  entity: ParsedEntity;
  /** Why an entry is a conflict, shown to the user before any write. */
  reason?: string;
  kind?: ConflictKind;
  /**
   * The fields a per-field merge could not settle, when one was attempted.
   *
   * Present only on a `both-changed` conflict that survived the merge, and it
   * names what is actually in dispute -- `body`, or a frontmatter key -- so the
   * user is asked about the disagreement rather than about the file.
   */
  conflictFields?: readonly string[];
  /**
   * Everything the resolver needs to offer a choice, when one was prepared.
   *
   * Filled by the folder import, not here: this module compares copies and has
   * no merge of its own. Present only on a `both-changed` conflict that the
   * per-field merge could not settle.
   */
  merge?: ImportMergeDetail;
}

/**
 * One key both sides moved, with all three sides so a person can pick.
 *
 * `ours` is the workspace's value and `theirs` the folder's, matching the
 * direction the rest of the import defaults in: an unsettled difference keeps
 * what is already in the app.
 */
export interface MergeFieldDispute {
  field: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
}

/**
 * What the resolver has to work with for one conflicted file.
 *
 * `fields` and `body` are the merged result — every change only one side made is
 * already applied — so composing a settlement is: take these, then override the
 * disputed keys and body hunks with the person's choices. `bodySides` is present
 * only when the body itself is in dispute, and holds the two copies because
 * there is no base text to show: the manifest keeps a digest of a body, never a
 * copy of it.
 */
export interface ImportMergeDetail {
  fields: Record<string, unknown>;
  body: string;
  disputed: readonly MergeFieldDispute[];
  bodySides?: { ours: string; theirs: string };
}

export interface ImportDiff {
  entries: ImportDiffEntry[];
  counts: Record<ImportAction, number>;
}

export interface ExistingEntity {
  id: string;
  type: WorkspaceEntityType;
  title: string;
  body: string;
}

// --- fs-port ---
/**
 * Filesystem port for the workspace folder.
 *
 * Deliberately small: no symlinks, no modes, no streams, no watching. Those are
 * what make a filesystem abstraction expensive to implement, and none of them
 * are needed to write a folder of markdown. Keeping the surface at nine methods
 * is what lets a browser (OPFS or File System Access), an in-memory test
 * double, and a future desktop backend all satisfy it without a rewrite.
 *
 * Paths are POSIX and relative to a root the adapter owns. Adapters reject
 * absolute paths and any segment that escapes the root.
 */
export interface WorkspaceStat {
  path: string;
  size: number;
  modifiedAt: string;
  kind: "file" | "dir";
}

export interface IWorkspaceFs {
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  /**
   * Write text only while the file still says `expected` (null = still missing).
   * False = somebody changed it since the caller read it, and nothing was written.
   * Optional: an adapter without it gets the caller's plain write.
   */
  writeTextIf?(path: string, text: string, expected: string | null): Promise<boolean>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  mkdirp(path: string): Promise<void>;
  /** One level. */
  list(dir: string): Promise<readonly WorkspaceStat[]>;
  /** Recursive, files only. */
  walk(dir: string): AsyncIterable<WorkspaceStat>;
  stat(path: string): Promise<WorkspaceStat | null>;
  rename(from: string, to: string): Promise<void>;
}

/**
 * Every file under `dir`, depth-first in `list` order: the `walk` an adapter
 * gets for free from its own one-level `list`.
 */
export async function* walkByList(
  fs: Pick<IWorkspaceFs, "list">,
  dir: string,
): AsyncIterable<WorkspaceStat> {
  for (const entry of await fs.list(dir)) {
    if (entry.kind === "file") yield entry;
    else yield* walkByList(fs, entry.path);
  }
}

/**
 * Normalize a path and refuse anything that leaves the root (Rust check).
 *
 * Every adapter runs this, and the importer checks archive entries separately,
 * so a traversal attempt has to get past two independent guards. Backslashes
 * are folded first, so a zip written on Windows cannot smuggle `..\..\etc`.
 * Throws `WorkspacePathError`, which callers catch.
 */
export function safeWorkspacePath(path: string): string {
  try {
    return rust().safeWorkspacePath(path);
  } catch {
    throw new WorkspacePathError(path);
  }
}

/** True when a path is safe; for filtering archive entries without throwing. */
export function isSafeWorkspacePath(path: string): boolean {
  try {
    return rust().isSafeWorkspacePath(path);
  } catch {
    return false;
  }
}

// --- folder-mirror ---
/**
 * Keeping the folder in step with the database.
 *
 * The mirror is one-way and best-effort by design. The database is the source of
 * truth; the folder is a projection of it. That means a mirror failure — quota
 * exhausted, permission revoked, disk unplugged — must never fail the save that
 * triggered it. Losing a mirror write costs a stale file until the next sync;
 * failing the save would cost the user their edit.
 */
export interface MirrorResult {
  written: string[];
  removed: string[];
  /** Unchanged files, skipped without a write. */
  unchanged: number;
  /**
   * A digest of every markdown file the folder now holds, by path.
   *
   * This is what the two sides agreed on at the end of this run, and the next
   * import compares against it to tell a folder edit from a workspace one.
   * Written and unchanged files alike: an unchanged file is still agreed.
   */
  mirrored: Record<string, string>;
  /**
   * Paths left as the folder has them, because they changed since the mirror
   * wrote them.
   *
   * A file the reader edited is not the mirror's to overwrite: writing would
   * lose the edit before the import could offer to apply it, and the folder is
   * the only copy of it. The caller surfaces these as outside changes, which is
   * what they are.
   */
  heldBack: string[];
  /**
   * The frontmatter and body digest of every note the folder now holds.
   *
   * Enough for the next import to merge per field rather than only report that
   * two copies differ. Notes only: the other entity types are written from
   * structured records the app owns, and a person editing one by hand in the
   * folder is not the case this was built for.
   */
  bases: Record<string, VaultPageBase>;
}

/**
 * Write a snapshot to the folder, removing files that no longer belong.
 *
 * Content is compared before writing so an unchanged workspace produces no
 * filesystem churn — and, once git is on, no commits full of untouched files.
 * That is only possible because serialization is deterministic.
 *
 * Only files the serializer owns are removed. Anything else in the folder —
 * a user's own notes, a `.obsidian/` directory, an editor's scratch files — is
 * left alone. Deleting unrecognised files in a folder the user can see would
 * be an unpleasant surprise the first time it happened.
 */
export async function mirrorWorkspace(
  snapshot: WorkspaceSnapshot,
  fs: IWorkspaceFs,
  options: {
    /**
     * The project this snapshot belongs to. Every path is written inside its
     * folder, so a run for one project cannot mistake another project's files
     * for its own departed ones.
     */
    project: WorkspaceProject;
    /** Paths written by the previous run, so departures can be detected. */
    previousPaths?: readonly string[];
    /**
     * The digest of each path the last run wrote, from the project's manifest.
     *
     * This is what tells an edit from a difference. Without it the mirror can
     * only see that the file on disk is not what it would write, and it writes
     * — which is how a change made in the folder was lost before the import
     * could offer it. With it, a file whose content has moved on since the app
     * wrote it is somebody's, and is left alone.
     */
    base?: Readonly<Record<string, string>>;
    /** Fetch a blob for an asset the folder references. */
    fetchAsset?(storagePath: string): Promise<Uint8Array | null>;
  },
): Promise<MirrorResult> {
  const { files, assets } = rust().serializeWorkspace(snapshot, options.project);
  const written: string[] = [];
  const removed: string[] = [];
  const heldBack: string[] = [];
  const held = new Set<string>();
  const mirrored: Record<string, string> = {};
  const bases: Record<string, VaultPageBase> = {};
  let unchanged = 0;

  /**
   * The file on disk, when it is a reader's edit rather than the app's content.
   * `known` is the text already read for this path, so it is not read twice.
   */
  const editedSinceBase = async (path: string, content: string, known?: string): Promise<boolean> => {
    const recorded = options.base?.[path];
    if (recorded === undefined) return false;
    const onDisk = known ?? (await fs.readText(path).catch(() => null));
    if (onDisk === null || onDisk === content) return false;
    return rust().digestText(onDisk) !== recorded;
  };

  const hold = (path: string) => {
    if (held.has(path)) return;
    held.add(path);
    heldBack.push(path);
  };

  for (const [path, content] of Object.entries(files)) {
    mirrored[path] = rust().digestText(content);
    const noteBase = rust().vaultPageBase(path, content);
    if (noteBase) bases[path] = noteBase;
    // One read answers "is it there" and "what does it say"; null is missing.
    const current = await fs.readText(path).catch(() => null);
    if (current !== null) {
      if (current === content || rust().unstampForCompare(path, current) === rust().unstampForCompare(path, content)) {
        mirrored[path] = rust().digestText(current);
        unchanged += 1;
        continue;
      }
      // The folder's copy differs from what the app would write. If the app
      // wrote this path before and the file has moved on since, that difference
      // is the reader's edit: leave it, and say so.
      // The root README is shared by every project's mirror, so it never matches one project's base.
      if (!rust().isAppOwnedPath(path) &&(await editedSinceBase(path, content, current))) {
        hold(path);
        continue;
      }
    }
    // Root-level files (README.md) have no directory to create, and "." is not
    // a valid workspace path.
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await fs.mkdirp(dir);
    // Checked against what was read above: an edit that landed since is kept and held.
    if (fs.writeTextIf) {
      if (!(await fs.writeTextIf(path, content, current))) {
        hold(path);
        continue;
      }
    } else {
      await fs.writeFile(path, content);
    }
    written.push(path);
  }

  if (options.fetchAsset) {
    for (const asset of assets) {
      // Assets are immutable once written: the storage path contains a uuid, so
      // a differing path means a different file. Re-fetching an existing one
      // would be a download for no reason.
      if (await fs.stat(asset.folderPath).catch(() => null)) {
        unchanged += 1;
        continue;
      }
      const bytes = await options.fetchAsset(asset.storagePath);
      if (!bytes) continue;
      const assetDir = asset.folderPath.split("/").slice(0, -1).join("/");
      if (assetDir) await fs.mkdirp(assetDir);
      await fs.writeFile(asset.folderPath, bytes);
      written.push(asset.folderPath);
    }
  }

  const current = new Set([...Object.keys(files), ...assets.map((a) => a.folderPath)]);
  for (const path of options.previousPaths ?? []) {
    if (current.has(path)) continue;
    // An entity the workspace no longer has, but whose file the reader has since
    // edited: the file is theirs now, and deleting it would be the mirror doing
    // to a deletion what it must not do to a write.
    if (await editedSinceBase(path, "")) {
      hold(path);
      continue;
    }
    await fs.remove(path).catch(() => undefined);
    removed.push(path);
  }

  return { written, removed, unchanged, heldBack, mirrored, bases };
}

// --- git-port ---
/**
 * Git operations for the workspace folder.
 *
 * Six methods, not the forty a full git UI needs. What this exists for is
 * "keep a history of my folder and let me look at it" — staging areas,
 * branching, rebasing, and conflict resolution are a different product.
 *
 * Remotes (connect, pull, push) are `IWorkspaceGitRemote` in `git-remote.ts`,
 * kept apart so local history never implies talking to a server.
 */
export interface WorkspaceCommit {
  oid: string;
  message: string;
  authoredAt: string;
  author: string;
}

export interface GitFileStatus {
  path: string;
  state: "added" | "modified" | "deleted";
}

export interface GitAuthor {
  name: string;
  email: string;
}

export interface IWorkspaceGit {
  /** Which backend is in play, so the UI can say what history is available. */
  readonly kind: "none" | "isomorphic" | "native";
  isRepo(): Promise<boolean>;
  init(): Promise<void>;
  status(): Promise<readonly GitFileStatus[]>;
  /** Returns null when there was nothing to commit. */
  commitAll(message: string, author: GitAuthor): Promise<WorkspaceCommit | null>;
  log(options?: { path?: string; limit?: number }): Promise<readonly WorkspaceCommit[]>;
  /** File contents at a commit, or null when absent there. */
  readAt(oid: string, path: string): Promise<Uint8Array | null>;
}

/**
 * The default. Versioning is opt-in, and everything above it — mirroring,
 * export, import — has to work with git switched off, so "no git" is a real
 * implementation rather than a null check at every call site.
 */
export class NoOpWorkspaceGit implements IWorkspaceGit, IWorkspaceGitRemote {
  readonly kind = "none" as const;

  async isRepo(): Promise<boolean> {
    return false;
  }

  async init(): Promise<void> {
    /* nothing to initialise */
  }

  async status(): Promise<readonly GitFileStatus[]> {
    return [];
  }

  async commitAll(): Promise<WorkspaceCommit | null> {
    return null;
  }

  async log(): Promise<readonly WorkspaceCommit[]> {
    return [];
  }

  async readAt(): Promise<Uint8Array | null> {
    return null;
  }

  async remoteStatus(): Promise<GitRemoteStatus> {
    return { url: null, branch: DEFAULT_SYNC_BRANCH, ahead: 0, behind: 0 };
  }

  async connect(): Promise<GitRemoteStatus> {
    throw new Error(NO_HISTORY);
  }

  async pull(): Promise<GitPullResult> {
    throw new Error(NO_HISTORY);
  }

  async push(): Promise<GitPushResult> {
    throw new Error(NO_HISTORY);
  }
}

const NO_HISTORY = "Syncing with a remote needs folder history switched on.";
