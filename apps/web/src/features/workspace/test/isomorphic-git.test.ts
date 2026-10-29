import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";
import { IsomorphicWorkspaceGit, type IsomorphicWorkspaceGitOptions } from "../infrastructure/isomorphic-workspace-git";
import { isomorphicFsFrom } from "../infrastructure/isomorphic-fs-adapter";

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

async function repo(options: IsomorphicWorkspaceGitOptions = {}) {
  const fs = new MemoryWorkspaceFs(advancingClock());
  const git = new IsomorphicWorkspaceGit(fs, options);
  await git.init();
  return { fs, git };
}

/**
 * Puts a path in the index without going through the sync policy, the way an
 * older run or a commit that failed after `add` leaves the index behind.
 */
async function stageDirectly(fs: MemoryWorkspaceFs, path: string) {
  const isoGit = await import("isomorphic-git");
  await isoGit.add({ fs: isomorphicFsFrom(fs), dir: "/", filepath: path });
}

/** Commits whatever is staged, bypassing the policy, to seed a tracked-but-ignored file. */
async function commitDirectly(fs: MemoryWorkspaceFs, message: string) {
  const isoGit = await import("isomorphic-git");
  await isoGit.commit({ fs: isomorphicFsFrom(fs), dir: "/", message, author });
}

async function text(bytes: Uint8Array | null): Promise<string | null> {
  return bytes === null ? null : new TextDecoder().decode(bytes);
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

test("a repo whose HEAD points at a missing commit rejects instead of reading as empty (29-10)", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("note.md", "one");
  await git.commitAll("first", author);
  await fs.writeFile(".git/HEAD", `${"d".repeat(40)}\n`);

  await assert.rejects(git.log());
});

test("commitAll skips ignored folders and oversized files, so they never reach history (storage safety)", async () => {
  const { fs, git } = await repo({ maxFileBytes: 10 });
  await fs.writeFile("notes/a.md", "keep");
  await fs.writeFile("node_modules/left-pad/index.js", "module.exports = 1;");
  await fs.writeFile("dist/app.js", "bundle");
  await fs.writeFile("notes/huge.bin", new Uint8Array(11));

  const commit = await git.commitAll("first", author);

  assert.ok(commit);
  assert.ok(await git.readAt(commit.oid, "notes/a.md"));
  assert.equal(await git.readAt(commit.oid, "node_modules/left-pad/index.js"), null);
  assert.equal(await git.readAt(commit.oid, "dist/app.js"), null);
  assert.equal(await git.readAt(commit.oid, "notes/huge.bin"), null);
});

test("commitAll with only ignored changes commits nothing", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "keep");
  await git.commitAll("first", author);
  await fs.writeFile(".cache/thumb.png", "cache");

  assert.equal(await git.commitAll("second", author), null);
});

test("an ignored file staged by an older run is unstaged, so the next commit does not carry it (scope)", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  await git.commitAll("first", author);
  await fs.writeFile("node_modules/x/index.js", "staged");
  await stageDirectly(fs, "node_modules/x/index.js");

  await fs.writeFile("notes/a.md", "two");
  const commit = await git.commitAll("second", author);

  assert.ok(commit);
  assert.equal(await git.readAt(commit.oid, "node_modules/x/index.js"), null);
  assert.equal(await text(await git.readAt(commit.oid, "notes/a.md")), "two");
});

test("staged ignored content alone commits nothing, and stays out of a later commit (scope)", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  await git.commitAll("first", author);
  await fs.writeFile("node_modules/x/index.js", "staged");
  await stageDirectly(fs, "node_modules/x/index.js");

  assert.equal(await git.commitAll("nothing", author), null);

  await fs.writeFile("notes/b.md", "two");
  const commit = await git.commitAll("second", author);
  assert.ok(commit);
  assert.equal(await git.readAt(commit.oid, "node_modules/x/index.js"), null);
});

test("an ignored file staged before the first commit is removed from the index (scope, no HEAD)", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("node_modules/x/index.js", "staged");
  await stageDirectly(fs, "node_modules/x/index.js");
  await fs.writeFile("notes/a.md", "one");

  const commit = await git.commitAll("first", author);

  assert.ok(commit);
  assert.equal(await git.readAt(commit.oid, "node_modules/x/index.js"), null);
});

