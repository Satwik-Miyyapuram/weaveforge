import { execFile } from "node:child_process";
import { appendFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import {
  checkGitRemoteUrl,
  errorMessage,
  decideGitSyncPath,
  decideVaultCommit,
  DEFAULT_SYNC_BRANCH,
  describeChanges,
  GIT_SYNC_IGNORED_DIRS,
  GIT_SYNC_IGNORED_EXTENSIONS,
  GIT_SYNC_IGNORED_FILES,
  GIT_SYNC_LIMITS,
  redactSecret,
  SYNC_AUTHOR,
  type GitAuthor,
  type GitFileStatus,
  type GitPullResult,
  type GitPushResult,
  type GitRemoteConfig,
  type GitRemoteStatus,
  type IWorkspaceGit,
  type IWorkspaceGitRemote,
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

// Paper paths pass 260 chars on Windows; without longpaths `add -A` skips or refuses them.
const FLAGS = ["-c", "core.longpaths=true", "-c", "core.autocrlf=false"];

/** This machine's database, cache and lock under the folder root; never history. */
const LOCAL_ONLY = "/.weaveforge/";

/** Network calls get longer: a first push of a thesis folder is many megabytes. */
const REMOTE_TIMEOUT_MS = 300_000;

async function git(
  root: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<string> {
  const { stdout } = await run("git", [...FLAGS, "-C", root, ...args], {
    timeout: options.timeout ?? TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: options.env,
  });
  return stdout;
}

/** True when the command exits 0; for git's yes/no plumbing (`is-ancestor`, `rev-parse --verify`). */
async function gitTest(root: string, args: readonly string[]): Promise<boolean> {
  try {
    await git(root, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Patterns kept out through `info/exclude`, so no file of the user's is
 * written: this machine's root `.weaveforge/`, then the sync policy's ignore
 * list. Git applies these before anything is staged, so `node_modules` is not
 * even hashed. `decideGitSyncPath` still checks every staged path after,
 * because exclude patterns are case-sensitive on some systems and know
 * nothing of size.
 */
const EXCLUDES: readonly string[] = [
  LOCAL_ONLY,
  ...GIT_SYNC_IGNORED_DIRS.map((dir) => `${dir}/`),
  ...GIT_SYNC_IGNORED_FILES,
  ...GIT_SYNC_IGNORED_EXTENSIONS.map((ext) => `*${ext}`),
];

/** The remote's name in the folder's repo; the user's own `origin` is never rewritten. */
export const SYNC_REMOTE = "weaveforge";

const PULL_FIRST = "The remote has changes this folder does not. Pull first.";

/**
 * A git failure whose text is safe to show: the token is removed from it.
 * `detail` is git's full error output, also redacted, for telling outcomes apart.
 */
class GitRemoteError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

/** Git's stderr when it is there (it is where git explains itself), else the message. */
function gitOutput(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  return typeof stderr === "string" && stderr ? stderr : errorMessage(error, "");
}

function basicAuth(token: string): string {
  // GitHub, GitLab and Gitea all take a token as the password, with any user name.
  return Buffer.from(`x-access-token:${token}`).toString("base64");
}

/** Removes the token, and the header form it is sent in, from git's text. */
export function redactAuth(text: string, token: string | undefined): string {
  return token ? redactSecret(redactSecret(text, token), basicAuth(token)) : text;
}

/**
 * The token goes in as an HTTP header through git's environment config
 * (git 2.31+), never on the command line (other processes can read that) and
 * never in `.git/config`. With a token, the credential helper is switched off
 * so a wrong token fails here instead of opening a sign-in window. The header
 * is scoped to the remote's own origin (`http.<origin>/.extraHeader`), so a
 * redirect or submodule on another host never receives it; a remote that is
 * not http(s) gets no header.
 */
export function remoteAuth(remote: GitRemoteConfig): { flags: string[]; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const origin = httpOrigin(remote.url);
  if (!remote.token || !origin) return { flags: [], env };
  return {
    flags: ["-c", "credential.helper="],
    env: {
      ...env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.${origin}/.extraHeader`,
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicAuth(remote.token)}`,
    },
  };
}

function httpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

async function gitRemote(root: string, remote: GitRemoteConfig, args: readonly string[]): Promise<string> {
  const { flags, env } = remoteAuth(remote);
  try {
    return await git(root, [...flags, ...args], { env, timeout: REMOTE_TIMEOUT_MS });
  } catch (error) {
    throw new GitRemoteError(redactAuth(gitReason(error), remote.token), redactAuth(gitOutput(error), remote.token));
  }
}

/** Paths git lists under a "would be overwritten" line, each indented by a tab. */
function overwrittenFiles(output: string): string[] {
  const files: string[] = [];
  let listing = false;
  for (const line of output.split(/\r?\n/)) {
    if (/would be overwritten/.test(line)) listing = true;
    else if (listing && line.startsWith("\t")) files.push(line.trim());
    else listing = false;
  }
  return files;
}

function nulList(stdout: string): string[] {
  return stdout.split("\0").filter(Boolean);
}

/** Batches of paths for one command line each; Windows caps a command line near 32k characters. */
function chunks(paths: readonly string[], maxChars = 8000): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of paths) {
    if (current.length > 0 && size + p.length > maxChars) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.length + 1;
  }
  if (current.length > 0) out.push(current);
  return out;
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

export class NativeWorkspaceGit implements IWorkspaceGit, IWorkspaceGitRemote {
  readonly kind = "native" as const;
  private readonly maxFileBytes: number;

  constructor(
    private readonly root: string,
    options: { maxFileBytes?: number } = {},
  ) {
    this.maxFileBytes = options.maxFileBytes ?? GIT_SYNC_LIMITS.maxFileBytes;
  }

  async isRepo(): Promise<boolean> {
    return (await probeRepo(this.root)).kind === "own";
  }

  async init(): Promise<void> {
    await git(this.root, ["init"]);
  }

  async status(): Promise<readonly GitFileStatus[]> {
    // Root `.weaveforge/` is never committed, so it is not a change to describe.
    return parseStatus(await git(this.root, ["status", "--porcelain", "-z", "--untracked-files=all"])).filter(
      (entry) => !`/${entry.path}`.startsWith(LOCAL_ONLY),
    );
  }

  async commitAll(message: string, author: GitAuthor): Promise<WorkspaceCommit | null> {
    await this.writeExcludes();
    await this.addInPolicy();
    await this.unstageOutOfPolicy();
    // What is staged decides, not the status: an over-size file stays untracked and in the status.
    if ((await git(this.root, ["diff", "--cached", "--name-only", "-z"])) === "") return null;
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

  /** `EXCLUDES` into `info/exclude`, each once; root `.weaveforge` untracked if an older run added it. */
  private async writeExcludes(): Promise<void> {
    const file = path.resolve(this.root, (await git(this.root, ["rev-parse", "--git-path", "info/exclude"])).trim());
    const current = await readFile(file, "utf8").catch(() => "");
    const present = new Set(current.split(/\r?\n/));
    const missing = EXCLUDES.filter((pattern) => !present.has(pattern));
    if (missing.length > 0) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
    }
    await git(this.root, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ".weaveforge"]);
  }

  /**
   * `git add -A` minus the files the sync policy refuses (over the size cap,
   * or in an ignored folder the exclude patterns missed), so they are never
   * hashed into the object store. Candidates are what git would add: untracked
   * and modified files. The pathspecs go through a file, not the command line,
   * so any number of them fits.
   */
  private async addInPolicy(): Promise<void> {
    const candidates = nulList(
      await git(this.root, ["ls-files", "-z", "--others", "--modified", "--exclude-standard"]),
    );
    const refused: string[] = [];
    for (const file of candidates) {
      const size = await lstat(path.join(this.root, file)).then(
        (stats) => stats.size,
        () => null,
      );
      // Gone from disk: a deletion, which always goes through.
      if (size === null) continue;
      if (!decideGitSyncPath(file, size, this.maxFileBytes).include) refused.push(file);
    }
    if (refused.length === 0) {
      await git(this.root, ["add", "-A"]);
      return;
    }
    const list = path.resolve(
      this.root,
      (await git(this.root, ["rev-parse", "--git-path", "weaveforge-add-pathspec"])).trim(),
    );
    await writeFile(list, [".", ...refused.map((file) => `:(exclude,literal)${file}`)].join("\0") + "\0");
    try {
      await git(this.root, ["add", "-A", `--pathspec-from-file=${list}`, "--pathspec-file-nul"]);
    } finally {
      await rm(list, { force: true });
    }
  }

  /**
   * The backstop after `addInPolicy`: takes back out of the index what the sync policy refuses: a path in an
   * ignored folder the exclude patterns missed, or a file over the size cap.
   * A new file is unstaged; a tracked one keeps its last committed version.
   * Deletions always go through, so an over-size file can leave history's
   * future commits.
   */
  private async unstageOutOfPolicy(): Promise<void> {
    const records = nulList(await git(this.root, ["diff", "--cached", "--name-status", "--no-renames", "-z"]));
    const added: string[] = [];
    const modified: string[] = [];
    for (let i = 0; i + 1 < records.length; i += 2) {
      const code = records[i]!;
      const file = records[i + 1]!;
      if (code === "D") continue;
      const size = await lstat(path.join(this.root, file)).then(
        (stats) => stats.size,
        () => Number.NaN,
      );
      if (decideGitSyncPath(file, size, this.maxFileBytes).include) continue;
      (code === "A" ? added : modified).push(file);
    }
    for (const batch of chunks(added)) await git(this.root, ["rm", "--cached", "-q", "--", ...batch]);
    for (const batch of chunks(modified)) await git(this.root, ["reset", "-q", "--", ...batch]);
  }

  // ---- Remote sync ---------------------------------------------------------

  async connect(remote: GitRemoteConfig): Promise<GitRemoteStatus> {
    await this.prepareRemote(remote);
    return this.remoteStatus(remote);
  }

  async remoteStatus(remote: GitRemoteConfig): Promise<GitRemoteStatus> {
    const branch = DEFAULT_SYNC_BRANCH;
    if (!(await this.isRepo())) return { url: null, branch, ahead: 0, behind: 0 };
    await this.prepareRemote(remote);
    const theirs = await this.fetch(remote);
    const head = await this.hasHead();
    const count = async (range: string) => Number((await git(this.root, ["rev-list", "--count", range])).trim());
    if (!theirs) return { url: remote.url, branch, ahead: head ? await count("HEAD") : 0, behind: 0 };
    if (!head) return { url: remote.url, branch, ahead: 0, behind: await count(theirs) };
    const [ahead, behind] = (await git(this.root, ["rev-list", "--left-right", "--count", `HEAD...${theirs}`]))
      .trim()
      .split(/\s+/)
      .map(Number);
    return { url: remote.url, branch, ahead: ahead ?? 0, behind: behind ?? 0 };
  }

  async pull(remote: GitRemoteConfig, author: GitAuthor): Promise<GitPullResult> {
    await this.prepareRemote(remote);
    await this.commitPending(author);
    const theirs = await this.fetch(remote);
    if (!theirs) return { kind: "up-to-date" };
    const head = await this.hasHead();
    if (head && (await gitTest(this.root, ["merge-base", "--is-ancestor", theirs, "HEAD"]))) {
      return { kind: "up-to-date" };
    }

    // Git overwrites an ignored file without asking; a file kept out of history is still the user's.
    const incoming = nulList(
      head
        ? await git(this.root, ["diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", "HEAD", theirs])
        : await git(this.root, ["ls-tree", "-r", "--name-only", "-z", theirs]),
    );
    const collisions: string[] = [];
    for (const file of incoming) {
      if (await lstat(path.join(this.root, file)).then(() => true, () => false)) collisions.push(file);
    }
    if (collisions.length > 0) return { kind: "conflict", files: collisions };

    const fastForward = !head || (await gitTest(this.root, ["merge-base", "--is-ancestor", "HEAD", theirs]));
    try {
      await git(this.root, [
        "-c",
        `user.name=${author.name}`,
        "-c",
        `user.email=${author.email}`,
        "merge",
        "--no-verify",
        "--no-edit",
        "--allow-unrelated-histories",
        fastForward ? "--ff-only" : "--no-ff",
        "-m",
        `Merge ${DEFAULT_SYNC_BRANCH} from the remote`,
        theirs,
      ]);
    } catch (error) {
      const unmerged = nulList(await git(this.root, ["diff", "--name-only", "--diff-filter=U", "-z"]).catch(() => ""));
      if (unmerged.length > 0) {
        await git(this.root, ["merge", "--abort"]);
        return { kind: "conflict", files: unmerged };
      }
      const blocked = overwrittenFiles(gitOutput(error));
      if (blocked.length > 0) return { kind: "conflict", files: blocked };
      throw new Error(gitReason(error));
    }
    const oid = (await git(this.root, ["rev-parse", "HEAD"])).trim();
    return fastForward ? { kind: "fast-forward", oid } : { kind: "merged", oid };
  }

  async push(remote: GitRemoteConfig, author: GitAuthor): Promise<GitPushResult> {
    await this.prepareRemote(remote);
    await this.commitPending(author);
    if (!(await this.hasHead())) return { kind: "up-to-date" };
    const theirs = await this.fetch(remote);
    if (theirs) {
      if (await gitTest(this.root, ["merge-base", "--is-ancestor", "HEAD", theirs])) return { kind: "up-to-date" };
      if (!(await gitTest(this.root, ["merge-base", "--is-ancestor", theirs, "HEAD"]))) {
        return { kind: "rejected", reason: PULL_FIRST };
      }
    }
    try {
      // No `--force` of any kind: a remote that moved since the fetch refuses, and that is reported.
      await gitRemote(this.root, remote, [
        "push",
        "--no-verify",
        SYNC_REMOTE,
        `HEAD:refs/heads/${DEFAULT_SYNC_BRANCH}`,
      ]);
    } catch (error) {
      if (error instanceof GitRemoteError && /\[rejected\]|non-fast-forward|fetch first/.test(error.detail)) {
        return { kind: "rejected", reason: PULL_FIRST };
      }
      throw error;
    }
    return { kind: "pushed" };
  }

  /** A repo with the excludes in place and `SYNC_REMOTE` pointing at the URL. */
  private async prepareRemote(remote: GitRemoteConfig): Promise<void> {
    if (!(await this.isRepo())) {
      await this.init();
      // On an empty repo this only names the first branch; git before 2.28 has no `init -b`.
      await git(this.root, ["symbolic-ref", "HEAD", `refs/heads/${DEFAULT_SYNC_BRANCH}`]);
    }
    await this.writeExcludes();
    const current = await git(this.root, ["remote", "get-url", SYNC_REMOTE]).then(
      (url) => url.trim(),
      () => null,
    );
    if (current === null) await git(this.root, ["remote", "add", SYNC_REMOTE, remote.url]);
    else if (current !== remote.url) await git(this.root, ["remote", "set-url", SYNC_REMOTE, remote.url]);
  }

  /** The remote-tracking ref after a fetch, or null when the remote has no such branch yet. */
  private async fetch(remote: GitRemoteConfig): Promise<string | null> {
    const branch = DEFAULT_SYNC_BRANCH;
    const tracking = `refs/remotes/${SYNC_REMOTE}/${branch}`;
    try {
      await gitRemote(this.root, remote, ["fetch", "--no-tags", SYNC_REMOTE, `+refs/heads/${branch}:${tracking}`]);
    } catch (error) {
      if (error instanceof GitRemoteError && /couldn't find remote ref/i.test(error.detail)) return null;
      throw error;
    }
    return tracking;
  }

  private async hasHead(): Promise<boolean> {
    return gitTest(this.root, ["rev-parse", "--verify", "-q", "HEAD"]);
  }

  /** Local edits go into history before anything from the remote touches the folder. */
  private async commitPending(author: GitAuthor): Promise<void> {
    const status = await this.status();
    if (status.length > 0) await this.commitAll(describeChanges(status), author);
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
    return await serial(async () => {
      if (verdict.action === "init") await repo.init();
      const status = await repo.status();
      if (status.length === 0) return { committed: null };
      return { committed: await repo.commitAll(describeChanges(status), MIRROR_AUTHOR) };
    });
  } catch (error) {
    return { committed: null, reason: gitReason(error) };
  }
}

/**
 * One git operation per process at a time: a pull and a mirror commit started
 * together would otherwise trip over each other's `index.lock`.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export const VAULT_SYNC_ACTIONS = ["settings", "status", "connect", "pull", "push"] as const;
export type VaultSyncAction = (typeof VAULT_SYNC_ACTIONS)[number];

/** What the shell holds for the remote; read from its stores by the caller, never sent by the page. */
export interface VaultSyncSettings {
  /** Folder history (`vault-git`); syncing builds on it. */
  enabled: boolean;
  url: string | null;
  token: string | null;
}

/** The answer to the page. The token itself never goes back; only whether there is one. */
export interface VaultSyncReply {
  url: string | null;
  hasToken: boolean;
  status?: GitRemoteStatus;
  pull?: GitPullResult;
  push?: GitPushResult;
}

const NOT_AN_ACTION = "That is not a sync action.";

/**
 * Sync the folder with its remote, as the Settings panel asks.
 *
 * The same gate as the mirror's commits: history must be on, and a folder
 * inside somebody else's repository is refused. The URL is checked here, so a
 * stored value that is not plain https never reaches git. Throws with a
 * message fit to show; the token is removed from it first.
 */
export async function syncVault(
  root: string,
  action: unknown,
  settings: VaultSyncSettings,
  repo: IWorkspaceGitRemote = new NativeWorkspaceGit(root),
  probe: (root: string) => Promise<VaultRepoState> = probeRepo,
): Promise<VaultSyncReply> {
  const base = { url: settings.url, hasToken: Boolean(settings.token) };
  if (!(VAULT_SYNC_ACTIONS as readonly unknown[]).includes(action)) throw new Error(NOT_AN_ACTION);
  if (action === "settings") return base;

  const verdict = decideVaultCommit(settings.enabled, settings.enabled ? await probe(root) : { kind: "none" });
  if (!verdict.ok) throw new Error(verdict.reason);
  const url = checkGitRemoteUrl(settings.url);
  if (!url.ok) throw new Error(url.reason);
  const remote: GitRemoteConfig = settings.token ? { url: url.url, token: settings.token } : { url: url.url };

  // Status never creates a repository: a folder with none yet is not given one.
  // On an existing repo it does point the sync remote at this URL and write
  // `info/exclude` (both in `.git`, none of the user's files), then fetches.
  if (action === "status" && verdict.action === "init") {
    return { ...base, status: { url: null, branch: DEFAULT_SYNC_BRANCH, ahead: 0, behind: 0 } };
  }
  try {
    return await serial(async () => {
      switch (action as Exclude<VaultSyncAction, "settings">) {
        case "status":
          return { ...base, status: await repo.remoteStatus(remote) };
        case "connect":
          return { ...base, status: await repo.connect(remote) };
        case "pull":
          return { ...base, pull: await repo.pull(remote, SYNC_AUTHOR) };
        case "push":
          return { ...base, push: await repo.push(remote, SYNC_AUTHOR) };
      }
    });
  } catch (error) {
    throw new Error(redactAuth(gitReason(error), settings.token ?? undefined));
  }
}

/** Git's own error lines, not the command echo and per-file warnings around them. */
export function gitReason(error: unknown): string {
  const text = errorMessage(error, "");
  const lines = text.split(/\r?\n/).filter((line) => /^(fatal|error):/.test(line));
  return lines.length > 0 ? lines.join(" ") : text.split(/\r?\n/)[0] || "Could not commit.";
}
