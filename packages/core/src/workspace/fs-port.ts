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
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  mkdirp(path: string): Promise<void>;
  /** One level. */
  list(dir: string): Promise<readonly WorkspaceStat[]>;
  /** Recursive, files only. */
  walk(dir: string): AsyncIterable<WorkspaceStat>;
  stat(path: string): Promise<WorkspaceStat | null>;
  rename(from: string, to: string): Promise<void>;
}

export class WorkspacePathError extends Error {
  constructor(path: string) {
    super(`Unsafe workspace path: ${path}`);
    this.name = "WorkspacePathError";
  }
}

/**
 * Normalize a path and refuse anything that leaves the root.
 *
 * Every adapter runs this, and the importer checks archive entries separately,
 * so a traversal attempt has to get past two independent guards. Backslashes
 * are folded first: a zip written on Windows can carry `..\..\etc` and would
 * otherwise slip through a check that only looks for forward slashes.
 */
export function safeWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new WorkspacePathError(path);
  }
  const parts: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") throw new WorkspacePathError(path);
    parts.push(segment);
  }
  if (parts.length === 0) throw new WorkspacePathError(path);
  return parts.join("/");
}

/** True when a path is safe; for filtering archive entries without throwing. */
export function isSafeWorkspacePath(path: string): boolean {
  try {
    safeWorkspacePath(path);
    return true;
  } catch {
    return false;
  }
}
