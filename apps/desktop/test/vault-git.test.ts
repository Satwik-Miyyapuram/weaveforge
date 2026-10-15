import assert from "node:assert/strict";
import { test } from "node:test";

import type { GitAuthor, GitFileStatus, IWorkspaceGit, WorkspaceCommit } from "@weaveforge/core";

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
