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

import { WorkspacePathError } from "../shared/errors.js";
import { rust } from "../shared/rust.js";

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

/** Signatures of the path checks that moved to the Rust core (wf-wasm). */
export interface WorkspacePathFns {
  /** Normalized path; throws when it is empty, absolute or climbs out with `..`. */
  safeWorkspacePath(path: string): string;
  /** True when `safeWorkspacePath` accepts the path. */
  isSafeWorkspacePath(path: string): boolean;
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