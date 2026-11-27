import type { IWorkspaceFs, WorkspaceStat } from "@weaveforge/core";
import { activeWorkspaceFs, folderRestored } from "@/features/workspace/application/workspace-folder";
import { recordOwnWrite } from "./own-writes";

const NO_FOLDER = "Open a folder to keep working without an account.";

function openFolder(): IWorkspaceFs {
  const fs = activeWorkspaceFs();
  if (!fs) throw new Error(NO_FOLDER);
  return fs;
}

/** The open folder once the launch restore has answered, so a read in the first moments of a session finds it. */
async function restoredFolder(): Promise<IWorkspaceFs> {
  await folderRestored();
  return openFolder();
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
    return (await restoredFolder()).readFile(path);
  }
  async readText(path: string): Promise<string> {
    return (await restoredFolder()).readText(path);
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    return (await restoredFolder()).writeFile(path, data).then(() => recordOwnWrite(path, data));
  }
  /**
   * The open folder's own conditional write, or none when that folder has none (or no folder
   * is open), so callers see the folder's real capability and take their own checked fallback
   * or refuse. Never a plain write: that would overwrite a file changed meanwhile.
   */
  get writeTextIf(): IWorkspaceFs["writeTextIf"] {
    const fs = activeWorkspaceFs();
    return fs?.writeTextIf
      ? async (path: string, text: string, expected: string | null) => {
          const wrote = await fs.writeTextIf!(path, text, expected);
          if (wrote) recordOwnWrite(path, text);
          return wrote;
        }
      : undefined;
  }
  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    return (await restoredFolder()).remove(path, options);
  }
  async mkdirp(path: string): Promise<void> {
    return (await restoredFolder()).mkdirp(path);
  }
  async list(dir: string): Promise<readonly WorkspaceStat[]> {
    return (await restoredFolder()).list(dir);
  }
  async *walk(dir: string): AsyncIterable<WorkspaceStat> {
    yield* (await restoredFolder()).walk(dir);
  }
  async stat(path: string): Promise<WorkspaceStat | null> {
    return (await restoredFolder()).stat(path);
  }
  async rename(from: string, to: string): Promise<void> {
    return (await restoredFolder()).rename(from, to);
  }
}
