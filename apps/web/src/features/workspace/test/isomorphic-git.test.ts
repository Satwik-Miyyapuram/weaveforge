import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWorkspaceFs } from "@thesis/core/testing";
import { IsomorphicWorkspaceGit } from "../infrastructure/isomorphic-workspace-git";

/**
 * Drives real isomorphic-git through the fs shim. This is the piece the plan
 * flagged as the schedule risk — git wants a `node:fs` surface our port does
 * not have — so it is exercised end to end rather than mocked.
 */

const author = { name: "Test", email: "test@example.com" };

/**
 * An advancing clock, because git's index caches on (size, mtime) and skips
 * hashing when both match. A frozen clock plus a same-length edit therefore
 * looks unchanged — correct behaviour against a filesystem that lies about
 * time, but not a filesystem anyone actually has.
 */
function advancingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 5, 0, 0, (tick += 1))).toISOString();
}

async function repo() {
  const fs = new MemoryWorkspaceFs(advancingClock());
  const git = new IsomorphicWorkspaceGit(fs);
  await git.init();
  return { fs, git };
}

test("a fresh folder is not a repo until init", async () => {
  const fs = new MemoryWorkspaceFs(advancingClock());
  const git = new IsomorphicWorkspaceGit(fs);

  assert.equal(await git.isRepo(), false);
});

test("init creates a repo the shim can read back", async () => {
  const { git } = await repo();

  // isRepo resolves HEAD, which needs a commit; an empty repo has none yet.
  assert.deepEqual(await git.log(), []);
});

test("a new file shows as added, then commits", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/method.md", "# Method\n");

  const status = await git.status();
  assert.deepEqual(status, [{ path: "notes/method.md", state: "added" }]);

  const commit = await git.commitAll("first", author);
  assert.ok(commit, "a commit should be produced");
  assert.equal(commit!.message, "first");
  assert.equal(await git.isRepo(), true);
});

test("committing with nothing staged returns null rather than an empty commit", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  await git.commitAll("first", author);

  // Every mirror pass calls this; empty commits would make the history useless.
  assert.equal(await git.commitAll("second", author), null);
});

test("an edit is reported as modified and lands in the log", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  await git.commitAll("first", author);

  await fs.writeFile("notes/a.md", "two");
  assert.deepEqual(await git.status(), [{ path: "notes/a.md", state: "modified" }]);

  await git.commitAll("second", author);
  const log = await git.log();
  assert.equal(log.length, 2);
  assert.equal(log[0]!.message, "second", "newest first");
});

test("a deletion is staged as a removal", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  await git.commitAll("first", author);

  await fs.remove("notes/a.md");
  assert.deepEqual(await git.status(), [{ path: "notes/a.md", state: "deleted" }]);

  assert.ok(await git.commitAll("removed", author));
});

test("history can be read back at a commit", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "original");
  const first = await git.commitAll("first", author);
  await fs.writeFile("notes/a.md", "changed");
  await git.commitAll("second", author);

  const blob = await git.readAt(first!.oid, "notes/a.md");
  assert.equal(new TextDecoder().decode(blob!), "original", "the old content is recoverable");
});

test("reading a path that did not exist at that commit returns null", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  const first = await git.commitAll("first", author);

  assert.equal(await git.readAt(first!.oid, "notes/never.md"), null);
});

test("nested directories round-trip through the shim", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/method/baselines.md", "deep");
  await fs.writeFile("logbook/2026/03/entry.md", "deeper");

  await git.commitAll("nested", author);
  const log = await git.log();

  assert.equal(log.length, 1);
  assert.ok(await git.readAt(log[0]!.oid, "logbook/2026/03/entry.md"));
});
