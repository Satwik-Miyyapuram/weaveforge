import {
  WorkspacePathError,
  safeWorkspacePath,
  type IWorkspaceFs,
  type WorkspaceStat,
} from "@weaveforge/core";

/**
 * The desktop bridge's folder calls, wearing the workspace port's face.
 *
 * `BrowserWorkspaceFs` beside this one covers File System Access and OPFS, and
 * everything above the port -- the mirror, the importer, the git adapter --
 * already works against either. This adds the third backing: a real directory
 * on disk, reached through the desktop shell, which is the only one of the
 * three another editor can also open.
 *
 * Two methods have no channel behind them and are satisfied here instead.
 * `mkdirp` is a no-op because a write creates its parents on the far side, and
 * a channel that makes empty directories is a channel that can litter a folder
 * with them. `rename` is a copy and a delete, which is what a rename across a
 * process boundary would be anyway.
 */

export interface VaultFileBridge {
  readVaultFile(path: string): Promise<string | null>;
  writeVaultFile(path: string, contents: string): Promise<void>;
  readVaultBytes(path: string): Promise<Uint8Array | null>;
  writeVaultBytes(path: string, bytes: Uint8Array): Promise<void>;
  listVaultFiles(path?: string): Promise<
    readonly { path: string; kind: "file" | "dir"; size: number; modifiedAt: string }[]
  >;
  statVaultFile(path: string): Promise<
    { path: string; kind: "file" | "dir"; size: number; modifiedAt: string } | null
  >;
  removeVaultFile(path: string): Promise<void>;
}

export class DesktopWorkspaceFs implements IWorkspaceFs {
  constructor(private readonly bridge: VaultFileBridge) {}

  async readText(path: string): Promise<string> {
    const contents = await this.bridge.readVaultFile(safeWorkspacePath(path));
    // The port's contract is that a missing file throws; the bridge answers
    // null so that asking about one is not an error in itself.
    if (contents === null) throw new Error(`ENOENT: ${path}`);
    return contents;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = await this.bridge.readVaultBytes(safeWorkspacePath(path));
    if (bytes === null) throw new Error(`ENOENT: ${path}`);
    return bytes;
  }

  // Bytes and text take different channels: a PDF put through the text one
  // would be decoded as UTF-8 on the way and would not be the same file.
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const at = safeWorkspacePath(path);
    if (typeof data === "string") await this.bridge.writeVaultFile(at, data);
    else await this.bridge.writeVaultBytes(at, data);
  }

  async remove(path: string): Promise<void> {
    await this.bridge.removeVaultFile(safeWorkspacePath(path));
  }

  async mkdirp(_path: string): Promise<void> {
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
    // Bytes, not text: a text round trip mangles anything that is not UTF-8.
    await this.writeFile(to, await this.readFile(from));
    await this.remove(from);
  }
}
