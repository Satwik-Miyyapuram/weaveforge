import { safeWorkspacePath, type IWorkspaceFs, type WorkspaceStat } from "@weaveforge/core";

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
    const safe = safeWorkspacePath(path);
    const parts = safe.split("/");
    const name = parts.pop()!;
    const dir = await this.dirFor(parts.join("/"), create);
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
    const safe = safeWorkspacePath(path);
    const parts = safe.split("/");
    const name = parts.pop()!;
    const dir = await this.dirFor(parts.join("/"), false);
    if (!dir) return;
    try {
      await dir.removeEntry(name, { recursive: options?.recursive ?? false });
    } catch {
      /* already gone */
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

  async *walk(dir: string): AsyncIterable<WorkspaceStat> {
    const entries = await this.list(dir);
    for (const entry of entries) {
      if (entry.kind === "file") {
        yield entry;
        continue;
      }
      yield* this.walk(entry.path);
    }
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
