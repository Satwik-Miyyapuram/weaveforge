import assert from "node:assert/strict";
import { test } from "node:test";

import { GIT_OFF, type GitAuthor, type GitFileStatus, type IWorkspaceGit, type WorkspaceCommit } from "@weaveforge/core";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { commitVault, gitReason, NativeWorkspaceGit, vaultLog } from "../src/vault-git";

/** A git that records what it was asked to do and never touches a disk. */
function fakeGit(status: GitFileStatus[]) {
  const calls: string[] = [];
  const repo: IWorkspaceGit & { calls: string[]; message: string | null } = {
    kind: "native",
    calls,
    message: null,
    async isRepo() {
      return true;
    },
    async init() {
      calls.push("init");
    },
    async status() {
      calls.push("status");
      return status;
    },
    async commitAll(message: string, _author: GitAuthor): Promise<WorkspaceCommit | null> {
      calls.push("commit");
      repo.message = message;
      return { oid: "abc123", message, authoredAt: "2026-08-27T00:00:00.000Z", author: "WeaveForge" };
    },
    async log() {
      return [];
    },
    async readAt() {
      return null;
    },
  };
  return repo;
}

const changed: GitFileStatus[] = [
  { path: "notes/a.note.md", state: "modified" },
  { path: "notes/b.note.md", state: "added" },
];

test("nothing is committed while the setting is off", async () => {
  const repo = fakeGit(changed);
  const result = await commitVault("/vault", false, repo, async () => ({ kind: "own" }));
  assert.equal(result.committed, null);
  assert.deepEqual(repo.calls, []);
});

test("with the setting off, git is never started, not even to probe (M03)", async () => {
  // Starting git costs seconds of main-thread time on Windows; on every
  // folder sync, for a feature that is off by default, that was boot time.
  let probed = 0;
  const result = await commitVault("/vault", false, fakeGit(changed), async () => {
    probed += 1;
    return { kind: "own" };
  });
  assert.equal(probed, 0);
  assert.equal(result.reason, GIT_OFF);
});

test("a folder inside someone else's repository is left alone, with a reason", async () => {
  const repo = fakeGit(changed);
  const result = await commitVault("/vault/notes", true, repo, async () => ({
    kind: "enclosing",
    root: "/vault",
  }));
  assert.equal(result.committed, null);
  assert.match(result.reason ?? "", /\/vault/);
  assert.deepEqual(repo.calls, []);
});

test("a folder with no repository gets one before the first commit", async () => {
  const repo = fakeGit(changed);
  const result = await commitVault("/vault", true, repo, async () => ({ kind: "none" }));
  assert.equal(result.committed?.oid, "abc123");
  assert.deepEqual(repo.calls, ["init", "status", "commit"]);
  assert.equal(repo.message, "1 added, 1 changed");
});

test("an unchanged folder is not committed to", async () => {
  const repo = fakeGit([]);
  const result = await commitVault("/vault", true, repo, async () => ({ kind: "own" }));
  assert.equal(result.committed, null);
  assert.deepEqual(repo.calls, ["status"]);
});

test("a git that fails costs the history, not the caller", async () => {
  const repo = fakeGit(changed);
  repo.commitAll = async () => {
    throw new Error("index.lock exists");
  };
  const result = await commitVault("/vault", true, repo, async () => ({ kind: "own" }));
  assert.equal(result.committed, null);
  assert.equal(result.reason, "index.lock exists");
});

test("the folder's own history is read back; an enclosing repository's is not", async () => {
  const head: WorkspaceCommit = { oid: "abc123", message: "Update 2 notes", authoredAt: "2026-08-27T00:00:00.000Z", author: "WeaveForge" };
  const repo = { ...fakeGit([]), log: async () => [head] };
  assert.deepEqual(await vaultLog("/vault/notes", 20, repo, async () => ({ kind: "own" })), [head]);
  assert.deepEqual(await vaultLog("/vault/notes", 20, repo, async () => ({ kind: "enclosing", root: "/vault" })), []);
  assert.deepEqual(await vaultLog("/vault/notes", 20, repo, async () => ({ kind: "none" })), []);
});

