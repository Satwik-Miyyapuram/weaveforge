import type { IWorkspaceFs, WorkspaceStat } from "@weaveforge/core";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";

const NO_FOLDER = "Open a folder to keep working without an account.";

function openFolder(): IWorkspaceFs {
  const fs = activeWorkspaceFs();
  if (!fs) throw new Error(NO_FOLDER);
  return fs;
}

/**
 * The no-account filesystem: every call resolves the open folder at call time,
 * so a folder opened after the container was built is picked up, and no folder
 * at all is a refusal rather than a stale or null handle.
 */
export class NoAccountWorkspaceFs implements IWorkspaceFs {
  async readFile(path: string): Promise<Uint8Array> {
    return openFolder().readFile(path);
  }
  async readText(path: string): Promise<string> {
    return openFolder().readText(path);
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    return openFolder().writeFile(path, data);
  }
  /** Same contract as the interface: an adapter without the check gets a plain write. */
  async writeTextIf(path: string, text: string, expected: string | null): Promise<boolean> {
    const fs = openFolder();
    if (fs.writeTextIf) return fs.writeTextIf(path, text, expected);
    await fs.writeFile(path, text);
    return true;
  }
  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    return openFolder().remove(path, options);
  }
  async mkdirp(path: string): Promise<void> {
    return openFolder().mkdirp(path);
  }
  async list(dir: string): Promise<readonly WorkspaceStat[]> {
    return openFolder().list(dir);
  }
  async *walk(dir: string): AsyncIterable<WorkspaceStat> {
    yield* openFolder().walk(dir);
  }
  async stat(path: string): Promise<WorkspaceStat | null> {
    return openFolder().stat(path);
  }
  async rename(from: string, to: string): Promise<void> {
    return openFolder().rename(from, to);
  }
}
