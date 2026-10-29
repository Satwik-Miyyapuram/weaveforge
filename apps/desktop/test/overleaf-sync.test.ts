import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";

import {
  checkLinkFolder,
  parseLinks,
  syncOverleaf,
  type OverleafLink,
  type OverleafSyncDeps,
} from "../src/overleaf-sync";

/**
 * Overleaf projects synced into vault subfolders over Overleaf's git bridge.
 * The remote here is a local bare repo on `master`, standing in for
 * `https://git.overleaf.com/<id>`.
 */

const ID = "64f0c0ffee0123456789abcd";

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

function overleafRemote(t: TestContext): string {
  const bare = tempDir(t, "wf-ols-bare-");
  execFileSync("git", ["init", "-q", "--bare", "-b", "master", bare]);
  const seed = tempDir(t, "wf-ols-seed-");
  execFileSync("git", ["init", "-q", "-b", "master", seed]);
  write(seed, "main.tex", "\\documentclass{article}\n");
  sh(seed, "add", "-A");
  sh(seed, "-c", "user.name=o", "-c", "user.email=o@x", "commit", "-q", "-m", "seed");
  sh(seed, "push", "-q", bare, "master");
  return bare;
}

function setup(t: TestContext, token: string | null = "olp_token") {
  const bare = overleafRemote(t);
  const vault = tempDir(t, "wf-ols-vault-");
  const userData = tempDir(t, "wf-ols-userdata-");
  let stored: OverleafLink[] = [];
  const deps: OverleafSyncDeps = {
    vaultRoot: vault,
    userData,
    token,
    links: {
      read: async () => stored,
      write: async (links: readonly OverleafLink[]) => {
        stored = [...links];
      },
    },
    remoteUrl: () => bare,
  };
  return { bare, vault, userData, deps, stored: () => stored };
}

test("link folders: relative, forward slashes, inside the vault, never app data", () => {
  for (const ok of ["Overleaf/thesis", "papers/2026 draft", "a"]) {
    assert.deepEqual(checkLinkFolder(ok), { ok: true, folder: ok }, ok);
  }
  assert.deepEqual(checkLinkFolder("  Overleaf/thesis/ "), { ok: true, folder: "Overleaf/thesis" });
  for (const bad of ["", "/", "/abs", "C:/x", "a\\b", "../out", "a/../../b", "a/./b", ".weaveforge/x", "x/.git", ".git", "a//b", 7, null]) {
    assert.equal(checkLinkFolder(bad).ok, false, String(bad));
  }
});

test("stored links are read back defensively", () => {
  assert.deepEqual(parseLinks(null), []);
  assert.deepEqual(parseLinks("not json"), []);
  assert.deepEqual(parseLinks(JSON.stringify([{ projectId: ID, folder: "Overleaf/a" }, { projectId: "bad id!", folder: "x" }, { folder: "y" }])), [
    { projectId: ID, folder: "Overleaf/a" },
  ]);
});

test("link takes a pasted project URL, defaults the folder, and refuses duplicates", async (t) => {
  const { deps, stored } = setup(t);

  const reply = await syncOverleaf({ action: "link", projectId: `https://www.overleaf.com/project/${ID}` }, deps);

  assert.deepEqual(reply.links, [{ projectId: ID, folder: `Overleaf/${ID}` }]);
  assert.equal(reply.hasToken, true);
  assert.deepEqual(stored(), reply.links);
  await assert.rejects(syncOverleaf({ action: "link", projectId: ID, folder: "other" }, deps), /already linked/);
  await assert.rejects(syncOverleaf({ action: "link", projectId: "abc", folder: `Overleaf/${ID}` }, deps), /already/);
  await assert.rejects(syncOverleaf({ action: "link", projectId: "abc", folder: `Overleaf/${ID}/sub` }, deps), /already/);
  await assert.rejects(syncOverleaf({ action: "link", projectId: "https://evil.example/project/abc" }, deps), /project/i);
  await assert.rejects(syncOverleaf({ action: "nope" }, deps), /not an Overleaf sync action/);
});

