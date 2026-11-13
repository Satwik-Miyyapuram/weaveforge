import {
  desktop,
  type DesktopBridge,
  type DesktopVaultSync,
  type DesktopVaultSyncAction,
} from "@/lib/desktop/desktop-bridge";
import { loadCore, readyCore, type RustCore, typedCore } from "@/lib/rust-core";
import {
  type IWorkspaceFs,
  type MirrorResult,
  type WorkspaceProject,
  type WorkspaceSnapshot,
  type WorkspaceStat,
} from "@weaveforge/core";

// --- folder-mirror ---
/**
 * Keeping the folder in step with the database, with the decisions made in Rust.
 *
 * The mirror is one-way and best-effort: the database is the source of truth and the
 * folder a projection of it. WASM cannot await the folder's file system, so this reads
 * the text the plan needs, lets Rust `planMirror` decide what to write, hold and remove,
 * and then applies that plan here, assets included (fetching them is async too).
 */
/** The folder that holds `path`, or "" for a root-level file such as README.md. */
function parentDir(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/**
 * Write a snapshot to the folder, removing files that no longer belong. Same contract
 * as the TS `mirrorWorkspace` it replaces: unchanged files are not rewritten, a file the
 * reader edited since the last run is held back, and only paths the last run wrote can
 * be removed.
 */
export async function mirrorWorkspace(
  core: RustCore,
  snapshot: WorkspaceSnapshot,
  fs: IWorkspaceFs,
  options: {
    /** The project this snapshot belongs to; every path is inside its folder. */
    project: WorkspaceProject;
    /** Paths written by the previous run, so departures can be detected. */
    previousPaths?: readonly string[];
    /** The digest of each path the last run wrote, from the project's manifest. */
    base?: Readonly<Record<string, string>>;
    /** Fetch a blob for an asset the folder references. */
    fetchAsset?(storagePath: string): Promise<Uint8Array | null>;
  },
): Promise<MirrorResult> {
  const serialized = core.serializeWorkspace(snapshot, options.project);
  const { files, assets } = serialized;
  const previousPaths = options.previousPaths ?? [];
  const { base } = options;

  // The plan reads every file it may write, and a departed file only when a base digest
  // could make it a reader's edit; nothing else.
  const present = new Set([...Object.keys(files), ...assets.map((asset) => asset.folderPath)]);
  const departedWithBase = previousPaths.filter(
    (path) => !present.has(path) && base !== undefined && Object.hasOwn(base, path),
  );
  // No prototype, so a path can never collide with an inherited key.
  const disk: Record<string, string> = Object.create(null);
  for (const path of [...Object.keys(files), ...departedWithBase]) {
    const text = await fs.readText(path).catch(() => null);
    if (text !== null) disk[path] = text;
  }

  const plan = core.planMirror(serialized, previousPaths, base, disk);

  const written = [...plan.written];
  for (const path of plan.written) {
    const dir = parentDir(path);
    if (dir) await fs.mkdirp(dir);
    await fs.writeFile(path, files[path] ?? "");
  }

  let unchanged = plan.unchanged;
  if (options.fetchAsset) {
    for (const asset of assets) {
      // Assets are immutable once written: the storage path holds a uuid, so an existing
      // path is the same file and re-fetching it would be a download for nothing.
      if (await fs.stat(asset.folderPath).catch(() => null)) {
        unchanged += 1;
        continue;
      }
      const bytes = await options.fetchAsset(asset.storagePath);
      if (!bytes) continue;
      const dir = parentDir(asset.folderPath);
      if (dir) await fs.mkdirp(dir);
      await fs.writeFile(asset.folderPath, bytes);
      written.push(asset.folderPath);
    }
  }

  // Best-effort: a file already gone is the outcome asked for.
  for (const path of plan.removed) await fs.remove(path).catch(() => undefined);

  return {
    written,
    removed: plan.removed,
    unchanged,
    heldBack: plan.heldBack,
    mirrored: Object.fromEntries(plan.mirrored),
    bases: Object.fromEntries(plan.bases),
  };
}

// --- import-limits ---
/**
 * Bounds on an imported archive.
 *
 * The folder is untrusted: it may have been shared by a collaborator or written
 * by something else on disk. `unzipSync` will happily inflate a 40 KB file into
 * gigabytes and will happily hand back an entry called `../../etc/passwd`, so
 * both are checked before anything is read.
 *
 * The same shape of caps the Overleaf reader already applies to a cloned repo.
 */
export const IMPORT_LIMITS = {
  /** Total uncompressed bytes across every entry. */
  maxTotalBytes: 256 * 1024 * 1024,
  /** One file. A single markdown note far past this is not a note. */
  maxFileBytes: 32 * 1024 * 1024,
  maxEntries: 20_000,
} as const;

export class ImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportLimitError";
  }
}

type ImportLimits = { readonly [K in keyof typeof IMPORT_LIMITS]: number };

/** Rust reports a cap as a plain error; the callers match `ImportLimitError`. */
function asImportLimitError(error: unknown): unknown {
  return error instanceof Error ? new ImportLimitError(error.message) : error;
}

