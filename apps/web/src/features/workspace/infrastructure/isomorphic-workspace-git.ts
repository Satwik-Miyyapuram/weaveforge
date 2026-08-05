import type {
  GitAuthor,
  GitFileStatus,
  IWorkspaceFs,
  IWorkspaceGit,
  WorkspaceCommit,
} from "@thesis/core";
import { isomorphicFsFrom } from "./isomorphic-fs-adapter";

/**
 * Local git history over the workspace folder, via isomorphic-git.
 *
 * `isomorphic-git` is already a dependency (the Overleaf reader clones with it
 * server-side), so this adds a shim rather than a package.
 *
 * Local operations only — no clone, push, pull, or merge. Remotes need a CORS
 * proxy plus stored credentials, and merging needs a conflict UI; neither is
 * implied by wanting a history of your own folder.
 */
export class IsomorphicWorkspaceGit implements IWorkspaceGit {
  readonly kind = "isomorphic" as const;
  private readonly fs;
  private readonly dir = "/";

  constructor(workspaceFs: IWorkspaceFs) {
    this.fs = isomorphicFsFrom(workspaceFs);
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

  async status(): Promise<readonly GitFileStatus[]> {
    const git = await this.git();
    const rows = await git.statusMatrix({ fs: this.fs, dir: this.dir });
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
    const changes = await this.status();
    // Committing nothing produces an empty commit on every mirror pass, which
    // would make the history useless for seeing what actually changed.
    if (changes.length === 0) return null;

    const git = await this.git();
    for (const change of changes) {
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
    } catch {
      // No commits yet is the common case, not an error worth surfacing.
      return [];
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
