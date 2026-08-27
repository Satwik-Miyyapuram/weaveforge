import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

import {
  decideVaultCommit,
  describeChanges,
  type GitAuthor,
  type GitFileStatus,
  type IWorkspaceGit,
  type VaultRepoState,
  type WorkspaceCommit,
} from "@weaveforge/core";

/**
 * Folder history, through the `git` already on the machine.
 *
 * No git library. A JavaScript implementation would be a megabyte in the
 * installer and a second opinion about a repository format the user's own
 * tools already read — and this exists so their tools can read the history,
 * not so ours can.
 *
 * Every call is scoped with `-C root`, so a repository discovered above the
 * folder is never the one being written to by accident. Whether it may be
 * written to at all is `decideVaultCommit`'s answer, not this file's.
 */

const run = promisify(execFile);

/** Long enough for a large first commit, short enough to not hang a mirror. */
const TIMEOUT_MS = 30_000;

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", root, ...args], {
    timeout: TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/**
 * Whether this folder is a repository, sits inside one, or neither.
 *
 * The distinction between "own" and "enclosing" is the whole point: git itself
 * answers "are you in a repository" by walking upwards, and taking that as a
 * yes is how a mirror ends up committing into a thesis repo three levels up.
 */
export async function probeRepo(root: string): Promise<VaultRepoState> {
  let top: string;
  try {
    top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    // Not a repository, or no git installed. Both mean there is nothing here
    // whose history we would be writing into.
    return { kind: "none" };
  }
  if (!top) return { kind: "none" };
  return path.resolve(top) === path.resolve(root) ? { kind: "own" } : { kind: "enclosing", root: top };
}

/** Porcelain v1 status letters, reduced to the three states we report. */
function parseStatus(stdout: string): GitFileStatus[] {
  const out: GitFileStatus[] = [];
  for (const line of stdout.split("\0")) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3);
    const state = code.includes("D") ? "deleted" : code.includes("?") || code.includes("A") ? "added" : "modified";
    out.push({ path: file, state });
  }
  return out;
}

function parseLog(stdout: string): WorkspaceCommit[] {
  const out: WorkspaceCommit[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [oid, authoredAt, author, ...rest] = line.split("\x1f");
    if (!oid || !authoredAt || author === undefined) continue;
    out.push({ oid, authoredAt, author, message: rest.join("\x1f") });
  }
  return out;
}

export class NativeWorkspaceGit implements IWorkspaceGit {
  readonly kind = "native" as const;

  constructor(private readonly root: string) {}

  async isRepo(): Promise<boolean> {
    return (await probeRepo(this.root)).kind === "own";
  }

  async init(): Promise<void> {
    await git(this.root, ["init"]);
  }

  async status(): Promise<readonly GitFileStatus[]> {
    return parseStatus(await git(this.root, ["status", "--porcelain", "-z", "--untracked-files=all"]));
  }

  async commitAll(message: string, author: GitAuthor): Promise<WorkspaceCommit | null> {
    await git(this.root, ["add", "-A"]);
    const staged = await this.status();
    if (staged.length === 0) return null;
    // The author is passed per-commit rather than configured, so nothing here
    // writes to the user's global git config.
    await git(this.root, [
      "-c",
      `user.name=${author.name}`,
      "-c",
      `user.email=${author.email}`,
      "commit",
      "--no-verify",
      "-m",
      message,
    ]);
    const [head] = await this.log({ limit: 1 });
    return head ?? null;
  }

  async log(options: { path?: string; limit?: number } = {}): Promise<readonly WorkspaceCommit[]> {
    const args = ["log", `--format=%H%x1f%aI%x1f%an%x1f%s`];
    if (options.limit) args.push(`-n${options.limit}`);
    if (options.path) args.push("--", options.path);
    try {
      return parseLog(await git(this.root, args));
    } catch {
      // A repository with no commits yet has no log, which is not a failure.
      return [];
    }
  }

  async readAt(oid: string, file: string): Promise<Uint8Array | null> {
    try {
      const { stdout } = await run("git", ["-C", this.root, "show", `${oid}:${file}`], {
        timeout: TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "buffer",
        windowsHide: true,
      });
      return new Uint8Array(stdout);
    } catch {
      return null;
    }
  }
}

/** Who the automatic commits are by. Not the user: they did not write them. */
const MIRROR_AUTHOR: GitAuthor = { name: "WeaveForge", email: "mirror@weaveforge.local" };

/**
 * Commit whatever the mirror just wrote, if it is allowed to.
 *
 * Returns what happened rather than throwing. A folder that cannot be
 * committed to still holds the files, and failing a mirror run over its
 * history would cost the user the write to keep the record of the write.
 */
export async function commitVault(
  root: string,
  enabled: boolean,
  repo: IWorkspaceGit = new NativeWorkspaceGit(root),
  probe: (root: string) => Promise<VaultRepoState> = probeRepo,
): Promise<{ committed: WorkspaceCommit | null; reason?: string }> {
  const verdict = decideVaultCommit(enabled, await probe(root));
  if (!verdict.ok) return { committed: null, reason: verdict.reason };

  try {
    if (verdict.action === "init") await repo.init();
    const status = await repo.status();
    if (status.length === 0) return { committed: null };
    return { committed: await repo.commitAll(describeChanges(status), MIRROR_AUTHOR) };
  } catch (error) {
    return { committed: null, reason: error instanceof Error ? error.message : "Could not commit." };
  }
}