test("a real folder commits its notes, long paths included, and never the database inside it", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "wf-vault-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".weaveforge", "db"), { recursive: true });
  writeFileSync(path.join(root, ".weaveforge", "db", "postmaster.pid"), "123");
  const deep = path.join(root, "project--6052c0", "papers", "x".repeat(120), "y".repeat(120));
  mkdirSync(deep, { recursive: true });
  writeFileSync(path.join(deep, `${"z".repeat(60)}.paper.md`), "# A paper");
  writeFileSync(path.join(root, "project--6052c0", "one.note.md"), "# One");
  mkdirSync(path.join(root, "project--6052c0", ".weaveforge"));
  writeFileSync(path.join(root, "project--6052c0", ".weaveforge", "manifest.json"), "{}");
  // An older build already committed the database.
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "add", ".weaveforge"]);
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"]);

  const result = await commitVault(root, true);
  assert.equal(result.reason, undefined);
  assert.ok(result.committed);
  const files = execFileSync("git", ["-C", root, "-c", "core.longpaths=true", "ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(files.length, 3);
  assert.ok(files.every((f) => f.startsWith("project--6052c0/")));
  assert.equal((await vaultLog(root, 5, new NativeWorkspaceGit(root))).length, 2);
});

test("the commit message counts the notes, not the database files kept out", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "wf-vault-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".weaveforge", "db"), { recursive: true });
  for (let i = 0; i < 5; i++) writeFileSync(path.join(root, ".weaveforge", "db", `base${i}`), "x");
  mkdirSync(path.join(root, "project--6052c0"));
  writeFileSync(path.join(root, "project--6052c0", "one.note.md"), "# One");
  writeFileSync(path.join(root, "project--6052c0", "two.note.md"), "# Two");

  const result = await commitVault(root, true);
  assert.equal(result.committed?.message, "2 added");
});

test("a git failure reads as git's own error, not the command and per-file warnings", () => {
  const error = new Error(
    [
      "Command failed: git -c core.longpaths=true -C D:/w add -A",
      "warning: in the working copy of 'a.md', LF will be replaced by CRLF",
      "error: open(\"project/papers/long.paper.md\"): Filename too long",
      "fatal: adding files failed",
    ].join("\n"),
  );
  assert.equal(gitReason(error), 'error: open("project/papers/long.paper.md"): Filename too long fatal: adding files failed');
  assert.equal(gitReason(new Error("index.lock exists")), "index.lock exists");
});

// xlog-14: an empty history is quiet; a git that cannot read the history is logged.
test("a repository with no commits has an empty history and logs nothing", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const root = mkdtempSync(path.join(tmpdir(), "wf-vault-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "-q"]);
  assert.deepEqual(await new NativeWorkspaceGit(root).log({ limit: 5 }), []);
  assert.equal(warn.mock.callCount(), 0);
});

test("a history git cannot read is still empty, and the log says why", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const root = mkdtempSync(path.join(tmpdir(), "wf-vault-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(await new NativeWorkspaceGit(path.join(root, "gone")).log({ limit: 5 }), []);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /^\[vault-git\] could not read the history: \S/);
});

// 38-05: with -z a rename is two records, the new path then the old one.
test("a staged rename is one change under its new path, with no bogus entry", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "wf-vault-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "-q"]);
  writeFileSync(path.join(root, "old-name.note.md"), "# A note long enough to keep its identity");
  writeFileSync(path.join(root, "kept.note.md"), "# Kept");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"]);
  execFileSync("git", ["-C", root, "mv", "old-name.note.md", "new-name.note.md"]);
  writeFileSync(path.join(root, "kept.note.md"), "# Kept, edited");

  const status = await new NativeWorkspaceGit(root).status();

  assert.deepEqual(
    [...status].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: "kept.note.md", state: "modified" },
      { path: "new-name.note.md", state: "modified" },
    ],
  );
});

// Storage growth: the folder's own history stays small, readable, and never pruned by a commit.
function gitIn(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", "core.longpaths=true", ...args], { encoding: "utf8" });
}

