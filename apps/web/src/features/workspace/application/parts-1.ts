import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { readyCore } from "@/lib/rust-core";
import type { IWorkspaceFs, IWorkspaceGit, WorkspaceCommit } from "@weaveforge/core";

/**
 * Whether another note that still exists keeps its strokes in `notePath`'s
 * strokes folder (`x/foo.md` and a legacy `x/foo.ink.md` share `x/foo.ink`).
 */
export async function inkFolderShared(fs: IWorkspaceFs, notePath: string): Promise<boolean> {
  const sharer = readyCore().inkStrokesDirSharer(notePath);
  return sharer !== undefined && (await fs.stat(sharer)) !== null;
}

/** The title a renamed file's name gives: no folder, kind suffix or id suffix. */
export function titleFromFileName(path: string): string {
  return readyCore().folderTitleFromPath(path);
}

// --- folder-file-history ---
/** Earlier versions of one folder file: the commits that changed it, and its text at each. */
export interface FileHistorySource {
  log(path: string, limit: number): Promise<readonly WorkspaceCommit[]>;
  /** The file's text at `oid`; null when it is absent there, too big or not text. */
  readAt(oid: string, path: string): Promise<string | null>;
}

/** History read by the desktop shell, or null on a shell too old to have it. */
export function shellFileHistory(
  shell: Partial<Pick<DesktopBridge, "vaultFileLog" | "vaultReadAt">>,
): FileHistorySource | null {
  const { vaultFileLog, vaultReadAt } = shell;
  if (!vaultFileLog || !vaultReadAt) return null;
  return {
    log: (path, limit) => vaultFileLog.call(shell, path, limit),
    readAt: (oid, path) => vaultReadAt.call(shell, oid, path),
  };
}

/** History read by the renderer's own git (a browser folder). */
export function gitFileHistory(git: IWorkspaceGit): FileHistorySource {
  return {
    log: (path, limit) => git.log({ path, limit }),
    readAt: async (oid, path) => {
      const bytes = await git.readAt(oid, path);
      if (!bytes) return null;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return null;
      }
    },
  };
}
