import {
  desktop,
  type DesktopBridge,
  type DesktopGithubCode,
  type DesktopGithubConnected,
  type DesktopVaultSync,
  type DesktopVaultSyncAction,
} from "@/lib/desktop/desktop-bridge";
import { loadCore, readyCore, type RustCore, typedCore } from "@/lib/rust-core";
import { folderLock } from "./folder-lock";
import { keepMirrorBases, readPulledDeletes, writePulledDeletes, writeTextAtomic } from "./parts-3";
import { activeWorkspaceFs } from "./workspace-folder";
import {
  type IWorkspaceFs,
  type MirrorResult,
  type WorkspaceProject,
  type WorkspaceSnapshot,
  type WorkspaceStat,
} from "@weaveforge/core";

// --- folder-mirror ---
/** A mirror run's result, plus the record of path -> DB digest that the next run in this session compares against. */
export type WebMirrorResult = MirrorResult & { readonly served: Readonly<Record<string, string>> };

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

function parseIdMap(text: string): Record<string, string> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" ? (value as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/**
 * The Rust mirror writes the canvas id map from canonical paths only, so a canvas claimed at
 * a non-canonical path (`My Plan (v2).canvas`) would lose its id, and its next edit would
 * re-import as a new page. Keep each claim whose file is still in the folder and whose page still exists.
 */