/** The pack runs detached after the commit, so wait for it before the folder is removed. */
async function packed(root: string, tries = 300): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (/^packs: [1-9]/m.test(gitIn(root, ["count-objects", "-v"])) && !existsSync(path.join(root, ".git", "gc.pid"))) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function newRepo(t: { after: (fn: () => void) => void }): string {
  const root = mkdtempSync(path.join(tmpdir(), "wf-vault-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  gitIn(root, ["init", "-q"]);
  return root;
}

test("a commit packs loose history but prunes nothing, so an older version stays readable", async (t) => {
  const root = newRepo(t);
  gitIn(root, ["config", "gc.auto", "1"]);
  gitIn(root, ["config", "gc.autoDetach", "false"]);
  for (let i = 0; i < 1000; i++) writeFileSync(path.join(root, `n${i}.note.md`), `# Note ${i}`);
  const first = await commitVault(root, true);
  assert.ok(first.committed);
  writeFileSync(path.join(root, "n0.note.md"), "# Note 0, edited");
  const second = await commitVault(root, true);
  assert.ok(second.committed);

  assert.ok(await packed(root), "the history was packed");
  const old = await new NativeWorkspaceGit(root).readAt(first.committed.oid, "n0.note.md");
  assert.equal(new TextDecoder().decode(old ?? new Uint8Array()), "# Note 0");
});

test("a small history is not packed, and the commit still lands with the old version readable", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "a.note.md"), "# A");
  const first = await commitVault(root, true);
  writeFileSync(path.join(root, "a.note.md"), "# A, edited");
  const second = await commitVault(root, true);
  assert.equal(second.reason, undefined);
  assert.ok(second.committed);
  assert.match(gitIn(root, ["count-objects", "-v"]), /^packs: 0$/m);
  assert.ok(await new NativeWorkspaceGit(root).readAt(first.committed!.oid, "a.note.md"));
});

test("a pack keeps an unreachable object older than two weeks, which git's default prune would delete", async (t) => {
  const root = newRepo(t);
  gitIn(root, ["config", "gc.auto", "1"]);
  gitIn(root, ["config", "gc.autoDetach", "false"]);
  writeFileSync(path.join(root, "orphan.txt"), "unreferenced");
  const oid = gitIn(root, ["hash-object", "-w", "orphan.txt"]).trim();
  rmSync(path.join(root, "orphan.txt"));
  const loose = path.join(root, ".git", "objects", oid.slice(0, 2), oid.slice(2));
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  utimesSync(loose, monthAgo, monthAgo);
  // Many loose notes make the gc.auto estimate exceed 1, so the pack below really runs.
  for (let i = 0; i < 3_000; i++) writeFileSync(path.join(root, `n${i}.note.md`), `# Note ${i}`);

  const result = await commitVault(root, true);
  assert.ok(result.committed);
  assert.ok(await packed(root), "the history was packed");
  assert.equal(gitIn(root, ["cat-file", "-t", oid]).trim(), "blob");
});

test("default git gc settings pack a history past the 6,700 loose-object threshold", { timeout: 300_000 }, async (t) => {
  const root = newRepo(t);
  // Only the vault's own pack call may pack here: git's commit-time maintenance is off.
  gitIn(root, ["config", "maintenance.auto", "false"]);
  // gc --auto estimates the loose count from objects/17 (x256), so a larger count keeps the estimate above 6,700.
  for (let i = 0; i < 12_000; i++) writeFileSync(path.join(root, `n${i}.note.md`), `# Note ${i}`);
  // Hashed ahead, without the vault's 30-second git bound: this test is about packing, not add speed.
  gitIn(root, ["add", "-A"]);

  const result = await commitVault(root, true);
  assert.equal(result.reason, undefined);
  assert.ok(result.committed);
  // On Windows git cannot detach gc, so the vault starts the pack as its own detached process.
  assert.ok(await packed(root), "the pack did not finish within 60 seconds");
});

