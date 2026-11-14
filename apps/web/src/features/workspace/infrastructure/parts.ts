import { loadCore } from "@/lib/rust-core";
import {
  GIT_SYNC_LIMITS,
  type GitAuthor,
  type GitFileStatus,
  type IWorkspaceFs,
  type IWorkspaceGit,
  safeWorkspacePath,
  walkByList,
  type WorkspaceCommit,
  type WorkspaceStat,
} from "@weaveforge/core";

// --- browser-workspace-fs ---
/**
 * `IWorkspaceFs` over the File System Access API.
 *
 * Two backings, one implementation, because both hand back the same
 * `FileSystemDirectoryHandle`:
 *
 * - `showDirectoryPicker()` — a real folder the user chose, visible in Finder
 *   or Explorer. This is the one that delivers "a folder you own".
 * - `navigator.storage.getDirectory()` (OPFS) — origin-private storage. Always
 *   available and needs no permission prompt, but invisible outside the
 *   browser, so it is the fallback rather than the default.
 *
 * Every path goes through `safeWorkspacePath`, so traversal fails here as well
 * as in the importer.
 */

/**
 * `entries()` is standard and shipped everywhere the rest of this API is, but
 * the DOM lib in this TypeScript version predates it, so it is declared here
 * rather than loosening the whole handle type to `any`.
 */
type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

export class BrowserWorkspaceFs implements IWorkspaceFs {
  constructor(private readonly root: DirHandle) {}

  /** OPFS: always available, invisible to the user's file manager. */
  static async openOpfs(): Promise<BrowserWorkspaceFs> {
    const root = (await navigator.storage.getDirectory()) as DirHandle;
    return new BrowserWorkspaceFs(root);
  }

  /** A folder the user picks. Chromium only; needs a user gesture. */
  static async pickDirectory(): Promise<BrowserWorkspaceFs | null> {
    const picker = (globalThis as { showDirectoryPicker?: (o?: unknown) => Promise<DirHandle> })
      .showDirectoryPicker;
    if (!picker) return null;
    try {
      return new BrowserWorkspaceFs(await picker({ mode: "readwrite" }));
    } catch {
      // The user dismissed the picker; not an error worth surfacing.
      return null;
    }
  }

  static get supportsDirectoryPicker(): boolean {
    return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
  }

  private async dirFor(path: string, create: boolean): Promise<DirHandle | null> {
    const parts = path ? safeWorkspacePath(path).split("/") : [];
    let dir = this.root;
    for (const part of parts) {
      try {
        dir = (await dir.getDirectoryHandle(part, { create })) as DirHandle;
      } catch {
        return null;
      }
    }
    return dir;
  }