async function keepClaimedCanvasIds(
  fs: IWorkspaceFs,
  core: RustCore,
  snapshot: WorkspaceSnapshot,
  project: WorkspaceProject,
  serialized: ReturnType<RustCore["serializeWorkspace"]>,
): Promise<ReturnType<RustCore["serializeWorkspace"]>> {
  const mapPath = Object.keys(serialized.files).find((path) => path.endsWith("/canvas-ids.json"));
  if (mapPath === undefined) return serialized;
  const claimed = parseIdMap(await fs.readText(mapPath).catch(() => "") ?? "");
  if (claimed === null) return serialized;
  const fresh = parseIdMap(serialized.files[mapPath] ?? "") ?? {};
  const live = new Set(snapshot.vaultPages.filter((page) => page.kind === "canvas").map((page) => page.id));
  const root = core.projectDir(project);
  const mapped = new Set(Object.values(fresh));
  const kept: Record<string, string> = {};
  for (const [rel, id] of Object.entries(claimed)) {
    // One path per page id: once the mirror maps the page itself, a stale claimed file must not import over it.
    if (Object.hasOwn(fresh, rel) || mapped.has(id) || !live.has(id)) continue;
    if (!(await fs.stat(`${root}/${rel}`).catch(() => null))) continue;
    kept[rel] = id;
  }
  if (Object.keys(kept).length === 0) return serialized;
  const merged = Object.fromEntries(
    Object.entries({ ...fresh, ...kept }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return {
    ...serialized,
    files: { ...serialized.files, [mapPath]: `${JSON.stringify(merged, null, 2)}\n` },
  };
}

/**
 * Write a snapshot to the folder. Sync never removes a file. An existing file is rewritten
 * only when its item changed in the app during this session (`seen` is the record of what
 * this session last mirrored); unchanged files are kept byte-for-byte, and a file the
 * reader edited since the last run is held back.
 */
export async function mirrorWorkspace(
  core: RustCore,
  snapshot: WorkspaceSnapshot,
  fs: IWorkspaceFs,
  options: {
    /** The project this snapshot belongs to; every path is inside its folder. */
    project: WorkspaceProject;
    /**
     * path -> digest of the DB content as this session last mirrored it. Absent on the first
     * run after start, after a DB replace, and after an import: nothing existing is rewritten then.
     */
    seen?: Readonly<Record<string, string>>;
    /** The digest of each path the last run wrote, from the project's manifest. */
    base?: Readonly<Record<string, string>>;
    /** Fetch a blob for an asset the folder references. */
    fetchAsset?(storagePath: string): Promise<Uint8Array | null>;
    /**
     * Extra files written beside the serialized workspace: the synced table files
     * (`.weaveforge/tables/<table>.json`). They are merged here, after the Rust
     * serializer returns, so the Rust writer does not change.
     */
    extraFiles?: Readonly<Record<string, string>>;
  },
): Promise<WebMirrorResult> {
  const serializedWorkspace = await keepClaimedCanvasIds(
    fs,
    core,
    snapshot,
    options.project,
    core.serializeWorkspace(snapshot, options.project),
  );
  const serialized = {
    ...serializedWorkspace,
    files: { ...serializedWorkspace.files, ...options.extraFiles },
  };
  const { base } = options;
  // A mirrored file a pull removed stays out until the reader settles it in the review.
  const pulledDeletes = await readPulledDeletes(fs);
  const held: string[] = [];
  for (const path of pulledDeletes) {
    if (!Object.hasOwn(serialized.files, path) || (await fs.stat(path).catch(() => null))) continue;
    held.push(path);
  }
  const files = Object.fromEntries(Object.entries(serialized.files).filter(([path]) => !held.includes(path)));
  const { assets } = serialized;

  // The plan reads every file it may write, and nothing else. There are no removals to read for.
  // No prototype, so a path can never collide with an inherited key.
  const disk: Record<string, string> = Object.create(null);
  for (const path of Object.keys(files)) {
    const text = await fs.readText(path).catch(() => null);
    if (text !== null) disk[path] = text;
  }

  const plan = core.planMirror({ ...serialized, files }, options.seen, base, disk);

  const written = [...plan.written];
  for (const path of plan.written) {
    const dir = parentDir(path);
    if (dir) await fs.mkdirp(dir);
    // The canvas id map is read on every import; a torn write would hold every canvas.
    if (path.endsWith("/canvas-ids.json")) await writeTextAtomic(fs, path, files[path] ?? "");
    else await fs.writeFile(path, files[path] ?? "");
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

  // This project's entries not held this run were settled: put back, or deleted in the app.
  const root = core.projectDir(options.project);
  const stillPulled = [...pulledDeletes].filter((path) => held.includes(path) || !path.startsWith(`${root}/`));
  await writePulledDeletes(fs, new Set(stillPulled));

  // A held path keeps its base, so the folder watcher reads it as removed and the review offers it.
  const mirrored: Record<string, string> = Object.fromEntries(plan.mirrored);
  for (const path of held) mirrored[path] = base?.[path] ?? "";
  return {
    written,
    removed: plan.removed,
    unchanged,
    heldBack: [...plan.heldBack, ...held],
    mirrored,
    bases: Object.fromEntries(plan.bases),
    // The record the next run in this session compares against: every path and its DB digest.
    served: Object.fromEntries(plan.served),
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
 * Whether GitHub sync is on: a remote URL is saved and a token is held. The
 * vault-git preference itself is write-only from the page, so the URL and the
 * token stand in for it. A failed read throws rather than answering: the sync
 * engine then aborts the cycle, so no push or pull runs on an unknown scope.
 */
export async function githubSyncConnected(): Promise<boolean> {
  if (!shell()) return false;
  const remote = await folderRemoteSync("settings");
  return remote.url !== null && remote.hasToken;
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

const reauthListeners = new Set<() => void>();

/** Called when a sync fails because GitHub wants a new sign-in. Answers the unsubscribe. */
export function onGithubReauth(listener: () => void): () => void {
  reauthListeners.add(listener);
  return () => void reauthListeners.delete(listener);
}

/** Actions that can move the folder's tree: a pull and each conflict choice. */
const MOVES_TREE: ReadonlySet<DesktopVaultSyncAction> = new Set(["pull", "keep-mine", "take-remote", "keep-both"]);

/** Whether a reply says the tree moved, so this machine's manifests go back in. */
const treeMoved = (reply: DesktopVaultSync) => reply.pull?.kind === "fast-forward" || reply.pull?.kind === "merged";

/** One action, for a caller already holding the folder lock. */
function remoteAction(bridge: Required<Pick<DesktopBridge, "vaultSync">>, action: DesktopVaultSyncAction) {
  const fs = MOVES_TREE.has(action) ? activeWorkspaceFs() : null;
  if (!fs) return bridge.vaultSync(action);
  return keepMirrorBases(fs, () => bridge.vaultSync(action), treeMoved);
}

/**
 * Runs one remote step. When it fails, re-reads the settings: if the shell
 * marked the GitHub token as refused, every `onGithubReauth` listener hears
 * it, so a failed auto-sync never fails silently.
 */
async function reportingReauth<T>(
  bridge: Required<Pick<DesktopBridge, "vaultSync">>,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const settings = await bridge.vaultSync("settings").catch(() => null);
    if (settings?.needsReconnect) for (const listener of [...reauthListeners]) listener();
    throw err;
  }
}

/**
 * Run one action on the remote. Those that touch the folder (a pull, a push,
 * a conflict choice) wait for the folder lock, so a mirror run is never
 * writing the files git is moving. Reading the settings or the status does not.
 */
export async function folderRemoteSync(action: DesktopVaultSyncAction): Promise<DesktopVaultSync> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  return reportingReauth(bridge, () =>
    MOVES_TREE.has(action) || action === "push"
      ? folderLock.run(() => remoteAction(bridge, action))
      : bridge.vaultSync(action),
  );
}

type GithubShell = DesktopBridge &
  Required<Pick<DesktopBridge, "vaultSync" | "githubConnectStart" | "githubConnectFinish" | "githubConnectCancel">>;

function githubShell(): GithubShell | null {
  const bridge = shell();
  return bridge &&
    typeof bridge.githubConnectStart === "function" &&
    typeof bridge.githubConnectFinish === "function" &&
    typeof bridge.githubConnectCancel === "function"
    ? (bridge as GithubShell)
    : null;
}

/** The shell can sign in to GitHub and make the repo itself. */
export function githubConnectAvailable(): boolean {
  return githubShell() !== null;
}

/** Ask GitHub for the device code the user types at `verificationUri`. */
export function startGithubConnect(): Promise<DesktopGithubCode> {
  const bridge = githubShell();
  if (!bridge) return Promise.reject(new Error(NO_SHELL));
  return bridge.githubConnectStart();
}

/**
 * Wait for the code to be entered, then let the shell make the private repo
 * (or, on a reconnect, keep the one already set) and set it as the remote;
 * connect it so git knows the remote too. `uploadWorkspace` pushes next.
 */
export async function finishGithubConnect(name: string | null): Promise<DesktopGithubConnected> {
  const bridge = githubShell();
  if (!bridge) throw new Error(NO_SHELL);
  const connected = await bridge.githubConnectFinish(name);
  await bridge.vaultSync("connect");
  return connected;
}

/**
 * The first upload after connecting. When the repo already has commits (a
 * reused repo), pulls them in and pushes again. Rejects with a reason fit to
 * show, so the caller can offer Retry.
 */
export async function uploadWorkspace(): Promise<void> {
  const first = await folderRemoteSync("push");
  if (first.push?.kind !== "rejected") return;
  const { pulled, pushed } = await pullThenPush();
  if (pulled.pull?.kind === "conflict") {
    throw new Error(
      `These files changed both here and on GitHub: ${pulled.pull.files.join(", ")}. ` +
        "Pull under Settings → Workspace folder → Git remote, pick which copy to keep, then Retry.",
    );
  }
  if (pushed?.push?.kind === "rejected") throw new Error(pushed.push.reason);
}

/** Stop waiting; the pending finish rejects as cancelled. */
export async function cancelGithubConnect(): Promise<void> {
  await githubShell()?.githubConnectCancel();
}

/**
 * After a rejected push: pull, then push again, in one go. Stops after the
 * pull when it hits a conflict, so nothing is pushed until that is settled.
 * Holds the folder lock across both, so no mirror run lands between them.
 */
export async function pullThenPush(): Promise<{ pulled: DesktopVaultSync; pushed: DesktopVaultSync | null }> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  return reportingReauth(bridge, () =>
    folderLock.run(async () => {
      const pulled = await remoteAction(bridge, "pull");
      if (pulled.pull?.kind === "conflict") return { pulled, pushed: null };
      return { pulled, pushed: await remoteAction(bridge, "push") };
    }),
  );
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