test("pull brings the project into its folder; push sends edits back to master", async (t) => {
  const { bare, vault, deps } = setup(t);
  write(vault, "notes.md", "outside the project\n");
  await syncOverleaf({ action: "link", projectId: ID, folder: "Overleaf/thesis" }, deps);

  const pulled = await syncOverleaf({ action: "pull", projectId: ID }, deps);

  assert.equal(pulled.pull?.kind, "fast-forward");
  const sub = path.join(vault, "Overleaf", "thesis");
  assert.equal(readFileSync(path.join(sub, "main.tex"), "utf8"), "\\documentclass{article}\n");
  assert.ok(!existsSync(path.join(sub, ".git")));

  write(sub, "main.tex", "\\documentclass{article}\n% from WeaveForge\n");
  const pushed = await syncOverleaf({ action: "push", projectId: ID }, deps);

  assert.equal(pushed.push?.kind, "pushed");
  assert.match(sh(bare, "show", "master:main.tex"), /from WeaveForge/);
  assert.deepEqual(sh(bare, "ls-tree", "--name-only", "master").trim().split(/\r?\n/), ["main.tex"]);

  const status = await syncOverleaf({ action: "status", projectId: ID }, deps);
  assert.deepEqual(status.status, { url: bare, branch: "master", ahead: 0, behind: 0 });
});

test("status before the first pull creates nothing", async (t) => {
  const { userData, deps } = setup(t);
  await syncOverleaf({ action: "link", projectId: ID, folder: "Overleaf/thesis" }, deps);

  const reply = await syncOverleaf({ action: "status", projectId: ID }, deps);

  assert.deepEqual(reply.status, { url: null, branch: "master", ahead: 0, behind: 0 });
  assert.ok(!existsSync(path.join(userData, "overleaf-git")));
});

test("pull and push need a stored token and a linked project", async (t) => {
  const { deps } = setup(t, null);
  await syncOverleaf({ action: "link", projectId: ID, folder: "Overleaf/thesis" }, deps);

  await assert.rejects(syncOverleaf({ action: "pull", projectId: ID }, deps), /Overleaf git token/);
  await assert.rejects(syncOverleaf({ action: "push", projectId: "unlinked" }, deps), /not linked/);
});

test("unlink forgets the link and leaves the files where they are", async (t) => {
  const { vault, deps } = setup(t);
  await syncOverleaf({ action: "link", projectId: ID, folder: "Overleaf/thesis" }, deps);
  await syncOverleaf({ action: "pull", projectId: ID }, deps);

  const reply = await syncOverleaf({ action: "unlink", projectId: ID }, deps);

  assert.deepEqual(reply.links, []);
  assert.ok(existsSync(path.join(vault, "Overleaf", "thesis", "main.tex")));
});

test("a project relinked to another folder starts a fresh repository there", async (t) => {
  const { vault, bare, deps } = setup(t);
  await syncOverleaf({ action: "link", projectId: ID, folder: "Overleaf/a" }, deps);
  await syncOverleaf({ action: "pull", projectId: ID }, deps);
  await syncOverleaf({ action: "unlink", projectId: ID }, deps);
  await syncOverleaf({ action: "link", projectId: ID, folder: "Overleaf/b" }, deps);

  // With the old repository the empty new folder would read as "every file
  // deleted", and the pull would commit that deletion first.
  const pulled = await syncOverleaf({ action: "pull", projectId: ID }, deps);

  assert.equal(pulled.pull?.kind, "fast-forward");
  assert.ok(existsSync(path.join(vault, "Overleaf", "b", "main.tex")));
  assert.ok(existsSync(path.join(vault, "Overleaf", "a", "main.tex")));
  assert.equal(sh(bare, "ls-tree", "--name-only", "master").trim(), "main.tex");
});

test("errors never carry the token", async (t) => {
  const { deps } = setup(t, "olp_supersecret");
  const failing: OverleafSyncDeps = { ...deps, remoteUrl: () => "https://olp_supersecret@127.0.0.1:1/nope" };
  await syncOverleaf({ action: "link", projectId: ID, folder: "Overleaf/thesis" }, failing);

  await assert.rejects(syncOverleaf({ action: "pull", projectId: ID }, failing), (error: Error) => {
    assert.ok(!error.message.includes("olp_supersecret"), error.message);
    return true;
  });
});