  private async fileFor(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const [parent, name] = (await loadCore()).splitLeaf(safeWorkspacePath(path));
    const dir = await this.dirFor(parent, create);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(name, { create });
    } catch {
      return null;
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const handle = await this.fileFor(path, false);
    if (!handle) throw new Error(`ENOENT: ${path}`);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    const handle = await this.fileFor(path, false);
    if (!handle) throw new Error(`ENOENT: ${path}`);
    return (await handle.getFile()).text();
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const handle = await this.fileFor(path, true);
    if (!handle) throw new Error(`Cannot write ${path}`);
    const writable = await handle.createWritable();
    try {
      // Copy into a fresh buffer: a Uint8Array view over a larger ArrayBuffer
      // would otherwise write the whole backing store.
      await writable.write(typeof data === "string" ? data : new Uint8Array(data));
    } finally {
      await writable.close();
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const [parent, name] = (await loadCore()).splitLeaf(safeWorkspacePath(path));
    const dir = await this.dirFor(parent, false);
    if (!dir) return;
    try {
      await dir.removeEntry(name, { recursive: options?.recursive ?? false });
    } catch (error) {
      // Only a missing entry is "already gone"; any other refusal is a failed delete.
      if ((error as { name?: unknown } | null)?.name !== "NotFoundError") throw error;
    }
  }

  async mkdirp(path: string): Promise<void> {
    await this.dirFor(path, true);
  }

  async list(dir: string): Promise<readonly WorkspaceStat[]> {
    const handle = await this.dirFor(dir, false);
    if (!handle) return [];
    const prefix = dir ? `${safeWorkspacePath(dir)}/` : "";
    const out: WorkspaceStat[] = [];
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === "file") {
        const file = await (entry as FileSystemFileHandle).getFile();
        out.push({
          path: `${prefix}${name}`,
          size: file.size,
          modifiedAt: new Date(file.lastModified).toISOString(),
          kind: "file",
        });
      } else {
        out.push({ path: `${prefix}${name}`, size: 0, modifiedAt: "", kind: "dir" });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  walk(dir: string): AsyncIterable<WorkspaceStat> {
    return walkByList(this, dir);
  }

  async stat(path: string): Promise<WorkspaceStat | null> {
    const handle = await this.fileFor(path, false);
    if (handle) {
      const file = await handle.getFile();
      return {
        path: safeWorkspacePath(path),
        size: file.size,
        modifiedAt: new Date(file.lastModified).toISOString(),
        kind: "file",
      };
    }
    const dir = await this.dirFor(path, false);
    return dir ? { path: safeWorkspacePath(path), size: 0, modifiedAt: "", kind: "dir" } : null;
  }

  async rename(from: string, to: string): Promise<void> {
    // No native move in the File System Access API; copy then delete.
    const bytes = await this.readFile(from);
    await this.writeFile(to, bytes);
    await this.remove(from);
  }
}

// --- desktop-workspace-fs ---
/**
 * The desktop bridge's folder calls, wearing the workspace port's face.
 *
 * `BrowserWorkspaceFs` beside this one covers File System Access and OPFS, and
 * everything above the port -- the mirror, the importer, the git adapter --
 * already works against either. This adds the third backing: a real directory
 * on disk, reached through the desktop shell, which is the only one of the
 * three another editor can also open.
 *
 * Two methods have no channel behind them and are satisfied here instead.
 * `mkdirp` is a no-op because a write creates its parents on the far side, and
 * a channel that makes empty directories is a channel that can litter a folder
 * with them. `rename` is a copy and a delete, which is what a rename across a
 * process boundary would be anyway.
 */

export interface VaultFileBridge {
  readVaultFile(path: string): Promise<string | null>;
  writeVaultFile(path: string, contents: string): Promise<void>;
  /** Absent on shells without the checked write (Electron). */
  writeVaultFileIf?(path: string, contents: string, expected: string | null): Promise<boolean>;
  readVaultBytes(path: string): Promise<Uint8Array | null>;
  writeVaultBytes(path: string, bytes: Uint8Array): Promise<void>;
  listVaultFiles(path?: string): Promise<
    readonly { path: string; kind: "file" | "dir"; size: number; modifiedAt: string }[]
  >;
  statVaultFile(path: string): Promise<
    { path: string; kind: "file" | "dir"; size: number; modifiedAt: string } | null
  >;
  removeVaultFile(path: string): Promise<void>;
}

export class DesktopWorkspaceFs implements IWorkspaceFs {
  constructor(private readonly bridge: VaultFileBridge) {}

  async readText(path: string): Promise<string> {
    const contents = await this.bridge.readVaultFile(safeWorkspacePath(path));
    // The port's contract is that a missing file throws; the bridge answers
    // null so that asking about one is not an error in itself.
    if (contents === null) throw new Error(`ENOENT: ${path}`);
    return contents;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = await this.bridge.readVaultBytes(safeWorkspacePath(path));
    if (bytes === null) throw new Error(`ENOENT: ${path}`);
    return bytes;
  }

  // Bytes and text take different channels: a PDF put through the text one
  // would be decoded as UTF-8 on the way and would not be the same file.
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const at = safeWorkspacePath(path);
    if (typeof data === "string") await this.bridge.writeVaultFile(at, data);
    else await this.bridge.writeVaultBytes(at, data);
  }

  // The compare happens in the shell, next to the disk, so the window an
  // outside edit can slip through is the shell's, not a round trip's.
  async writeTextIf(path: string, text: string, expected: string | null): Promise<boolean> {
    const at = safeWorkspacePath(path);
    if (this.bridge.writeVaultFileIf) return this.bridge.writeVaultFileIf(at, text, expected);
    if ((await this.bridge.readVaultFile(at)) !== expected) return false;
    await this.bridge.writeVaultFile(at, text);
    return true;
  }

  async remove(path: string): Promise<void> {
    await this.bridge.removeVaultFile(safeWorkspacePath(path));
  }

  async mkdirp(_path: string): Promise<void> {
    // Writes create their parents; nothing else needs a directory to exist.
  }

  async list(dir: string): Promise<readonly WorkspaceStat[]> {
    return this.bridge.listVaultFiles(dir === "" || dir === "." ? "" : safeWorkspacePath(dir));
  }

  walk(dir: string): AsyncIterable<WorkspaceStat> {
    return walkByList(this, dir);
  }

  async stat(path: string): Promise<WorkspaceStat | null> {
    // The bridge answers null for a missing file. Anything it throws (no folder
    // open, permission denied) is a failure, not "absent": callers that read
    // null as absent go on to write or delete.
    return this.bridge.statVaultFile(safeWorkspacePath(path));
  }

  async rename(from: string, to: string): Promise<void> {
    // Bytes, not text: a text round trip mangles anything that is not UTF-8.
    await this.writeFile(to, await this.readFile(from));
    await this.remove(from);
  }
}

// --- isomorphic-fs-adapter ---
/**
 * `IWorkspaceFs` → the `node:fs/promises` surface isomorphic-git expects.
 *
 * isomorphic-git talks to a `{ promises: … }` object shaped like Node's fs. Our
 * port is deliberately smaller (no modes, inodes, or symlinks), so this shim
 * fills the gap with plausible constants. That is sound here because git only
 * uses them for the index and tree entries: every file is reported as a regular
 * 0o100644 blob, which is what a folder of markdown is anyway.
 *
 * The alternative, `@isomorphic-git/lightning-fs`, is less code but keeps
 * `.git` in IndexedDB — divorced from the folder the user can see, which
 * defeats the point of having a visible folder at all.
 */

class NotFoundError extends Error {
  readonly code = "ENOENT";
  constructor(path: string) {
    super(`ENOENT: no such file or directory, '${path}'`);
    this.name = "ENOENT";
  }
}

class ExistsError extends Error {
  readonly code = "EEXIST";
  constructor(path: string) {
    super(`EEXIST: file already exists, '${path}'`);
    this.name = "EEXIST";
  }
}

/** Stat shaped the way isomorphic-git reads it. */
function statLike(size: number, mtimeMs: number, isDir: boolean) {
  return {
    // Git stores mode, uid, gid, and inode in the index. Stable fakes keep the
    // index consistent between runs; real values would tell git nothing extra
    // about a browser filesystem.
    mode: isDir ? 0o040755 : 0o100644,
    size: isDir ? 0 : size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  };
}

/**
 * isomorphic-git works from an absolute-looking `dir`; strip it back to the
 * repo-relative paths the port speaks. `"/"`, `"."` and `""` all mean the repo
 * root, which the port has no path for — callers must check for the empty
 * string rather than passing it on, since `safeWorkspacePath` rejects it.
 */
async function normalize(path: string): Promise<string> {
  return (await loadCore()).normalizeRepoPath(path);
}

/** The repo root always exists as a directory, even before anything is written. */
const ROOT_STAT_MTIME = 0;

/**
 * The shape isomorphic-git's `PromiseFsClient` requires. Spelled out rather
 * than widened to `any`, so a missing method is a compile error here instead of
 * a runtime failure part-way through a commit.
 */
export interface IsomorphicFs {
  promises: {
    /** Required by isomorphic-git's bind list even though git rarely calls it. */
    cp: Function;
    readFile: Function;
    writeFile: Function;
    unlink: Function;
    readdir: Function;
    mkdir: Function;
    rmdir: Function;
    stat: Function;
    lstat: Function;
    readlink?: Function;
    symlink?: Function;
    chmod?: Function;
  };
}

/**
 * Build the fs object to hand to isomorphic-git.
 *
 * `readlink`/`symlink` throw rather than pretending: git checks for symlinks
 * while walking, and silently reporting success would corrupt the tree. A
 * folder of markdown has no symlinks, so the throw is never reached in
 * practice — but it fails loudly if that assumption ever breaks.
 */
export function isomorphicFsFrom(fs: IWorkspaceFs): IsomorphicFs {
  const promises = {
    async cp(source: string, destination: string) {
      await fs.writeFile(await normalize(destination), await fs.readFile(await normalize(source)));
    },

    async readFile(path: string, options?: { encoding?: string } | string) {
      const target = await normalize(path);
      let bytes: Uint8Array;
      try {
        bytes = await fs.readFile(target);
      } catch {
        throw new NotFoundError(path);
      }
      const encoding = typeof options === "string" ? options : options?.encoding;
      return encoding === "utf8" ? new TextDecoder().decode(bytes) : bytes;
    },

    async writeFile(path: string, data: Uint8Array | string) {
      await fs.writeFile(await normalize(path), data);
    },

    async unlink(path: string) {
      await fs.remove(await normalize(path));
    },

    async readdir(path: string) {
      const dir = await normalize(path);
      const entries = await fs.list(dir);
      return (await loadCore()).dirEntryNames(
        entries.map((entry) => entry.path),
        dir,
      );
    },

    async mkdir(path: string) {
      const target = await normalize(path);
      if (!target) throw new ExistsError(path);
      const existing = await fs.stat(target).catch(() => null);
      // Node throws on an existing directory and git relies on that to decide
      // whether a repo is already initialised.
      if (existing?.kind === "dir") throw new ExistsError(path);
      await fs.mkdirp(target);
    },

    async rmdir(path: string) {
      await fs.remove(await normalize(path), { recursive: true });
    },

    async stat(path: string) {
      const target = await normalize(path);
      if (!target) return statLike(0, ROOT_STAT_MTIME, true);
      const entry = await fs.stat(target).catch(() => null);
      if (!entry) throw new NotFoundError(path);
      const mtime = Date.parse(entry.modifiedAt);
      return statLike(entry.size, Number.isFinite(mtime) ? mtime : 0, entry.kind === "dir");
    },

    async lstat(path: string) {
      // No symlinks in this filesystem, so lstat and stat agree.
      return promises.stat(path);
    },

    async readlink(path: string) {
      throw new NotFoundError(path);
    },

    async symlink() {
      throw new Error("symlinks are not supported in the workspace folder");
    },

    async chmod() {
      // Modes are fixed by `statLike`; accepting the call is honest because
      // there is nothing to change, and throwing would abort a checkout.
    },
  };

  return { promises };
}

// --- isomorphic-workspace-git ---
export interface IsomorphicWorkspaceGitOptions {
  /** Overrides the size cap; tests use it to avoid 25 MB fixtures. */
  maxFileBytes?: number;
}

/**
 * Local git history over the workspace folder, via isomorphic-git.
 *
 * `isomorphic-git` is already a dependency (the Overleaf reader clones with it
 * server-side), so this adds a shim rather than a package.
 *
 * Local operations only — no clone, push, pull, or merge. Remotes from a
 * browser need a CORS proxy plus stored credentials; remote sync is the desktop
 * shell's (`apps/shell/src/git.rs`).
 *
 * Commit scope: `git.commit` commits whatever the index holds, so every commit
 * first brings the index back in line with the sync policy. Entries the policy
 * excludes are reset to HEAD (or removed when HEAD has none), whether an older
 * run or a failed commit left them staged.
 */
export class IsomorphicWorkspaceGit implements IWorkspaceGit {
  readonly kind = "isomorphic" as const;
  private readonly fs;
  private readonly workspace: IWorkspaceFs;
  private readonly dir = "/";
  private readonly maxFileBytes: number;

