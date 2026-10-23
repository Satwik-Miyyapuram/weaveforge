import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { readIndex } from "../repo-stats.mjs";

/**
 * Generated docs count lines in the files about to be committed, not in the
 * working copy. A file edited but not staged (Next.js rewrites
 * `apps/web/next-env.d.ts` on every dev run) used to skew the counts, so CI
 * disagreed with every local regeneration.
 */

const repo = mkdtempSync(path.join(tmpdir(), "repo-stats-"));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

git("init", "-q");
git("config", "user.email", "test@example.com");
git("config", "user.name", "test");
git("config", "core.autocrlf", "false");
writeFileSync(path.join(repo, "a.ts"), "1\n2\n3\n");
writeFileSync(path.join(repo, "b é.ts"), "x\r\ny\r\n");
writeFileSync(path.join(repo, "empty.ts"), "");
git("add", ".");
git("commit", "-q", "-m", "init");

after(() => rmSync(repo, { recursive: true, force: true }));

describe("readIndex", () => {
  it("reads committed content, ignoring unstaged edits", () => {
    writeFileSync(path.join(repo, "a.ts"), "1\n2\n3\n4\n5\n");
    assert.equal(readIndex(repo, ["a.ts"]).get("a.ts"), "1\n2\n3\n");
  });

  it("reads staged content once a change is added", () => {
    git("add", "a.ts");
    assert.equal(readIndex(repo, ["a.ts"]).get("a.ts"), "1\n2\n3\n4\n5\n");
  });

  it("handles names with spaces and non-ASCII, CRLF content and empty files", () => {
    const files = readIndex(repo, ["b é.ts", "empty.ts"]);
    assert.equal(files.get("b é.ts"), "x\r\ny\r\n");
    assert.equal(files.get("empty.ts"), "");
  });

  it("leaves out paths that are not in the index", () => {
    writeFileSync(path.join(repo, "untracked.ts"), "u\n");
    assert.equal(readIndex(repo, ["untracked.ts", "a.ts"]).has("untracked.ts"), false);
  });

  it("returns an empty map for no paths", () => {
    assert.equal(readIndex(repo, []).size, 0);
  });
});
