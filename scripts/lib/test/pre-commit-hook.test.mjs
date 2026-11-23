/**
 * The pre-commit hook must leave the generated docs alone.
 *
 * It used to run `docs:generate` and `git add` the result, so every commit
 * picked up the line-count churn in docs/atlas.html and the architecture map,
 * and a `git commit -- <paths>` left the real index holding the old blobs
 * (the hook staged into git's temporary index). Docs are regenerated and
 * committed on their own by the pre-push runner, and CI checks them.
 *
 * The test runs the real hook in a scratch repo whose `docs:generate` always
 * rewrites atlas.html, so any regeneration in the hook would show up.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GENERATED_DOCS } from "../generated-docs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ATLAS = "docs/atlas.html";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "wf-precommit-"));
  for (const path of [".githooks/pre-commit", "scripts/clean-desktop-ini.mjs", "scripts/lib/generated-docs.mjs"]) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(join(ROOT, path), join(dir, path));
  }
  // A generator that always changes its output, like the line counts do.
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { "docs:generate": `node -e "require('fs').writeFileSync('${ATLAS}', String(Date.now()))"` },
    }),
  );
  for (const doc of GENERATED_DOCS) {
    mkdirSync(dirname(join(dir, doc)), { recursive: true });
    writeFileSync(join(dir, doc), "original\n");
  }
  writeFileSync(join(dir, "unrelated.txt"), "one\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", ".");
  git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "init");
  git(dir, "config", "core.hooksPath", ".githooks");
  return dir;
}

for (const pathspec of [false, true]) {
  test(`a commit of an unrelated file leaves atlas.html alone${pathspec ? " (git commit -- path)" : ""}`, () => {
    const dir = scratchRepo();
    try {
      writeFileSync(join(dir, "unrelated.txt"), "two\n");
      if (pathspec) git(dir, "commit", "-q", "-m", "change", "--", "unrelated.txt");
      else {
        git(dir, "add", "unrelated.txt");
        git(dir, "commit", "-q", "-m", "change");
      }
      const committed = git(dir, "show", "--name-only", "--format=", "HEAD").trim().split("\n");
      assert.deepEqual(committed, ["unrelated.txt"]);
      assert.equal(git(dir, "status", "--porcelain", "--", ATLAS), "");
      assert.equal(readFileSync(join(dir, ATLAS), "utf8"), "original\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