test("the commit itself never runs git's auto gc, which on Windows blocks inside the 30-second bound", async (t) => {
  const root = newRepo(t);
  gitIn(root, ["config", "gc.auto", "1"]);
  gitIn(root, ["config", "gc.autoDetach", "false"]);
  // pre-auto-gc runs once per auto gc, then aborts it: one run is the vault's own pack, a second is the commit's.
  const runs = path.join(root, ".git", "auto-gc-runs");
  const hooks = path.join(root, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(path.join(hooks, "pre-auto-gc"), `#!/bin/sh\necho run >> "${runs.replace(/\\/g, "/")}"\nexit 1\n`, { mode: 0o755 });
  for (let i = 0; i < 1000; i++) writeFileSync(path.join(root, `n${i}.note.md`), `# Note ${i}`);

  const result = await commitVault(root, true);
  assert.equal(result.reason, undefined);
  assert.ok(result.committed);
  const count = () => (existsSync(runs) ? readFileSync(runs, "utf8").split(/\r?\n/).filter(Boolean).length : 0);
  for (let i = 0; i < 100 && count() === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(count(), 1, "only the vault's own pack ran auto gc, not git commit");
});

test("a stale index.lock left by a killed git is named in the commit failure, and left in place", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "a.note.md"), "# A");
  await commitVault(root, true);
  const lock = path.join(root, ".git", "index.lock");
  writeFileSync(lock, "");
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(lock, hourAgo, hourAgo);
  writeFileSync(path.join(root, "a.note.md"), "# A, edited");

  const result = await commitVault(root, true);
  assert.equal(result.committed, null);
  assert.match(result.reason ?? "", /stale/i);
  assert.match(result.reason ?? "", /index\.lock/);
  assert.match(result.reason ?? "", /60 min/);
  assert.ok(existsSync(lock), "the lock is only reported, never deleted");
});

test("a fresh index.lock, as from a git still running, is not called stale", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "a.note.md"), "# A");
  await commitVault(root, true);
  writeFileSync(path.join(root, ".git", "index.lock"), "");
  writeFileSync(path.join(root, "a.note.md"), "# A, edited");

  const result = await commitVault(root, true);
  assert.equal(result.committed, null);
  assert.match(result.reason ?? "", /index\.lock/);
  assert.doesNotMatch(result.reason ?? "", /stale/i);
});

test("a folder whose only changes are local-only database files commits nothing and throws nothing", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "a.note.md"), "# A");
  await commitVault(root, true);
  const before = gitIn(root, ["rev-parse", "HEAD"]);
  mkdirSync(path.join(root, ".weaveforge", "db"), { recursive: true });
  writeFileSync(path.join(root, ".weaveforge", "db", "base1"), "x");

  const result = await commitVault(root, true);
  assert.equal(result.committed, null);
  assert.equal(result.reason, undefined);
  assert.equal(gitIn(root, ["rev-parse", "HEAD"]), before);
});

test("a tracked local-only file changed alongside a note is left out of the commit", async (t) => {
  const root = newRepo(t);
  mkdirSync(path.join(root, ".weaveforge"));
  writeFileSync(path.join(root, ".weaveforge", "manifest.json"), "{}");
  gitIn(root, ["add", "-f", ".weaveforge"]);
  gitIn(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"]);
  writeFileSync(path.join(root, ".weaveforge", "manifest.json"), '{"changed":true}');
  writeFileSync(path.join(root, "a.note.md"), "# A");

  const result = await commitVault(root, true);
  assert.ok(result.committed);
  // The note is added; the tracked local-only file is only removed from the index, never re-committed with its new content.
  assert.deepEqual(gitIn(root, ["show", "--name-status", "--format=", "HEAD"]).split(/\r?\n/).filter(Boolean).sort(), [
    "A\ta.note.md",
    "D\t.weaveforge/manifest.json",
  ]);
});

test("a tracked note deleted from the folder is removed from the index", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "gone.note.md"), "# Gone");
  writeFileSync(path.join(root, "kept.note.md"), "# Kept");
  gitIn(root, ["add", "."]);
  gitIn(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"]);
  rmSync(path.join(root, "gone.note.md"));
  writeFileSync(path.join(root, "kept.note.md"), "# Kept, edited");

  const result = await commitVault(root, true);
  assert.ok(result.committed);
  assert.deepEqual(gitIn(root, ["ls-files"]).split(/\r?\n/).filter(Boolean), ["kept.note.md"]);
});

test("the local-only rule is written once to info/exclude, however often the folder commits", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "a.note.md"), "# A");
  await commitVault(root, true);
  writeFileSync(path.join(root, "a.note.md"), "# A, edited");
  await commitVault(root, true);
  const exclude = readFileSync(path.join(root, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude.split(/\r?\n/).filter((line) => line === "/.weaveforge/").length, 1);
});

