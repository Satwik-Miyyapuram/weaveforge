import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";

import { SYNC_AUTHOR, type GitRemoteConfig } from "@weaveforge/core";

import { NativeWorkspaceGit, redactAuth, remoteAuth } from "../src/vault-git";

/**
 * Remote sync through the machine's git, against a bare repository on disk.
 * The remote is a path rather than https: the transport is git's, and what is
 * under test is what we do around it (commit first, never force, abort a
 * conflicting merge and say which files).
 */

function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setup(t: TestContext) {
  const bare = tempDir(t, "wf-remote-bare-");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  const remote: GitRemoteConfig = { url: bare };
  const machine = (name: string) => {
    const root = tempDir(t, `wf-remote-${name}-`);
    return { root, git: new NativeWorkspaceGit(root) };
  };
  return { bare, remote, machine };
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}

function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

/** True when the folder's object store holds the file's current contents (it was hashed). */
function hasLocalObject(root: string, rel: string): boolean {
  const oid = execFileSync("git", ["-C", root, "hash-object", "--", rel], { encoding: "utf8" }).trim();
  try {
    execFileSync("git", ["-C", root, "cat-file", "-e", oid], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function remoteFiles(bare: string): string[] {
  return execFileSync("git", ["-C", bare, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
}

test("connect on a fresh folder makes a repo, adds the remote, and reports an empty remote", async (t) => {
  const { remote, machine } = setup(t);
  const a = machine("a");
  write(a.root, "notes/one.md", "# One\n");

  const status = await a.git.connect(remote);

  assert.equal(status.url, remote.url);
  assert.equal(status.behind, 0);
  assert.equal(await a.git.isRepo(), true);
});

test("push sends local files; a second machine pulls them into an empty folder", async (t) => {
  const { bare, remote, machine } = setup(t);
  const a = machine("a");
  const b = machine("b");
  write(a.root, "notes/one.md", "# One\n");
  await a.git.connect(remote);

  assert.deepEqual(await a.git.push(remote, SYNC_AUTHOR), { kind: "pushed" });
  assert.deepEqual(remoteFiles(bare), ["notes/one.md"]);
  assert.deepEqual(await a.git.push(remote, SYNC_AUTHOR), { kind: "up-to-date" });

  await b.git.connect(remote);
  const pulled = await b.git.pull(remote, SYNC_AUTHOR);
  assert.equal(pulled.kind, "fast-forward");
  assert.equal(read(b.root, "notes/one.md"), "# One\n");
  assert.deepEqual(await b.git.pull(remote, SYNC_AUTHOR), { kind: "up-to-date" });
});

test("status counts commits on each side after a fetch", async (t) => {
  const { remote, machine } = setup(t);
  const a = machine("a");
  const b = machine("b");
  write(a.root, "one.md", "1\n");
  await a.git.connect(remote);
  await a.git.push(remote, SYNC_AUTHOR);
  await b.git.connect(remote);
  await b.git.pull(remote, SYNC_AUTHOR);

  write(a.root, "two.md", "2\n");
  await a.git.push(remote, SYNC_AUTHOR);
  write(b.root, "three.md", "3\n");
  await b.git.commitAll("local", SYNC_AUTHOR);

  const status = await b.git.remoteStatus(remote);
  assert.equal(status.ahead, 1);
  assert.equal(status.behind, 1);
});

test("a pull merges edits to different files, keeping both", async (t) => {
  const { remote, machine } = setup(t);
  const a = machine("a");
  const b = machine("b");
  write(a.root, "one.md", "1\n");
  await a.git.connect(remote);
  await a.git.push(remote, SYNC_AUTHOR);
  await b.git.connect(remote);
  await b.git.pull(remote, SYNC_AUTHOR);

  write(a.root, "from-a.md", "a\n");
  await a.git.push(remote, SYNC_AUTHOR);
  // Uncommitted on purpose: pull commits it first.
  write(b.root, "from-b.md", "b\n");

  const result = await b.git.pull(remote, SYNC_AUTHOR);
  assert.equal(result.kind, "merged");
  assert.equal(read(b.root, "from-a.md"), "a\n");
  assert.equal(read(b.root, "from-b.md"), "b\n");
  assert.deepEqual(await b.git.push(remote, SYNC_AUTHOR), { kind: "pushed" });
});

test("a conflicting pull changes nothing locally and names the file", async (t) => {
  const { remote, machine } = setup(t);
  const a = machine("a");
  const b = machine("b");
  write(a.root, "shared.md", "base\n");
  await a.git.connect(remote);
  await a.git.push(remote, SYNC_AUTHOR);
  await b.git.connect(remote);
  await b.git.pull(remote, SYNC_AUTHOR);

  write(a.root, "shared.md", "edited on A\n");
  await a.git.push(remote, SYNC_AUTHOR);
  write(b.root, "shared.md", "edited on B\n");

  const result = await b.git.pull(remote, SYNC_AUTHOR);
  assert.deepEqual(result, { kind: "conflict", files: ["shared.md"] });
  // The local edit is intact, with no conflict markers, and the merge is not left half-done.
  assert.equal(read(b.root, "shared.md"), "edited on B\n");
  assert.equal(existsSync(path.join(b.root, ".git", "MERGE_HEAD")), false);
  assert.deepEqual(await b.git.status(), []);
});

test("a push the remote is ahead of is rejected, not forced", async (t) => {
  const { bare, remote, machine } = setup(t);
  const a = machine("a");
  const b = machine("b");
  write(a.root, "one.md", "1\n");
  await a.git.connect(remote);
  await a.git.push(remote, SYNC_AUTHOR);
  await b.git.connect(remote);
  await b.git.pull(remote, SYNC_AUTHOR);
  write(a.root, "two.md", "2\n");
  await a.git.push(remote, SYNC_AUTHOR);
  const remoteHead = execFileSync("git", ["-C", bare, "rev-parse", "main"], { encoding: "utf8" }).trim();

  write(b.root, "three.md", "3\n");
  const result = await b.git.push(remote, SYNC_AUTHOR);

  assert.equal(result.kind, "rejected");
  assert.equal(execFileSync("git", ["-C", bare, "rev-parse", "main"], { encoding: "utf8" }).trim(), remoteHead);
});

test("a pull that would overwrite a file kept out of history is refused, and the file survives", async (t) => {
  const { remote, machine } = setup(t);
  const a = machine("a");
  const b = machine("b");
  write(a.root, "one.md", "1\n");
  await a.git.connect(remote);
  await a.git.push(remote, SYNC_AUTHOR);
  await b.git.connect(remote);
  await b.git.pull(remote, SYNC_AUTHOR);

  // Committed on A by hand (bypassing the policy); on B the same path is an ignored, untracked file.
  write(a.root, "x.aux", "remote aux\n");
  execFileSync("git", ["-C", a.root, "add", "-f", "x.aux"]);
  execFileSync("git", ["-C", a.root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "aux"]);
  await a.git.push(remote, SYNC_AUTHOR);
  write(b.root, "x.aux", "local aux\n");

  const result = await b.git.pull(remote, SYNC_AUTHOR);
  assert.equal(result.kind, "conflict");
  assert.equal(read(b.root, "x.aux"), "local aux\n");
});

test("storage safety: ignored folders, desktop.ini and files over the cap are not committed", async (t) => {
  const { bare, remote } = setup(t);
  const root = tempDir(t, "wf-remote-cap-");
  const git = new NativeWorkspaceGit(root, { maxFileBytes: 10 });
  write(root, "notes/ok.md", "small\n");
  write(root, "notes/big.pdf", "x".repeat(11));
  write(root, "notes/big [1].pdf", "y".repeat(11));
  write(root, "notes/edge.txt", "x".repeat(10));
  write(root, "node_modules/pkg/index.js", "x");
  write(root, "Notes/Node_Modules/pkg/index.js", "x");
  write(root, "notes/desktop.ini", "[.ShellClassInfo]");
  write(root, "paper/main.aux", "aux");

  await git.connect(remote);
  await git.push(remote, SYNC_AUTHOR);

  assert.deepEqual(remoteFiles(bare), ["notes/edge.txt", "notes/ok.md"]);
  // Over-cap files are left out before staging, so they are never hashed into the repo.
  assert.equal(hasLocalObject(root, "notes/ok.md"), true);
  assert.equal(hasLocalObject(root, "notes/big.pdf"), false);
  assert.equal(hasLocalObject(root, "notes/big [1].pdf"), false);
});

test("a tracked file that grows past the cap keeps its last small version", async (t) => {
  const { bare, remote } = setup(t);
  const root = tempDir(t, "wf-remote-grow-");
  const git = new NativeWorkspaceGit(root, { maxFileBytes: 10 });
  write(root, "data.csv", "a,b\n");
  await git.connect(remote);
  await git.push(remote, SYNC_AUTHOR);

  write(root, "data.csv", "x".repeat(50));
  write(root, "other.md", "o\n");
  await git.push(remote, SYNC_AUTHOR);

  assert.deepEqual(remoteFiles(bare), ["data.csv", "other.md"]);
  assert.equal(hasLocalObject(root, "data.csv"), false);
  assert.equal(execFileSync("git", ["-C", bare, "show", "main:data.csv"], { encoding: "utf8" }), "a,b\n");
});

test("a deletion still goes through while an over-cap file is held back", async (t) => {
  const { bare, remote } = setup(t);
  const root = tempDir(t, "wf-remote-del-");
  const git = new NativeWorkspaceGit(root, { maxFileBytes: 10 });
  write(root, "data.csv", "a,b\n");
  write(root, "other.md", "o\n");
  await git.connect(remote);
  await git.push(remote, SYNC_AUTHOR);

  write(root, "data.csv", "x".repeat(50));
  unlinkSync(path.join(root, "other.md"));
  await git.push(remote, SYNC_AUTHOR);

  assert.deepEqual(remoteFiles(bare), ["data.csv"]);
  assert.equal(execFileSync("git", ["-C", bare, "show", "main:data.csv"], { encoding: "utf8" }), "a,b\n");
});

test("a token never appears in a failure message", async (t) => {
  const { machine } = setup(t);
  const a = machine("a");
  const token = "ghp_supersecrettoken123";
  // Nothing listens on port 1, so the request fails with the header set.
  const url = "https://127.0.0.1:1/me/notes.git";

  await assert.rejects(a.git.connect({ url, token }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(token), error.message);
    return true;
  });
  // The token is not written into the repository's config either.
  assert.ok(!read(a.root, ".git/config").includes(token));
});

test("redaction removes the token and its basic-auth form from git's text", () => {
  const token = "ghp_supersecrettoken123";
  const header = remoteAuth({ url: "https://github.com/me/notes.git", token }).env.GIT_CONFIG_VALUE_0 ?? "";
  const encoded = header.replace("Authorization: Basic ", "");
  assert.ok(encoded.length > 0);
  const text = `fatal: unable to access with ${token} and header ${header}`;
  const redacted = redactAuth(text, token);
  assert.ok(!redacted.includes(token), redacted);
  assert.ok(!redacted.includes(encoded), redacted);
  assert.equal(redactAuth(text, undefined), text);
});

test("the token header is scoped to the remote's own host, and not sent without a token", () => {
  const auth = remoteAuth({ url: "https://github.com/me/notes.git", token: "t0k" });
  assert.equal(auth.env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraHeader");
  assert.deepEqual(auth.flags, ["-c", "credential.helper="]);
  const anonymous = remoteAuth({ url: "https://github.com/me/notes.git" });
  assert.equal(anonymous.env.GIT_CONFIG_KEY_0, undefined);
  assert.deepEqual(anonymous.flags, []);
});
