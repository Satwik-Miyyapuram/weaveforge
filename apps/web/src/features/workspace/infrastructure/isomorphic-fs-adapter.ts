import type { IWorkspaceFs } from "@thesis/core";

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
function normalize(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "." ? "" : trimmed;
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
      await fs.writeFile(normalize(destination), await fs.readFile(normalize(source)));
    },

    async readFile(path: string, options?: { encoding?: string } | string) {
      const target = normalize(path);
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
      await fs.writeFile(normalize(path), data);
    },

    async unlink(path: string) {
      await fs.remove(normalize(path));
    },

    async readdir(path: string) {
      const dir = normalize(path);
      const entries = await fs.list(dir);
      const prefix = dir ? `${dir}/` : "";
      return entries.map((entry) => entry.path.slice(prefix.length)).sort();
    },

    async mkdir(path: string) {
      const target = normalize(path);
      if (!target) throw new ExistsError(path);
      const existing = await fs.stat(target).catch(() => null);
      // Node throws on an existing directory and git relies on that to decide
      // whether a repo is already initialised.
      if (existing?.kind === "dir") throw new ExistsError(path);
      await fs.mkdirp(target);
    },

    async rmdir(path: string) {
      await fs.remove(normalize(path), { recursive: true });
    },

    async stat(path: string) {
      const target = normalize(path);
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