/** What the archive's directory says about one entry, before it is inflated. */
export interface ArchiveEntryInfo {
  name: string;
  originalSize: number;
}

/**
 * A `filter` for `unzipSync` that checks the archive's own directory first.
 *
 * Too many entries, or a declared total past the cap, throws before anything
 * is inflated. An entry declared over the file cap is skipped and named in
 * `oversize`. A declared size can lie, so `sanitizeArchiveEntries` still checks
 * the real bytes afterwards. The counting is Rust's (`ArchiveBudget`).
 */
export function archiveBudget(limits: ImportLimits = IMPORT_LIMITS): {
  filter: (info: ArchiveEntryInfo) => boolean;
  readonly oversize: string[];
} {
  const core = readyCore();
  const budget = core.createArchiveBudget(limits);
  return {
    filter: (info) => {
      try {
        return budget.admit(info.name, info.originalSize);
      } catch (error) {
        throw asImportLimitError(error);
      }
    },
    get oversize() {
      return budget.oversize;
    },
  };
}

/** Inflate only the entries `archiveBudget` lets through. */
export async function unzipWithinLimits(
  bytes: Uint8Array,
  limits: ImportLimits = IMPORT_LIMITS,
): Promise<{ entries: Record<string, Uint8Array>; oversize: string[] }> {
  // `archiveBudget` runs Rust, so the core has to be loaded first.
  await loadCore();
  const { unzipSync } = await import("fflate");
  const budget = archiveBudget(limits);
  const entries = unzipSync(bytes, { filter: budget.filter });
  return { entries, oversize: budget.oversize };
}

export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

/** A file an import left out, and why, so the preview can say so. */
export interface SkippedFile {
  path: string;
  reason: string;
}

export const SKIP_UNSAFE_NAME = "its name could reach outside the folder";
export const SKIP_TOO_BIG = `it is over the ${Math.round(IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB file limit`;

/**
 * Drop unsafe entries and stop if the archive exceeds its budget.
 *
 * Traversal attempts are skipped rather than fatal, so one bad name in an
 * otherwise good archive does not cost the user the whole import. The size and
 * count caps throw, because past them nothing can be trusted to finish. The
 * decision is Rust's (`planArchiveEntries`); this only maps it back onto bytes.
 * Needs the core loaded, which `unzipWithinLimits` ensures.
 */
export function sanitizeArchiveEntries(entries: Record<string, Uint8Array>): {
  safe: ArchiveEntry[];
  skipped: SkippedFile[];
} {
  const names = Object.keys(entries);
  let plan;
  try {
    plan = readyCore().planArchiveEntries(
      names.map((name) => ({ name, size: entries[name]!.byteLength })),
      IMPORT_LIMITS,
    );
  } catch (error) {
    throw asImportLimitError(error);
  }

  const safe: ArchiveEntry[] = [];
  const skipped: SkippedFile[] = [];
  for (const { name, action } of plan) {
    if (action === "keep") safe.push({ path: name, bytes: entries[name]! });
    else if (action === "unsafe-name") skipped.push({ path: name, reason: SKIP_UNSAFE_NAME });
    else if (action === "too-big") skipped.push({ path: name, reason: SKIP_TOO_BIG });
  }
  return { safe, skipped };
}

/**
 * Strip the single wrapping directory an export ZIP carries, so
 * `weaveforge-2026-08-05/notes/x.md` imports as `notes/x.md`. The rule is Rust's
 * (`stripArchiveRoot`).
 */
export function stripArchiveRoot(entries: readonly ArchiveEntry[]): ArchiveEntry[] {
  const paths = readyCore().stripArchiveRoot(entries.map((entry) => entry.path));
  return entries.map((entry, index) => ({ ...entry, path: paths[index]! }));
}

// --- folder-preview-read ---
/** What a folder preview reads: notes, the project's data files and the shared assets. */
export interface PreviewFolderRead {
  files: Record<string, string>;
  jsonFiles: Record<string, string>;
  assets: Map<string, Uint8Array>;
  /** Assets left out for their size. */
  skipped: SkippedFile[];
}

/** The files a preview looks at, without descending into folders it would ignore. */
async function* previewEntries(
  core: RustCore,
  fs: IWorkspaceFs,
  projectRoot: string,
  hasProjectDir: boolean,
): AsyncIterable<WorkspaceStat> {
  for (const top of await fs.list("")) {
    if (top.kind === "file") {
      if (!hasProjectDir) yield top;
    } else if (core.readsFolder(top.path, projectRoot, hasProjectDir)) {
      yield* fs.walk(top.path);
    }
  }
}

/**
 * Read the connected folder for an import preview.
 *
 * A project folder reads its own notes and data files; a legacy flat folder
 * (no project folder yet) reads its top level. Both read the shared assets.
 * An asset over the file cap is skipped on its listed size, before its bytes
 * are read, and the assets together may not pass the total cap.
 *
 * With `only`, a note or data file is read only when listed there, and an
 * asset only when listed or named in a note that was read: an auto-apply
 * looks at what changed, not the whole folder.
 */
