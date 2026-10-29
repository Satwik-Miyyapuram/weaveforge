import {
  decideGitSyncPath,
  GIT_SYNC_LIMITS,
  isUnderIgnoredFolder,
  type GitAuthor,
  type GitFileStatus,
  type IWorkspaceFs,
  type IWorkspaceGit,
  type WorkspaceCommit,
} from "@weaveforge/core";
import { isomorphicFsFrom } from "./isomorphic-fs-adapter";

export interface IsomorphicWorkspaceGitOptions {
  /** Overrides the size cap; tests use it to avoid 25 MB fixtures. */
  maxFileBytes?: number;
}

/**
 * Local git history over the workspace folder, via isomorphic-git.
 *
 * `isomorphic-git` is already a dependency (the Overleaf reader clones with it
 * server-side), so this adds a shim rather than a package.
 *
 * Local operations only — no clone, push, pull, or merge. Remotes from a
 * browser need a CORS proxy plus stored credentials; remote sync is the desktop
 * shell's (`IWorkspaceGitRemote` in `apps/desktop/src/vault-git.ts`).
 *
 * Commit scope: `git.commit` commits whatever the index holds, so every commit
 * first brings the index back in line with the sync policy. Entries the policy
 * excludes are reset to HEAD (or removed when HEAD has none), whether an older
 * run or a failed commit left them staged.
 */
export class IsomorphicWorkspaceGit implements IWorkspaceGit {
  readonly kind = "isomorphic" as const;
  private readonly fs;
  private readonly workspace: IWorkspaceFs;
  private readonly dir = "/";
  private readonly maxFileBytes: number;

  constructor(workspaceFs: IWorkspaceFs, options: IsomorphicWorkspaceGitOptions = {}) {
    this.workspace = workspaceFs;
    this.fs = isomorphicFsFrom(workspaceFs);
    this.maxFileBytes = options.maxFileBytes ?? GIT_SYNC_LIMITS.maxFileBytes;
  }

  /** Loaded on demand so no git bytes reach the bundle until versioning is on. */
  private async git() {
    return import("isomorphic-git");
  }

  async isRepo(): Promise<boolean> {
    try {
      const git = await this.git();
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD", depth: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    const git = await this.git();
    await git.init({ fs: this.fs, dir: this.dir, defaultBranch: "main" });
  }

  /**
   * Files in folders the sync policy ignores (node_modules and the like) do
   * not appear here. isomorphic-git still walks those folders; the filter only
   * keeps them out of the result.
   */
  async status(): Promise<readonly GitFileStatus[]> {
    const git = await this.git();
    const rows = await git.statusMatrix({
      fs: this.fs,
      dir: this.dir,
      filter: (path) => !isUnderIgnoredFolder(path),
    });
    const out: GitFileStatus[] = [];
    // Row shape is [path, head, workdir, stage]: 0 means absent, 1 unchanged,
    // 2 modified.
    for (const [path, head, workdir] of rows) {
      if (head === 0 && workdir > 0) out.push({ path: String(path), state: "added" });
      else if (head > 0 && workdir === 0) out.push({ path: String(path), state: "deleted" });
      else if (head > 0 && workdir === 2) out.push({ path: String(path), state: "modified" });
    }
    return out;
  }

  async commitAll(message: string, author: GitAuthor): Promise<WorkspaceCommit | null> {
    const git = await this.git();
    const { kept, skipped } = await this.classify(await this.status());
    if (skipped.length > 0) {
      console.warn(`[git-sync] ${skipped.length} changed file(s) not committed (size cap or ignored)`);
    }
    await this.unstageOutOfScope(new Set(kept.map((change) => change.path)), new Set(skipped));

    // Committing nothing produces an empty commit on every mirror pass, which
    // would make the history useless for seeing what actually changed.
    if (kept.length === 0) return null;

    for (const change of kept) {
      if (change.state === "deleted") {
        await git.remove({ fs: this.fs, dir: this.dir, filepath: change.path });
      } else {
        await git.add({ fs: this.fs, dir: this.dir, filepath: change.path });
      }
    }

    const oid = await git.commit({
      fs: this.fs,
      dir: this.dir,
      message,
      author: { name: author.name, email: author.email },
    });

    return {
      oid,
      message,
      authoredAt: new Date().toISOString(),
      author: author.name,
    };
  }

  /** Splits changes into what is committed and the paths the policy keeps out. */
  private async classify(changes: readonly GitFileStatus[]): Promise<{ kept: GitFileStatus[]; skipped: string[] }> {
    const kept: GitFileStatus[] = [];
    const skipped: string[] = [];
    for (const change of changes) {
      const size = change.state === "deleted" ? 0 : ((await this.workspace.stat(change.path))?.size ?? 0);
      if (decideGitSyncPath(change.path, size, this.maxFileBytes).include) kept.push(change);
      else skipped.push(change.path);
    }
    return { kept, skipped };
  }

  /**
   * Resets index entries that the commit must not carry. Only entries the
   * policy excludes by name or folder, or that were just skipped for size, are
   * checked, so a large tracked history is not rehashed on every pass.
   */
  private async unstageOutOfScope(keptPaths: ReadonlySet<string>, skippedPaths: ReadonlySet<string>): Promise<void> {
    const git = await this.git();
    const indexed: string[] = await git.listFiles({ fs: this.fs, dir: this.dir });
    const strays = indexed.filter(
      (path) =>
        !keptPaths.has(path) &&
        (skippedPaths.has(path) || !decideGitSyncPath(path, 0, this.maxFileBytes).include),
    );
    if (strays.length === 0) return;

    const rows = await git.statusMatrix({ fs: this.fs, dir: this.dir, filepaths: strays });
    // stage differs from head when the index holds something other than HEAD.
    for (const [path, head, , stage] of rows) {
      if (stage === head) continue;
      if (head === 0) {
        await git.remove({ fs: this.fs, dir: this.dir, filepath: String(path) });
      } else {
        await git.resetIndex({ fs: this.fs, dir: this.dir, filepath: String(path), ref: "HEAD" });
      }
    }
  }

  async log(options: { path?: string; limit?: number } = {}): Promise<readonly WorkspaceCommit[]> {
    try {
      const git = await this.git();
      const entries = await git.log({
        fs: this.fs,
        dir: this.dir,
        depth: options.limit ?? 50,
        filepath: options.path,
      });
      return entries.map((entry) => ({
        oid: entry.oid,
        message: entry.commit.message.trim(),
        authoredAt: new Date(entry.commit.author.timestamp * 1000).toISOString(),
        author: entry.commit.author.name,
      }));
    } catch (err) {
      // No commits yet is the common case, not an error worth surfacing. Any
      // other failure is a damaged repo, and an empty history would hide it.
      if (await this.hasNoCommits()) return [];
      throw err;
    }
  }

  /** True when HEAD resolves to nothing: a repo that was never committed to. */
  private async hasNoCommits(): Promise<boolean> {
    try {
      const git = await this.git();
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" });
      return false;
    } catch (err) {
      return (err as { code?: string }).code === "NotFoundError";
    }
  }

  async readAt(oid: string, path: string): Promise<Uint8Array | null> {
    try {
      const git = await this.git();
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: this.dir,
        oid,
        filepath: path,
      });
      return blob;
    } catch {
      return null;
    }
  }
}
