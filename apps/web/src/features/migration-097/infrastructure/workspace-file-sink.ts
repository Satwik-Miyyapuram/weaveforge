import type { WorkspaceStat } from "@weaveforge/core";

import type { FileSink } from "../domain/ports";

/** The slice of BrowserWorkspaceFs (features/workspace/infrastructure/parts.ts) the sink uses. */
export interface OpfsLike {
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  writeTextIf(path: string, text: string, expected: string | null): Promise<boolean>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<WorkspaceStat | null>;
  rename(from: string, to: string): Promise<void>;
  walk(dir: string): AsyncIterable<WorkspaceStat>;
}

/**
 * Adapts the OPFS workspace writer to the migration's FileSink port. The export
 * writes into the web workspace (the same files the app reads), so the sink
 * is a thin pass-through with the port's missing-file rules added.
 */
export function workspaceFileSink(fs: OpfsLike): FileSink {
  const exists = async (path: string) => (await fs.stat(path))?.kind === "file";
  return {
    write: (path, data) => fs.writeFile(path, data),

    async list() {
      const paths: string[] = [];
      for await (const entry of fs.walk("")) {
        if (entry.kind === "file") paths.push(entry.path);
      }
      return paths;
    },

    readText: (path) => fs.readText(path),
    readBytes: (path) => fs.readFile(path),

    exists,

    rename: (from, to) => fs.rename(from, to),

    // BrowserWorkspaceFs.remove treats a missing entry as already gone; the port
    // says a missing file is an error, so check first.
    async remove(path) {
      if (!(await exists(path))) throw new Error(`ENOENT: ${path}`);
      await fs.remove(path);
    },

    writeIf: (path, text, expected) => fs.writeTextIf(path, text, expected),
  };
}