export async function readPreviewFolder(
  fs: IWorkspaceFs,
  projectRoot: string,
  hasProjectDir: boolean,
  only?: ReadonlySet<string>,
): Promise<PreviewFolderRead> {
  const core = await loadCore();
  const listed: WorkspaceStat[] = [];
  for await (const entry of previewEntries(core, fs, projectRoot, hasProjectDir)) listed.push(entry);

  // The rules (what to read, which assets a note names, the caps) are Rust's; this reads what it says.
  const onlyPaths = only ? [...only] : undefined;
  const reads = core.planPreviewReads(
    listed.map((entry) => ({ path: entry.path, size: entry.size })),
    projectRoot,
    hasProjectDir,
    onlyPaths,
  );
  const files: Record<string, string> = {};
  for (const path of reads.notes) files[path] = await fs.readText(path);
  const jsonFiles: Record<string, string> = {};
  for (const path of reads.json) jsonFiles[path] = await fs.readText(path);

  const picks = core.planAssetReads(reads.assets, onlyPaths, only ? Object.values(files) : [], IMPORT_LIMITS);
  const assets = new Map<string, Uint8Array>();
  const skipped: SkippedFile[] = [];
  let assetBytes = 0;
  for (const pick of picks) {
    if (pick.action === "too-big") {
      skipped.push({ path: pick.path, reason: SKIP_TOO_BIG });
      continue;
    }
    const bytes = await fs.readFile(pick.path);
    let admit;
    try {
      admit = core.admitAssetBytes(assetBytes, bytes.byteLength, IMPORT_LIMITS);
    } catch (error) {
      throw asImportLimitError(error);
    }
    assetBytes = admit.total;
    if (!admit.keep) {
      skipped.push({ path: pick.path, reason: SKIP_TOO_BIG });
      continue;
    }
    assets.set(pick.path, bytes);
  }

  return { files, jsonFiles, assets, skipped };
}

// --- folder-remote-sync ---
// checkGitRemoteUrl stays TS: it wraps the browser's URL parser, which WASM would duplicate.


/**
 * Pushing and pulling the workspace folder to a git remote (Settings → Workspace folder).
 *
 * Desktop only: the shell runs git, reads the URL and token from its own stores,
 * and never hands the token back. This module only stores what was typed and
 * names the action. Files a pull brings in reach the app the way any outside
 * edit to the folder does: the folder watcher reports them for import.
 */

const NO_SHELL = "Syncing with a git remote needs the desktop app.";

function shell(): (DesktopBridge & Required<Pick<DesktopBridge, "vaultSync">>) | null {
  const bridge = desktop();
  return bridge && typeof bridge.vaultSync === "function"
    ? (bridge as DesktopBridge & Required<Pick<DesktopBridge, "vaultSync">>)
    : null;
}

export function remoteSyncAvailable(): boolean {
  return shell() !== null;
}

/**
 * Store the remote's URL, and the token when one was typed. An empty token
 * keeps the stored one; `null` forgets it. A URL that is not plain https is
 * refused before anything is stored. Answers the URL as stored.
 */
export async function saveRemoteSyncSettings(input: { url: string; token: string | null }): Promise<string> {
  const url = typedCore().checkGitRemoteUrl(input.url);
  if (!url.ok) throw new Error(url.reason);
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.writePreference("vault-git-remote", url.url);
  if (input.token === null) await bridge.clearSecret("git-sync-token");
  else if (input.token.trim()) await bridge.writeSecret("git-sync-token", input.token.trim());
  return url.url;
}

/** Forget the stored token; the URL, typed or stored, plays no part. */
export async function forgetRemoteToken(): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.clearSecret("git-sync-token");
}

/**
 * Forget the remote: its URL and its token. The folder and its history stay
 * as they are; only syncing stops until a URL is saved again.
 */
export async function disconnectRemote(): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.writePreference("vault-git-remote", null);
  await bridge.clearSecret("git-sync-token");
}

export function folderRemoteSync(action: DesktopVaultSyncAction): Promise<DesktopVaultSync> {
  const bridge = shell();
  if (!bridge) return Promise.reject(new Error(NO_SHELL));
  return bridge.vaultSync(action);
}

/**
 * After a rejected push: pull, then push again, in one go. Stops after the
 * pull when it hits a conflict, so nothing is pushed until that is settled.
 */
export async function pullThenPush(): Promise<{ pulled: DesktopVaultSync; pushed: DesktopVaultSync | null }> {
  const pulled = await folderRemoteSync("pull");
  if (pulled.pull?.kind === "conflict") return { pulled, pushed: null };
  return { pulled, pushed: await folderRemoteSync("push") };
}

/** One line for the panel. */
export async function describeRemoteSync(reply: DesktopVaultSync): Promise<string> {
  const core = await loadCore();
  if (reply.pull) return core.describePull(reply.pull);
  if (reply.push) return core.describePush(reply.push);
  const status = reply.status;
  if (!status) return "";
  return core.describeRemoteStatus(status);
}
