import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { ROOT, CODE, TRACKED, measure, readIndex } from "../repo-stats.mjs";
import { AREAS } from "../areas.mjs";

/**
 * Generated docs count lines in the files about to be committed, not in the
 * working copy. A file edited but not staged (Next.js rewrites
 * `apps/web/next-env.d.ts` on every dev run) used to skew the counts, so CI
 * disagreed with every local regeneration.
 */

// Git hooks export GIT_DIR (and in a linked worktree more), which would point
// every git call below at the real repository instead of the temp one.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

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

describe("AREAS", () => {
  const tracked = (dir) => TRACKED.some((rel) => rel.startsWith(`${dir}/`));

  it("names only directories that exist as tracked paths", () => {
    for (const area of AREAS) {
      assert.ok(tracked(area.dir), `${area.dir} has no tracked files`);
    }
  });

  it("lists each directory once", () => {
    const dirs = AREAS.map((area) => area.dir);
    assert.equal(new Set(dirs).size, dirs.length);
  });

  it("gives every area a non-empty description", () => {
    for (const area of AREAS) {
      assert.equal(typeof area.what, "string", `${area.dir} has no what`);
      assert.ok(area.what.trim().length > 0, `${area.dir} has an empty what`);
    }
  });

  it("lists every Rust crate and apps/relay", () => {
    const dirs = new Set(AREAS.map((area) => area.dir));
    const crates = new Set(
      TRACKED.filter((rel) => rel.startsWith("crates/")).map((rel) => rel.split("/").slice(0, 2).join("/")),
    );
    assert.ok(crates.size > 0, "no crates found in tracked files");
    for (const crate of crates) assert.ok(dirs.has(crate), `${crate} missing from AREAS`);
    assert.ok(dirs.has("apps/relay"), "apps/relay missing from AREAS");
  });
});

describe("measure", () => {
  it("counts Rust as code", () => {
    assert.equal(CODE.has(".rs"), true);
  });

  it("counts lines of crates/wf-core above zero", () => {
    assert.ok(measure({ dir: "crates/wf-core", unit: "lines" }).lines > 0);
  });
});

describe("atlas RUST_CORE_LINES", () => {
  const builder = readFileSync(path.join(ROOT, "scripts", "build-atlas.mjs"), "utf8");
  const template = readFileSync(path.join(ROOT, "docs", "atlas", "atlas.template.html"), "utf8");

  it("is defined in build-atlas.mjs from crates/wf-core", () => {
    assert.match(builder, /RUST_CORE_LINES:\s*n\(measure\(\{ dir: "crates\/wf-core", unit: "lines" \}\)/);
  });

  it("is used by the atlas template", () => {
    assert.ok(template.includes("{{RUST_CORE_LINES}}"));
  });
});
