import {
  safeWorkspacePath,
  type IWorkspaceFs,
  type WorkspaceStat,
} from "../workspace/fs-port.js";

/**
 * Map-backed `IWorkspaceFs`. Exists so the serializer and importer can be
 * exercised without a browser, and so a real adapter can be run against the
 * same conformance suite.
 */
export class MemoryWorkspaceFs implements IWorkspaceFs {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>();
  private readonly times = new Map<string, string>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(safeWorkspacePath(path));
    if (!data) throw new Error(`ENOENT: ${path}`);
    return data;
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const safe = safeWorkspacePath(path);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.files.set(safe, bytes);
    this.times.set(safe, this.now());
    const parts = safe.split("/");
    for (let i = 1; i < parts.length; i += 1) this.dirs.add(parts.slice(0, i).join("/"));
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const safe = safeWorkspacePath(path);
    this.files.delete(safe);
    if (options?.recursive) {
      for (const key of [...this.files.keys()]) {
        if (key.startsWith(`${safe}/`)) this.files.delete(key);
      }
      for (const key of [...this.dirs]) {
        if (key === safe || key.startsWith(`${safe}/`)) this.dirs.delete(key);
      }
    }
  }

  async mkdirp(path: string): Promise<void> {
    const safe = safeWorkspacePath(path);
    const parts = safe.split("/");
    for (let i = 1; i <= parts.length; i += 1) this.dirs.add(parts.slice(0, i).join("/"));
  }

  async list(dir: string): Promise<readonly WorkspaceStat[]> {
    const prefix = dir ? `${safeWorkspacePath(dir)}/` : "";
    const seen = new Map<string, WorkspaceStat>();
    for (const [path, bytes] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        seen.set(path, {
          path,
          size: bytes.byteLength,
          modifiedAt: this.times.get(path) ?? this.now(),
          kind: "file",
        });
      } else {
        const dirPath = prefix + rest.slice(0, slash);
        seen.set(dirPath, { path: dirPath, size: 0, modifiedAt: this.now(), kind: "dir" });
      }
    }
    return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async *walk(dir: string): AsyncIterable<WorkspaceStat> {
    const prefix = dir ? `${safeWorkspacePath(dir)}/` : "";
    for (const [path, bytes] of [...this.files.entries()].sort()) {
      if (!path.startsWith(prefix)) continue;
      yield {
        path,
        size: bytes.byteLength,
        modifiedAt: this.times.get(path) ?? this.now(),
        kind: "file",
      };
    }
  }

  async stat(path: string): Promise<WorkspaceStat | null> {
    const safe = safeWorkspacePath(path);
    const bytes = this.files.get(safe);
    if (bytes) {
      return {
        path: safe,
        size: bytes.byteLength,
        modifiedAt: this.times.get(safe) ?? this.now(),
        kind: "file",
      };
    }
    return this.dirs.has(safe)
      ? { path: safe, size: 0, modifiedAt: this.now(), kind: "dir" }
      : null;
  }

  async rename(from: string, to: string): Promise<void> {
    const source = safeWorkspacePath(from);
    const target = safeWorkspacePath(to);
    const bytes = this.files.get(source);
    if (!bytes) throw new Error(`ENOENT: ${from}`);
    this.files.delete(source);
    await this.writeFile(target, bytes);
  }

  /** Test helper: the whole tree as a path→text map. */
  toRecord(): Record<string, string> {
    const decoder = new TextDecoder();
    return Object.fromEntries(
      [...this.files.entries()].map(([path, bytes]) => [path, decoder.decode(bytes)]),
    );
  }
}
