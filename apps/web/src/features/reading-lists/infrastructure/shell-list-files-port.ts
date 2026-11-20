/**
 * The shell's list-file port: finds `<project>/reading-lists/**\/*.list.md` through
 * the workspace fs and hashes each text, so a write over a changed file is refused.
 */
import { type IWorkspaceFs, type ScreeningDecision } from "@weaveforge/core";
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

  async fileForItem(itemId: string): Promise<ListFile | null> {
    const core = readyCore();
    for (const file of await this.listFiles()) {
      let decisions: ScreeningDecision[];
      try {
        decisions = core.screeningInListFile(file.text) as ScreeningDecision[];
      } catch {
        continue;
      }
      if (decisions.some((d) => d.itemId === itemId)) return file;
    }
    return null;
  }

  async write(path: string, text: string, expectedHash: string): Promise<void> {
    const currentHash = await sha256Hex(await this.fs.readText(path));
    if (currentHash !== expectedHash) {
      throw new Error(`list file changed on disk; not overwritten: ${path}`);
    }
    await this.fs.writeFile(path, text);
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
