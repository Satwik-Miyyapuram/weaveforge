import {
  WorkspacePathError,
  safeWorkspacePath,
  type IWorkspaceFs,
  type WorkspaceStat,
} from "@weaveforge/core";

/**
 * The bridge's six folder calls, wearing the workspace port's face.
 *
 * `mirrorWorkspace` was written against `IWorkspaceFs` and has never had a real
 * filesystem under it. This is the adapter that gives it one, so nothing about
 * the mirror needs to know it is talking to another process.
 *
 * Two methods have no channel behind them and are satisfied here instead.
 * `mkdirp` is a no-op because a write creates its parents on the far side, and
 * a channel that makes empty directories is a channel that can litter a folder
 * with them. `rename` is a copy and a delete, which is what a rename across a
 * process boundary would be anyway.
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface VaultFileBridge {
  readVaultFile(path: string): Promise<string | null>;
  writeVaultFile(path: string, contents: string): Promise<void>;
  listVaultFiles(path?: string): Promise<
    readonly { path: string; kind: "file" | "dir"; size: number; modifiedAt: string }[]
  >;
  statVaultFile(path: string): Promise<
    { path: string; kind: "file" | "dir"; size: number; modifiedAt: string } | null
  >;
  removeVaultFile(path: string): Promise<void>;
}

export class DesktopVaultFs implements IWorkspaceFs {
  constructor(private readonly bridge: VaultFileBridge) {}

  async readText(path: string): Promise<string> {
    const contents = await this.bridge.readVaultFile(safeWorkspacePath(path));
    // The port's contract is that a missing file throws; the bridge answers
    // null so that asking about one is not an error in itself.
    if (contents === null) throw new Error(`ENOENT: ${path}`);
    return contents;
  }

  async readFile(path: string): Promise<Uint8Array> {
    return encoder.encode(await this.readText(path));
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const contents = typeof data === "string" ? data : decoder.decode(data);
    await this.bridge.writeVaultFile(safeWorkspacePath(path), contents);
  }

  async remove(path: string): Promise<void> {
    await this.bridge.removeVaultFile(safeWorkspacePath(path));
  }

  async mkdirp(): Promise<void> {
    // Writes create their parents; nothing else needs a directory to exist.
  }

  async list(dir: string): Promise<readonly WorkspaceStat[]> {
    return this.bridge.listVaultFiles(dir === "" || dir === "." ? "" : safeWorkspacePath(dir));
  }

  async *walk(dir: string): AsyncIterable<WorkspaceStat> {
    for (const entry of await this.list(dir)) {
      if (entry.kind === "file") yield entry;
      else yield* this.walk(entry.path);
    }
  }

  async stat(path: string): Promise<WorkspaceStat | null> {
    try {
      return await this.bridge.statVaultFile(safeWorkspacePath(path));
    } catch (error) {
      if (error instanceof WorkspacePathError) throw error;
      return null;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await this.writeFile(to, await this.readText(from));
    await this.remove(from);
  }
}
