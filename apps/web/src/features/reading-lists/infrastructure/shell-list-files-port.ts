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

  async linkForItem(itemId: string): Promise<string | null> {
    return (await this.paperNotes()).find((note) => note.id === itemId)?.link ?? null;
  }

  async itemForLink(link: string): Promise<string | null> {
    const core = readyCore();
    const key = core.listItemKey(link);
    if (key === undefined) return null;
    return (await this.paperNotes()).find((note) => core.listItemKey(note.link) === key)?.id ?? null;
  }

  /** The first list file with an entry for the paper `link` points at, whatever its state. */
  async fileForLink(link: string): Promise<ListFile | null> {
    const core = readyCore();
    for (const file of await this.listFiles()) {
      try {
        if (core.listFileHoldsItem(file.text, link)) return file;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Each `.paper.md` under the project's papers folder as its id and `[[link]]`. A file
   * without an id is the paper at its path, as in the paper repository; an unreadable one is skipped.
   */
  private async paperNotes(): Promise<{ id: string; link: string }[]> {
    const core = readyCore();
    const dir = core.entityDir("paper", this.projectRoot);
    const notes: { id: string; link: string }[] = [];
    if (!(await this.fs.stat(dir))) return notes;
    for await (const entry of this.fs.walk(dir)) {
      if (!entry.path.endsWith(".paper.md")) continue;
      let id: unknown;
      try {
        id = core.paperRowFromFile(await this.fs.readText(entry.path)).id;
      } catch {
        continue;
      }
      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1, -".md".length);
      notes.push({ id: typeof id === "string" && id ? id : entry.path, link: `[[${name}]]` });
    }
    return notes;
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
