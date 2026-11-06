import type { IWorkspaceGit, WorkspaceCommit } from "@weaveforge/core";

import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";

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
