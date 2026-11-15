import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

/**
 * scripts/check-docs-coupled.mjs against a throwaway repo with an `origin`:
 * `--unpushed` (the pre-push hook) checks commits on no remote, and a
 * `docs-ok: <reason>` line in one of those commit messages waives it.
 */

// Git hooks export GIT_DIR, which would point git below at the real repository.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}
delete process.env.PR_BODY;

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "check-docs-coupled.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "docs-coupled-"));
const origin = path.join(dir, "origin.git");
const repo = path.join(dir, "repo");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const write = (rel, text) => {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), text);
};
const commit = (message) => {
  git("add", ".");
  git("commit", "-q", "-m", message);
};
const check = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });

execFileSync("git", ["init", "-q", "--bare", origin]);
mkdirSync(repo);
git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "test");
git("remote", "add", "origin", origin);
write("docs/using/a.md", "---\ncovers:\n  - src/a\nchecked: 2026-01-01\n---\n# A\n");
write("src/a/x.ts", "1\n");
commit("init");
git("push", "-q", "origin", "main");

after(() => rmSync(dir, { recursive: true, force: true }));

describe("check-docs-coupled --unpushed", () => {
  it("passes when nothing is unpushed", () => {
    assert.equal(check("--unpushed").status, 0);
  });

  it("fails when an unpushed commit changes covered code and not the page", () => {
    write("src/a/x.ts", "2\n");
    commit("change a");
    const run = check("--unpushed");
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /docs\/using\/a\.md/);
  });

  it("passes once a later unpushed commit touches the page", () => {
    write("docs/using/a.md", "---\ncovers:\n  - src/a\nchecked: 2026-02-01\n---\n# A\n");
    commit("docs a");
    assert.equal(check("--unpushed").status, 0);
  });

  it("ignores pushed commits", () => {
    git("push", "-q", "origin", "main");
    write("src/b.ts", "1\n");
    commit("unrelated");
    assert.equal(check("--unpushed").status, 0);
  });

  it("is waived by a docs-ok line in an unpushed commit message", () => {
    write("src/a/x.ts", "3\n");
    commit("change a again\n\ndocs-ok: copy only");
    assert.equal(check("--unpushed").status, 0);
  });
});

describe("check-docs-coupled <base> <head>", () => {
  it("fails on a range that changes covered code only", () => {
    write("src/a/x.ts", "4\n");
    commit("change a once more");
    assert.equal(check("HEAD^", "HEAD").status, 1);
  });

  it("is waived by a docs-ok line in a commit message in the range", () => {
    assert.equal(check("HEAD~2", "HEAD").status, 0);
  });

  it("is waived by PR_BODY", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "HEAD^", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PR_BODY: "docs-ok: copy only" },
    });
    assert.equal(run.status, 0);
  });
});
