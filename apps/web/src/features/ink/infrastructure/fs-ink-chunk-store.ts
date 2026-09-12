/**
 * Chunks in the workspace folder: `.ink/<weaveforge-id>/<ulid>.inkb` (§4.1).
 *
 * The folder is the mirror the user can see, sync and put under git, so this
 * is the store that makes an ink note an ordinary file. It lists the directory,
 * which is what lets a chunk another device wrote appear as an orphan page.
 */

import { inkChunkPath, inkSidecarDir, type IWorkspaceFs } from "@weaveforge/core";

import { chunkIdOfFileName, type InkChunkStore } from "../application/ink-chunk-store";

export class FsInkChunkStore implements InkChunkStore {
  constructor(private readonly fs: () => IWorkspaceFs | null) {}

  private require(): IWorkspaceFs {
    const fs = this.fs();
    if (!fs) throw new Error("ink: no workspace folder is open");
    return fs;
  }

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    const fs = this.fs();
    if (!fs) return null;
    const path = inkChunkPath(noteId, chunkId);
    if (!(await fs.stat(path))) return null;
    return fs.readFile(path);
  }

  async write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void> {
    const fs = this.require();
    await fs.mkdirp(inkSidecarDir(noteId));
    await fs.writeFile(inkChunkPath(noteId, chunkId), bytes);
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    const fs = this.require();
    const path = inkChunkPath(noteId, chunkId);
    if (await fs.stat(path)) await fs.remove(path);
  }

  async list(noteId: string): Promise<string[] | null> {
    const fs = this.fs();
    if (!fs) return null;
    const dir = inkSidecarDir(noteId);
    if (!(await fs.stat(dir))) return [];
    const ids: string[] = [];
    for (const entry of await fs.list(dir)) {
      if (entry.kind !== "file") continue;
      const id = chunkIdOfFileName(entry.path.split("/").pop() ?? "");
      if (id) ids.push(id);
    }
    return ids.sort();
  }
}
