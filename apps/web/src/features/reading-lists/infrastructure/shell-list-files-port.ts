/**
 * The shell's list-file port: finds `<project>/reading-lists/**\/*.list.md` through
 * the workspace fs and hashes each text, so a write over a changed file is refused.
 */
import { type IWorkspaceFs } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { ListFile, ListFilesPort } from "./file-screening-repository";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class WorkspaceListFilesPort implements ListFilesPort {
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly projectRoot: string,
  ) {}

  async listFiles(): Promise<readonly ListFile[]> {
    const files: ListFile[] = [];
    for (const path of await this.listPaths(`${this.projectRoot}/reading-lists`)) {
      const text = await this.fs.readText(path);
      files.push({ path, text, hash: await sha256Hex(text) });
    }
    return files;
  }

  /** The first list file with an entry for the item, whatever its state. */
  async fileForItem(itemId: string): Promise<ListFile | null> {
    const core = readyCore();
    for (const file of await this.listFiles()) {
      try {
        if (core.listFileHoldsItem(file.text, itemId)) return file;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Writes only if the file still hashes to `expectedHash`. The compare-and-write is one
   * `writeTextIf` call (the shell checks the text it was given against the disk and writes
   * in the same call), so a change that lands after the hash check still refuses.
   */
  async write(path: string, text: string, expectedHash: string): Promise<void> {
    const current = await this.fs.readText(path);
    if ((await sha256Hex(current)) !== expectedHash) {
      throw new Error(`list file changed on disk; not overwritten: ${path}`);
    }
    const written = this.fs.writeTextIf
      ? await this.fs.writeTextIf(path, text, current)
      : (await this.fs.writeFile(path, text), true);
    if (!written) throw new Error(`list file changed on disk; not overwritten: ${path}`);
  }

  /** Recursive walk, one `list` call per folder; missing folder lists nothing. */
  private async listPaths(dir: string): Promise<string[]> {
    const paths: string[] = [];
    for (const entry of await this.fs.list(dir)) {
      if (entry.kind === "dir") paths.push(...(await this.listPaths(entry.path)));
      else if (entry.path.endsWith(".list.md")) paths.push(entry.path);
    }
    return paths;
  }
}