test("spaces and unicode in note paths are committed under their own names", async (t) => {
  const root = newRepo(t);
  mkdirSync(path.join(root, "Thesis Notes – Ünïcode"), { recursive: true });
  writeFileSync(path.join(root, "Thesis Notes – Ünïcode", "Kapitel 1 ✓.note.md"), "# Kapitel");

  const result = await commitVault(root, true);
  assert.ok(result.committed);
  assert.deepEqual(gitIn(root, ["ls-files", "-z"]).split("\0").filter(Boolean), ["Thesis Notes – Ünïcode/Kapitel 1 ✓.note.md"]);
});

test("a backslash in a note name is committed under that name on systems that allow it", { skip: process.platform === "win32" }, async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "a\\b.note.md"), "# Backslash");

  const result = await commitVault(root, true);
  assert.ok(result.committed);
  assert.deepEqual(gitIn(root, ["ls-files", "-z"]).split("\0").filter(Boolean), ["a\\b.note.md"]);
});

// Storage growth, going forward: a file over the size cap never reaches the history, not even as a loose object.
const CAP = 1_024;

function capped(root: string): NativeWorkspaceGit {
  return new NativeWorkspaceGit(root, CAP);
}

function headFiles(root: string): string[] {
  return gitIn(root, ["show", "--name-status", "--format=", "HEAD"]).split(/\r?\n/).filter(Boolean).sort();
}

test("a new file over the size cap is left out, never hashed, and the note beside it is committed", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const root = newRepo(t);
  writeFileSync(path.join(root, "big.pdf"), Buffer.alloc(CAP + 1, 7));
  writeFileSync(path.join(root, "a.note.md"), "# A");

  const result = await commitVault(root, true, capped(root));

  assert.equal(result.reason, undefined);
  assert.equal(result.committed?.message, "1 added");
  assert.deepEqual(gitIn(root, ["ls-files"]).split(/\r?\n/).filter(Boolean), ["a.note.md"]);
  const oid = gitIn(root, ["hash-object", "big.pdf"]).trim();
  assert.throws(() => gitIn(root, ["cat-file", "-e", oid]), "the big blob was never written to the object store");
  assert.ok(warn.mock.calls.some((call) => /big\.pdf/.test(String(call.arguments[0]))), "the skipped file is named in the log");
});

test("a file exactly at the size cap is committed", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "edge.pdf"), Buffer.alloc(CAP, 7));

  const result = await commitVault(root, true, capped(root));
  assert.ok(result.committed);
  assert.deepEqual(gitIn(root, ["ls-files"]).split(/\r?\n/).filter(Boolean), ["edge.pdf"]);
});

test("a folder whose only change is over the size cap commits nothing and throws nothing", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const root = newRepo(t);
  writeFileSync(path.join(root, "a.note.md"), "# A");
  await commitVault(root, true, capped(root));
  const before = gitIn(root, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(root, "big.pdf"), Buffer.alloc(CAP + 1, 7));

  assert.deepEqual(await capped(root).status(), []);
  const result = await commitVault(root, true, capped(root));
  assert.equal(result.committed, null);
  assert.equal(result.reason, undefined);
  // commitAll alone must not throw "nothing to commit" either.
  assert.equal(await capped(root).commitAll("x", { name: "t", email: "t@t" }), null);
  assert.equal(gitIn(root, ["rev-parse", "HEAD"]), before);
});

test("a tracked file that grows past the cap keeps its last small version; other edits still commit", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const root = newRepo(t);
  writeFileSync(path.join(root, "grows.bin"), "small");
  writeFileSync(path.join(root, "a.note.md"), "# A");
  const first = await commitVault(root, true, capped(root));
  writeFileSync(path.join(root, "grows.bin"), Buffer.alloc(CAP + 1, 7));
  writeFileSync(path.join(root, "a.note.md"), "# A, edited");

  const result = await commitVault(root, true, capped(root));
  assert.ok(result.committed);
  assert.equal(result.committed.message, "1 changed");
  assert.deepEqual(headFiles(root), ["M\ta.note.md"]);
  assert.equal(gitIn(root, ["show", "HEAD:grows.bin"]), "small");
  assert.ok(first.committed);
});

