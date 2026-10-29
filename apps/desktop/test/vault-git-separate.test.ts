import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";

import { SYNC_AUTHOR, type GitRemoteConfig } from "@weaveforge/core";

import { NativeWorkspaceGit, redactAuth, remoteAuth } from "../src/vault-git";

/**
 * A subfolder synced with its own remote (an Overleaf project) while the
 * folder above keeps its own history. The subfolder's repository lives
 * outside the folder (`gitDir`), so the outer repo sees plain files and there
 * is no nested `.git` for it to trip over.
 */

function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

/** An Overleaf-like remote: branch `master`, one commit with `main.tex`. */
function overleafRemote(t: TestContext): string {
  const bare = tempDir(t, "wf-ol-bare-");
  execFileSync("git", ["init", "-q", "--bare", "-b", "master", bare]);
  const seed = tempDir(t, "wf-ol-seed-");
  execFileSync("git", ["init", "-q", "-b", "master", seed]);
  write(seed, "main.tex", "\\documentclass{article}\n");
  sh(seed, "add", "-A");
  sh(seed, "-c", "user.name=o", "-c", "user.email=o@x", "commit", "-q", "-m", "seed");
  sh(seed, "push", "-q", bare, "master");
  return bare;
}

function setup(t: TestContext) {
  const bare = overleafRemote(t);
  const vault = tempDir(t, "wf-ol-vault-");
  execFileSync("git", ["init", "-q", "-b", "main", vault]);
  write(vault, "notes.md", "# Notes\n");
  const sub = path.join(vault, "Overleaf", "thesis");
  mkdirSync(sub, { recursive: true });
  const gitDir = path.join(tempDir(t, "wf-ol-userdata-"), "overleaf-git", "thesis.git");
  const remote: GitRemoteConfig = { url: bare };
  return { bare, vault, sub, gitDir, remote, repo: new NativeWorkspaceGit(sub, { branch: "master", gitDir }) };
}

test("a separate git dir: pull fills the subfolder and leaves no .git inside the folder", async (t) => {
  const { vault, sub, gitDir, remote, repo } = setup(t);
  assert.equal(await repo.isRepo(), false);

  const pulled = await repo.pull(remote, SYNC_AUTHOR);

  assert.equal(pulled.kind, "fast-forward");
  assert.equal(readFileSync(path.join(sub, "main.tex"), "utf8"), "\\documentclass{article}\n");
  assert.equal(await repo.isRepo(), true);
  assert.ok(existsSync(gitDir));
  assert.ok(!existsSync(path.join(sub, ".git")));
  // The folder's own repo sees the project as plain new files and has no sync remote.
  assert.match(sh(vault, "status", "--porcelain", "--untracked-files=all"), /Overleaf\/thesis\/main\.tex/);
  assert.ok(!sh(vault, "remote").includes("weaveforge"));
});

test("a separate git dir: push sends subfolder edits to the remote's master, nothing from outside it", async (t) => {
  const { bare, vault, sub, remote, repo } = setup(t);
  await repo.pull(remote, SYNC_AUTHOR);
  write(sub, "main.tex", "\\documentclass{article}\n% edited\n");
  write(sub, "chapters/intro.tex", "Intro\n");

  const pushed = await repo.push(remote, SYNC_AUTHOR);

  assert.equal(pushed.kind, "pushed");
  const files = sh(bare, "ls-tree", "-r", "--name-only", "master").split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(files, ["chapters/intro.tex", "main.tex"]);
  assert.match(sh(bare, "show", "master:main.tex"), /% edited/);
  // The folder's own history was not written to.
  assert.throws(() => sh(vault, "rev-parse", "--verify", "-q", "HEAD"));
});

test("a separate git dir: status counts against master", async (t) => {
  const { sub, remote, repo } = setup(t);
  await repo.pull(remote, SYNC_AUTHOR);
  write(sub, "main.tex", "changed\n");
  await repo.commitAll("edit", SYNC_AUTHOR);

  const status = await repo.remoteStatus(remote);

  assert.deepEqual(status, { url: remote.url, branch: "master", ahead: 1, behind: 0 });
});

test("a pull into a subfolder that already has the same file names is refused, changing nothing", async (t) => {
  const { sub, remote, repo } = setup(t);
  write(sub, "main.tex", "mine\n");

  const pulled = await repo.pull(remote, SYNC_AUTHOR);

  assert.deepEqual(pulled, { kind: "conflict", files: ["main.tex"] });
  assert.equal(readFileSync(path.join(sub, "main.tex"), "utf8"), "mine\n");
});

test("the basic-auth user name is the remote's own when it names one (Overleaf wants `git`)", () => {
  const token = "olp_secret123";
  const header = remoteAuth({ url: "https://git.overleaf.com/abc", token, username: "git" }).env.GIT_CONFIG_VALUE_0;
  assert.equal(header, `Authorization: Basic ${Buffer.from(`git:${token}`).toString("base64")}`);
  const encoded = Buffer.from(`git:${token}`).toString("base64");
  const redacted = redactAuth(`bad ${token} ${encoded}`, token, "git");
  assert.ok(!redacted.includes(token) && !redacted.includes(encoded), redacted);
});
