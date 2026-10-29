import { execFile, spawn } from "node:child_process";
import { appendFile, lstat, mkdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import {
  errorMessage,
  decideVaultCommit,
  describeChanges,
  keptOutOfHistory,
  MAX_COMMIT_FILE_BYTES,
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

/**
 * A git killed by TIMEOUT_MS can leave `index.lock` behind, and every later add fails on it. A lock this old
 * is not a git still running: the commit failure names it, so the user can delete it.
 */
const STALE_LOCK_MS = 5 * 60_000;

/**
 * `git commit` runs auto gc itself, and on Windows git cannot detach it: it would run inside the commit's
 * 30-second bound and get killed there. So the commit runs with it off and `packLoose` packs instead.
 */
const NO_AUTO_GC = ["-c", "maintenance.auto=false", "-c", "gc.auto=0"];

// Paper paths pass 260 chars on Windows; without longpaths `add -A` skips or refuses them.
// `gc.pruneExpire=never`: any gc started through here, the vault's own or one git starts itself,
// would otherwise prune unreachable objects older than two weeks.
const FLAGS = ["-c", "core.longpaths=true", "-c", "core.autocrlf=false", "-c", "gc.pruneExpire=never"];

/**
 * Bounds for the background pack. Unbounded, git sizes its delta window and cache by the history and
 * uses every core, so a first pack of a large vault can take gigabytes and stall the machine.
 */
const PACK_LIMITS = ["-c", "pack.windowMemory=256m", "-c", "pack.deltaCacheSize=128m", "-c", "pack.threads=2"];

/** This machine's database, cache and lock under the folder root; never history. */
const LOCAL_ONLY = "/.weaveforge/";

/** `input` goes to git's stdin, for path lists too long for a command line. */
async function git(root: string, args: readonly string[], input?: string): Promise<string> {
  const pending = run("git", [...FLAGS, "-C", root, ...args], {
    timeout: TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (input !== undefined) pending.child.stdin?.end(input);
  return (await pending).stdout;
}

/** Bytes on disk, or null when the file is gone. A symlink counts as itself, as git stores it. */
async function sizeOf(file: string): Promise<number | null> {
  return lstat(file).then(
    (stats) => stats.size,
    () => null,
  );
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
  const records = stdout.split("\0");
  for (let i = 0; i < records.length; i++) {
    const line = records[i]!;
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3);
    // A rename or copy is followed by a second record: the original path.
    if (code.includes("R") || code.includes("C")) i++;
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

  constructor(
    private readonly root: string,
    private readonly maxFileBytes: number = MAX_COMMIT_FILE_BYTES,
  ) {}

  async isRepo(): Promise<boolean> {
    return (await probeRepo(this.root)).kind === "own";
  }

  async init(): Promise<void> {
    await git(this.root, ["init"]);
  }

  async status(): Promise<readonly GitFileStatus[]> {
    return (await this.changes()).committable;
  }

  /**
   * Every change, split into what the history takes and the files over the size cap it leaves out.
   * Root `.weaveforge/` is never committed, so it is in neither: it is not a change to describe.
   */
  private async changes(): Promise<{ committable: GitFileStatus[]; tooLarge: string[] }> {
    const all = parseStatus(await git(this.root, ["status", "--porcelain", "-z", "--untracked-files=all"]));
    const verdicts = await Promise.all(
      all.map(async (entry) => {
        const bytes = entry.state === "deleted" ? null : await sizeOf(path.join(this.root, entry.path));
        return keptOutOfHistory(entry.path, bytes, this.maxFileBytes);
      }),
    );
    return {
      committable: all.filter((_, i) => verdicts[i] === null),
      tooLarge: all.filter((_, i) => verdicts[i] === "too-large").map((entry) => entry.path),
    };
  }

  async commitAll(message: string, author: GitAuthor): Promise<WorkspaceCommit | null> {
    try {
      return await this.commitChanges(message, author);
    } catch (error) {
      throw await this.withStaleLock(error);
    }
  }

  private async commitChanges(message: string, author: GitAuthor): Promise<WorkspaceCommit | null> {
    await this.excludeLocalOnly();
    // A file over the cap is never added, so not even a loose copy of it lands in the object store.
    // A file that grows past the cap between this size check and the add still goes in: rare, and accepted.
    const { tooLarge } = await this.changes();
    if (tooLarge.length > 0) {
      const cap = Math.round(this.maxFileBytes / (1024 * 1024));
      console.warn(`[vault-git] left out of the history, over ${cap} MB: ${tooLarge.join(", ").slice(0, 300)}`);
    }
    const pathspecs = [".", ...tooLarge.map((file) => `:(exclude,literal)${file}`)];
    await git(this.root, ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], `${pathspecs.join("\0")}\0`);
    // One staged earlier (by an add killed before its commit, or by the user) is still in the index: back to HEAD.
    if (tooLarge.length > 0) {
      const literal = tooLarge.map((file) => `:(literal)${file}\0`).join("");
      await git(this.root, ["reset", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"], literal);
    }
    // The status still lists skipped files, so only the index says whether anything is left to commit.
    if (!(await git(this.root, ["diff", "--cached", "--name-only", "-z"]))) return null;
    // The author is passed per-commit rather than configured, so nothing here
    // writes to the user's global git config.
    await git(this.root, [
      "-c",
      `user.name=${author.name}`,
      "-c",
      `user.email=${author.email}`,
      ...NO_AUTO_GC,
      "commit",
      "--no-verify",
      "-m",
      message,
    ]);
    this.packLoose();
    const [head] = await this.log({ limit: 1 });
    return head ?? null;
  }

  /**
   * Packs loose objects once they pile up, as `git commit` would, but never with `--prune`: an object
   * nothing references any more is kept. A first pack of a big history takes minutes, so it runs as its
   * own detached process with no time bound; `gc.pid` keeps a second one from starting meanwhile.
   * Best effort: a failed pack only goes in the log.
   */
  private packLoose(): void {
    const child = spawn("git", [...FLAGS, ...PACK_LIMITS, "-C", this.root, "gc", "--auto", "--no-prune", "--quiet"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (error) => console.warn(`[vault-git] could not pack the history: ${errorMessage(error, "")}`));
    child.on("exit", (code) => {
      if (code) console.warn(`[vault-git] could not pack the history: git gc exited with ${code}`);
    });
    child.unref();
  }

  /** The error, or one naming a stale `index.lock` when that is what blocks git. The lock is never deleted. */
  private async withStaleLock(error: unknown): Promise<unknown> {
    try {
      const lock = path.resolve(this.root, (await git(this.root, ["rev-parse", "--git-path", "index.lock"])).trim());
      const age = Date.now() - (await stat(lock)).mtimeMs;
      if (age < STALE_LOCK_MS) return error;
      const minutes = Math.round(age / 60_000);
      return new Error(
        `A stale ${lock}, left ${minutes} min ago by a git that was stopped, blocks every commit. ` +
          `Quit WeaveForge, check no git is running, then delete it. (${gitReason(error)})`,
      );
    } catch {
      return error;
    }
  }

  /** Kept out through `info/exclude`, so no file of the user's is written; untracked if an older run added it. */
  private async excludeLocalOnly(): Promise<void> {
    const file = path.resolve(this.root, (await git(this.root, ["rev-parse", "--git-path", "info/exclude"])).trim());
    const current = await readFile(file, "utf8").catch(() => "");
    if (!current.split(/\r?\n/).includes(LOCAL_ONLY)) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${current && !current.endsWith("\n") ? "\n" : ""}${LOCAL_ONLY}\n`);
    }
    await git(this.root, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ".weaveforge"]);
  }

  async log(options: { path?: string; limit?: number } = {}): Promise<readonly WorkspaceCommit[]> {
    const args = ["log", `--format=%H%x1f%aI%x1f%an%x1f%s`];
    if (options.limit) args.push(`-n${options.limit}`);
    if (options.path) args.push("--", options.path);
    try {
      return parseLog(await git(this.root, args));
    } catch (error) {
      // A repository with no commits yet has no log, which is not a failure.
      // Anything else still reads as an empty history, but goes in the log.
      const reason = gitReason(error);
      if (!/does not have any commits yet/.test(reason)) {
        console.warn(`[vault-git] could not read the history: ${reason.slice(0, 300)}`);
      }
      return [];
    }
  }

  async readAt(oid: string, file: string): Promise<Uint8Array | null> {
    try {
      const { stdout } = await run("git", [...FLAGS, "-C", this.root, "show", `${oid}:${file}`], {
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

/** The folder's own history; an enclosing repository's is somebody else's and is not read. */
export async function vaultLog(
  root: string,
  limit: number,
  repo: IWorkspaceGit = new NativeWorkspaceGit(root),
  probe: (root: string) => Promise<VaultRepoState> = probeRepo,
): Promise<readonly WorkspaceCommit[]> {
  if ((await probe(root)).kind !== "own") return [];
  return repo.log({ limit });
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
  // Off means no git at all: starting one costs seconds of main-thread time on Windows.
  const verdict = decideVaultCommit(enabled, enabled ? await probe(root) : { kind: "none" });
  if (!verdict.ok) return { committed: null, reason: verdict.reason };

  try {
    if (verdict.action === "init") await repo.init();
    const status = await repo.status();
    if (status.length === 0) return { committed: null };
    return { committed: await repo.commitAll(describeChanges(status), MIRROR_AUTHOR) };
  } catch (error) {
    return { committed: null, reason: gitReason(error) };
  }
}

/** Git's own error lines, not the command echo and per-file warnings around them. */
export function gitReason(error: unknown): string {
  const text = errorMessage(error, "");
  const lines = text.split(/\r?\n/).filter((line) => /^(fatal|error):/.test(line));
  return lines.length > 0 ? lines.join(" ") : text.split(/\r?\n/)[0] || "Could not commit.";
}
