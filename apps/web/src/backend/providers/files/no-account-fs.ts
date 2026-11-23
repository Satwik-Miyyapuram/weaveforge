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
  /** The folder open now, fixed: a multi-step write (a trash move) uses it so a folder switch cannot split it. */
  pin(): IWorkspaceFs {
    return openFolder();
  }
  async readFile(path: string): Promise<Uint8Array> {
    return openFolder().readFile(path);
  }
  async readText(path: string): Promise<string> {
    return openFolder().readText(path);
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    return openFolder().writeFile(path, data);
  }
  /**
   * The open folder's own conditional write, or none when that folder has none (or no folder
   * is open), so callers see the folder's real capability and take their own checked fallback
   * or refuse. Never a plain write: that would overwrite a file changed meanwhile.
   */
  get writeTextIf(): IWorkspaceFs["writeTextIf"] {
    const fs = activeWorkspaceFs();
    return fs?.writeTextIf ? fs.writeTextIf.bind(fs) : undefined;
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