  constructor(workspaceFs: IWorkspaceFs, options: IsomorphicWorkspaceGitOptions = {}) {
    this.workspace = workspaceFs;
    this.fs = isomorphicFsFrom(workspaceFs);
    this.maxFileBytes = options.maxFileBytes ?? GIT_SYNC_LIMITS.maxFileBytes;
  }

  /** Loaded on demand so no git bytes reach the bundle until versioning is on. */
  private async git() {
    return import("isomorphic-git");
  }

  async isRepo(): Promise<boolean> {
    try {
      const git = await this.git();
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD", depth: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    const git = await this.git();
    await git.init({ fs: this.fs, dir: this.dir, defaultBranch: "main" });
  }

  /**
   * Files in folders the sync policy ignores (node_modules and the like) do
   * not appear here. isomorphic-git still walks those folders; the filter only
   * keeps them out of the result.
   */
  async status(): Promise<readonly GitFileStatus[]> {
    const core = await loadCore();
    const git = await this.git();
    const rows = await git.statusMatrix({
      fs: this.fs,
      dir: this.dir,
      filter: (path) => !core.isUnderIgnoredFolder(path),
    });
    const out: GitFileStatus[] = [];
    // Row shape is [path, head, workdir, stage]; the state mapping lives in Rust.
    for (const [path, head, workdir] of rows) {
      const state = core.gitStatusState(head, workdir);
      if (state) out.push({ path: String(path), state: state as GitFileStatus["state"] });
    }
    return out;
  }

  async commitAll(message: string, author: GitAuthor): Promise<WorkspaceCommit | null> {
    const git = await this.git();
    const { kept, skipped } = await this.classify(await this.status());
    if (skipped.length > 0) {
      console.warn(`[git-sync] ${skipped.length} changed file(s) not committed (size cap or ignored)`);
    }
    await this.unstageOutOfScope(new Set(kept.map((change) => change.path)), new Set(skipped));

    // Committing nothing produces an empty commit on every mirror pass, which
    // would make the history useless for seeing what actually changed.
    if (kept.length === 0) return null;

    for (const change of kept) {
      if (change.state === "deleted") {
        await git.remove({ fs: this.fs, dir: this.dir, filepath: change.path });
      } else {
        await git.add({ fs: this.fs, dir: this.dir, filepath: change.path });
      }
    }

    const oid = await git.commit({
      fs: this.fs,
      dir: this.dir,
      message,
      author: { name: author.name, email: author.email },
    });

    return {
      oid,
      message,
      authoredAt: new Date().toISOString(),
      author: author.name,
    };
  }

  /** Splits changes into what is committed and the paths the policy keeps out. */
  private async classify(changes: readonly GitFileStatus[]): Promise<{ kept: GitFileStatus[]; skipped: string[] }> {
    const core = await loadCore();
    const kept: GitFileStatus[] = [];
    const skipped: string[] = [];
    for (const change of changes) {
      const size = change.state === "deleted" ? 0 : ((await this.workspace.stat(change.path))?.size ?? 0);
      if (core.decideGitSyncPath(change.path, size, this.maxFileBytes).include) kept.push(change);
      else skipped.push(change.path);
    }
    return { kept, skipped };
  }

  /**
   * Resets index entries that the commit must not carry. Only entries the
   * policy excludes by name or folder, or that were just skipped for size, are
   * checked, so a large tracked history is not rehashed on every pass.
   */
  private async unstageOutOfScope(keptPaths: ReadonlySet<string>, skippedPaths: ReadonlySet<string>): Promise<void> {
    const core = await loadCore();
    const git = await this.git();
    const indexed: string[] = await git.listFiles({ fs: this.fs, dir: this.dir });
    const strays = core.outOfScopeStrays(indexed, [...keptPaths], [...skippedPaths], this.maxFileBytes);
    if (strays.length === 0) return;

    const rows = await git.statusMatrix({ fs: this.fs, dir: this.dir, filepaths: strays });
    // Stage differs from head when the index holds something other than HEAD.
    for (const [path, head, , stage] of rows) {
      const action = core.unstageAction(head, stage);
      if (action === "remove") {
        await git.remove({ fs: this.fs, dir: this.dir, filepath: String(path) });
      } else if (action === "reset") {
        await git.resetIndex({ fs: this.fs, dir: this.dir, filepath: String(path), ref: "HEAD" });
      }
    }
  }

  async log(options: { path?: string; limit?: number } = {}): Promise<readonly WorkspaceCommit[]> {
    try {
      const git = await this.git();
      const entries = await git.log({
        fs: this.fs,
        dir: this.dir,
        depth: options.limit ?? 50,
        filepath: options.path,
      });
      return entries.map((entry) => ({
        oid: entry.oid,
        message: entry.commit.message.trim(),
        authoredAt: new Date(entry.commit.author.timestamp * 1000).toISOString(),
        author: entry.commit.author.name,
      }));
    } catch (err) {
      // No commits yet is the common case, not an error worth surfacing. Any
      // other failure is a damaged repo, and an empty history would hide it.
      if (await this.hasNoCommits()) return [];
      throw err;
    }
  }

  /** True when HEAD resolves to nothing: a repo that was never committed to. */
  private async hasNoCommits(): Promise<boolean> {
    try {
      const git = await this.git();
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" });
      return false;
    } catch (err) {
      return (err as { code?: string }).code === "NotFoundError";
    }
  }

  async readAt(oid: string, path: string): Promise<Uint8Array | null> {
    try {
      const git = await this.git();
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: this.dir,
        oid,
        filepath: path,
      });
      return blob;
    } catch {
      return null;
    }
  }
}
