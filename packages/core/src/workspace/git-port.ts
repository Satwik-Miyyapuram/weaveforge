/**
 * Git operations for the workspace folder.
 *
 * Six methods, not the forty a full git UI needs. What this exists for is
 * "keep a history of my folder and let me look at it" — staging areas,
 * branching, rebasing, and conflict resolution are a different product.
 *
 * There is deliberately no clone, push, pull, or merge: in-browser remotes need
 * a CORS proxy plus stored credentials, and merge needs a resolution UI. Both
 * are separate decisions, not implied by wanting local history.
 */

export interface WorkspaceCommit {
  oid: string;
  message: string;
  authoredAt: string;
  author: string;
}

export interface GitFileStatus {
  path: string;
  state: "added" | "modified" | "deleted";
}

export interface GitAuthor {
  name: string;
  email: string;
}

export interface IWorkspaceGit {
  /** Which backend is in play, so the UI can say what history is available. */
  readonly kind: "none" | "isomorphic" | "native";
  isRepo(): Promise<boolean>;
  init(): Promise<void>;
  status(): Promise<readonly GitFileStatus[]>;
  /** Returns null when there was nothing to commit. */
  commitAll(message: string, author: GitAuthor): Promise<WorkspaceCommit | null>;
  log(options?: { path?: string; limit?: number }): Promise<readonly WorkspaceCommit[]>;
  /** File contents at a commit, or null when absent there. */
  readAt(oid: string, path: string): Promise<Uint8Array | null>;
}

/**
 * The default. Versioning is opt-in, and everything above it — mirroring,
 * export, import — has to work with git switched off, so "no git" is a real
 * implementation rather than a null check at every call site.
 */
export class NoOpWorkspaceGit implements IWorkspaceGit {
  readonly kind = "none" as const;

  async isRepo(): Promise<boolean> {
    return false;
  }

  async init(): Promise<void> {
    /* nothing to initialise */
  }

  async status(): Promise<readonly GitFileStatus[]> {
    return [];
  }

  async commitAll(): Promise<WorkspaceCommit | null> {
    return null;
  }

  async log(): Promise<readonly WorkspaceCommit[]> {
    return [];
  }

  async readAt(): Promise<Uint8Array | null> {
    return null;
  }
}

/** A commit message describing what changed, for the automatic mirror commits. */
export function describeChanges(status: readonly GitFileStatus[]): string {
  if (status.length === 0) return "No changes";
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const entry of status) counts[entry.state] += 1;

  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.modified) parts.push(`${counts.modified} changed`);
  if (counts.deleted) parts.push(`${counts.deleted} removed`);
  return parts.join(", ");
}
