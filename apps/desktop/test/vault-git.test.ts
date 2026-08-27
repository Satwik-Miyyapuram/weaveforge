import assert from "node:assert/strict";
import { test } from "node:test";

import type { GitAuthor, GitFileStatus, IWorkspaceGit, WorkspaceCommit } from "@weaveforge/core";

import { commitVault } from "../src/vault-git";

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