test("a file over the cap that is already staged is unstaged, not committed", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const root = newRepo(t);
  writeFileSync(path.join(root, "a.note.md"), "# A");
  await commitVault(root, true, capped(root));
  // Staged by a git add that was killed before its commit, or by the user.
  writeFileSync(path.join(root, "big.pdf"), Buffer.alloc(CAP + 1, 7));
  gitIn(root, ["add", "big.pdf"]);
  writeFileSync(path.join(root, "a.note.md"), "# A, edited");

  const result = await commitVault(root, true, capped(root));
  assert.ok(result.committed);
  assert.deepEqual(headFiles(root), ["M\ta.note.md"]);
  assert.deepEqual(gitIn(root, ["ls-files"]).split(/\r?\n/).filter(Boolean), ["a.note.md"]);
});

test("a staged big file in a folder with no commits yet is unstaged too", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const root = newRepo(t);
  writeFileSync(path.join(root, "big.pdf"), Buffer.alloc(CAP + 1, 7));
  gitIn(root, ["add", "big.pdf"]);
  writeFileSync(path.join(root, "a.note.md"), "# A");

  const result = await commitVault(root, true, capped(root));
  assert.equal(result.reason, undefined);
  assert.ok(result.committed);
  assert.deepEqual(gitIn(root, ["ls-files"]).split(/\r?\n/).filter(Boolean), ["a.note.md"]);
});

test("a tracked file that grew past the cap and was staged keeps its last small version", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const root = newRepo(t);
  writeFileSync(path.join(root, "grows.bin"), "small");
  writeFileSync(path.join(root, "a.note.md"), "# A");
  await commitVault(root, true, capped(root));
  writeFileSync(path.join(root, "grows.bin"), Buffer.alloc(CAP + 1, 7));
  gitIn(root, ["add", "grows.bin"]);
  writeFileSync(path.join(root, "a.note.md"), "# A, edited");

  const result = await commitVault(root, true, capped(root));
  assert.ok(result.committed);
  assert.deepEqual(headFiles(root), ["M\ta.note.md"]);
  assert.equal(gitIn(root, ["show", "HEAD:grows.bin"]), "small");
});

test("a tracked file over the cap that is deleted is still removed from the index", async (t) => {
  const root = newRepo(t);
  // An older build committed it before there was a cap.
  writeFileSync(path.join(root, "huge.bin"), Buffer.alloc(CAP + 1, 7));
  writeFileSync(path.join(root, "a.note.md"), "# A");
  gitIn(root, ["add", "."]);
  gitIn(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"]);
  rmSync(path.join(root, "huge.bin"));

  const result = await commitVault(root, true, capped(root));
  assert.ok(result.committed);
  assert.deepEqual(headFiles(root), ["D\thuge.bin"]);
});

test("a big file whose name has glob characters is skipped alone, not its look-alike sibling", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const root = newRepo(t);
  writeFileSync(path.join(root, "big[1].pdf"), Buffer.alloc(CAP + 1, 7));
  writeFileSync(path.join(root, "big1.pdf"), "small");
  writeFileSync(path.join(root, "Folder With Space – ü.pdf"), Buffer.alloc(CAP + 1, 7));

  const result = await commitVault(root, true, capped(root));
  assert.ok(result.committed);
  assert.deepEqual(gitIn(root, ["ls-files", "-z"]).split("\0").filter(Boolean), ["big1.pdf"]);
});

test("the default cap lets a 30 MB paper PDF into the history", async (t) => {
  const root = newRepo(t);
  writeFileSync(path.join(root, "paper.pdf"), Buffer.alloc(30 * 1024 * 1024, 1));
  const result = await commitVault(root, true);
  assert.ok(result.committed);
  assert.deepEqual(gitIn(root, ["ls-files"]).split(/\r?\n/).filter(Boolean), ["paper.pdf"]);
});

test("the same PDF saved in two projects is stored once", async (t) => {
  const root = newRepo(t);
  const pdf = Buffer.alloc(4_096, 3);
  for (const dir of ["project-a", "project-b"]) {
    mkdirSync(path.join(root, dir, "papers", "pdf"), { recursive: true });
    writeFileSync(path.join(root, dir, "papers", "pdf", "same.pdf"), pdf);
  }

  const result = await commitVault(root, true);
  assert.ok(result.committed);
  const blobs = gitIn(root, ["ls-tree", "-r", "HEAD"]).split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/)[2]);
  assert.equal(blobs.length, 2);
  assert.equal(new Set(blobs).size, 1);
});