test("a backslash path into an ignored folder is not committed through commitAll", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "keep");
  await fs.writeFile("notes\\node_modules\\x.js", "x");

  const commit = await git.commitAll("first", author);

  assert.ok(commit);
  assert.equal(await git.readAt(commit.oid, "notes\\node_modules\\x.js"), null);
  assert.ok(await git.readAt(commit.oid, "notes/a.md"));
});

test("desktop.ini never reaches history through commitAll, whatever its case", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "keep");
  await fs.writeFile("notes/Desktop.ini", "[.ShellClassInfo]");

  const commit = await git.commitAll("first", author);

  assert.ok(commit);
  assert.equal(await git.readAt(commit.oid, "notes/Desktop.ini"), null);
  assert.ok(await git.readAt(commit.oid, "notes/a.md"));
});

test("a tracked file in an ignored folder that changes on disk is not re-added (scope)", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  await fs.writeFile("node_modules/x.js", "v1");
  await stageDirectly(fs, "notes/a.md");
  await stageDirectly(fs, "node_modules/x.js");
  await commitDirectly(fs, "seed");

  await fs.writeFile("node_modules/x.js", "v2");
  await fs.writeFile("notes/a.md", "two");
  const commit = await git.commitAll("second", author);

  assert.ok(commit);
  assert.equal(await text(await git.readAt(commit.oid, "node_modules/x.js")), "v1");
  assert.equal(await text(await git.readAt(commit.oid, "notes/a.md")), "two");
});

test("deleting a tracked file in an ignored folder is not committed as a deletion (scope)", async () => {
  const { fs, git } = await repo();
  await fs.writeFile("notes/a.md", "one");
  await fs.writeFile("node_modules/x.js", "v1");
  await stageDirectly(fs, "notes/a.md");
  await stageDirectly(fs, "node_modules/x.js");
  await commitDirectly(fs, "seed");

  await fs.remove("node_modules/x.js");
  await fs.writeFile("notes/b.md", "two");
  const commit = await git.commitAll("second", author);

  assert.ok(commit);
  assert.equal(await text(await git.readAt(commit.oid, "node_modules/x.js")), "v1");
});

test("a tracked file that grows over the cap keeps its last committed version (size)", async () => {
  const { fs, git } = await repo({ maxFileBytes: 10 });
  await fs.writeFile("notes/big.md", "small");
  await git.commitAll("first", author);

  await fs.writeFile("notes/big.md", "x".repeat(20));
  await fs.writeFile("notes/other.md", "two");
  const commit = await git.commitAll("second", author);

  assert.ok(commit);
  assert.equal(await text(await git.readAt(commit.oid, "notes/big.md")), "small");
});

test("a file over the size cap is not committed, and the rest is (warn + skip)", async () => {
  const { fs, git } = await repo({ maxFileBytes: 10 });
  await fs.writeFile("notes/a.md", "keep");
  await fs.writeFile("papers/scan.pdf", new Uint8Array(11));

  const commit = await git.commitAll("first", author);

  assert.ok(commit);
  assert.equal(await text(await git.readAt(commit.oid, "notes/a.md")), "keep");
  assert.equal(await git.readAt(commit.oid, "papers/scan.pdf"), null);
});

test("a file that cannot be stat'd fails the commit and leaves history as it was", async () => {
  // isomorphic-git's own status walk stats every file, so one it cannot read
  // stops the commit there; nothing half-done reaches history.
  const fs = new MemoryWorkspaceFs(advancingClock());
  const stat = fs.stat.bind(fs);
  fs.stat = async (path: string) => {
    if (path === "notes/bad.md") throw new Error("bridge error");
    return stat(path);
  };
  const git = new IsomorphicWorkspaceGit(fs);
  await git.init();
  await fs.writeFile("notes/a.md", "keep");
  await fs.writeFile("notes/bad.md", "unreadable");

  await assert.rejects(git.commitAll("first", author));
  assert.deepEqual(await git.log(), []);
});
