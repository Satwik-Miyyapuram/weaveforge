import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decideGitSyncPath,
  GIT_SYNC_IGNORED_EXTENSIONS,
  GIT_SYNC_LIMITS,
  isUnderIgnoredFolder,
} from "../../src/workspace/git-sync-policy.js";

const MB = 1024 * 1024;
const SMALL = 1024;

function included(path: string, size = SMALL, cap?: number): boolean {
  return decideGitSyncPath(path, size, cap).include;
}

function reasonFor(path: string, size = SMALL, cap?: number): string | null {
  const decision = decideGitSyncPath(path, size, cap);
  return decision.include ? null : decision.reason;
}

test("the size cap is 25 MB and is its own constant, not the import limit", () => {
  assert.equal(GIT_SYNC_LIMITS.maxFileBytes, 25 * MB);
});

test("ordinary notes, LaTeX and markdown are synced", () => {
  for (const path of ["notes/a.note.md", "report/main.tex", "papers/attention.paper.md", "logbook/2026-10-29.md"]) {
    assert.equal(included(path), true, path);
  }
});

test("generic user folder names are synced, so a notes folder called build or out keeps syncing", () => {
  for (const path of ["build/plan.md", "notes/out/x.html", "notes/caches/readme.md", "caches/thumb.png"]) {
    assert.equal(included(path), true, path);
  }
});

test("dependency folders are ignored at any depth", () => {
  assert.equal(reasonFor("node_modules/left-pad/index.js"), "ignored-directory");
  assert.equal(reasonFor("notes/tools/node_modules/a.js"), "ignored-directory");
});

test("nested .git directories and files are ignored, so no repo is committed inside the repo", () => {
  assert.equal(reasonFor("papers/sub/.git/config"), "ignored-directory");
  assert.equal(reasonFor("notes/.git"), "ignored-directory");
  assert.equal(reasonFor(".git/HEAD"), "ignored-directory");
});

test("build outputs and framework caches are ignored", () => {
  for (const path of ["dist/app.js", "apps/web/.next/cache/x.pack", ".cache/x", "notes/.cache/y"]) {
    assert.equal(reasonFor(path), "ignored-directory", path);
  }
});

test("PDF and other render caches are ignored", () => {
  assert.equal(reasonFor("pdf-cache/abc.bin"), "ignored-directory");
  assert.equal(reasonFor("notes/pdf-cache/abc.bin"), "ignored-directory");
});

test("folder names are matched case-insensitively, as Windows folders are", () => {
  assert.equal(reasonFor("Node_Modules/a.js"), "ignored-directory");
  assert.equal(reasonFor("DIST/app.js"), "ignored-directory");
  assert.equal(reasonFor("notes/.GIT/config"), "ignored-directory");
});

test("file names are matched case-insensitively", () => {
  assert.equal(reasonFor("Desktop.ini"), "ignored-file");
  assert.equal(reasonFor("notes/DESKTOP.INI"), "ignored-file");
});

test("LaTeX build byproducts are ignored by extension", () => {
  for (const ext of GIT_SYNC_IGNORED_EXTENSIONS) {
    assert.equal(reasonFor(`report/main${ext}`), "ignored-file", ext);
  }
  assert.equal(included("report/main.tex"), true);
});

test("the root .weaveforge folder is this machine's database and is never synced", () => {
  assert.equal(reasonFor(".weaveforge/workspace.db"), "ignored-directory");
  assert.equal(reasonFor("/.weaveforge/workspace.db"), "ignored-directory");
});

test("a .weaveforge folder below the root is not the app's folder and is left to the size cap", () => {
  assert.equal(included("notes/.weaveforge/readme.md"), true);
});

test("desktop.ini is ignored wherever it appears", () => {
  assert.equal(reasonFor("desktop.ini"), "ignored-file");
  assert.equal(reasonFor("notes/desktop.ini"), "ignored-file");
});

test("a file named like an ignored folder is synced; only paths through such a folder are ignored", () => {
  assert.equal(included("notes/dist"), true);
  assert.equal(included("notes/node_modules"), true);
  assert.equal(reasonFor("notes/dist/x.md"), "ignored-directory");
});

test("backslash paths from Windows are matched the same as slash paths", () => {
  assert.equal(reasonFor("notes\\node_modules\\a.md"), "ignored-directory");
  assert.equal(reasonFor("notes\\.git\\config"), "ignored-directory");
  assert.equal(included("notes\\a.md"), true);
});

test("a leading slash or ./ does not hide an ignored folder", () => {
  assert.equal(reasonFor("/node_modules/a.js"), "ignored-directory");
  assert.equal(reasonFor("./dist/a.js"), "ignored-directory");
});

test("an empty or '.' path is an invalid path, not an ignored file", () => {
  assert.equal(reasonFor(""), "invalid-path");
  assert.equal(reasonFor("."), "invalid-path");
  assert.equal(reasonFor("./"), "invalid-path");
});

test("size: exactly the cap is kept, one byte over is skipped as too large", () => {
  assert.equal(included("papers/scan.pdf", GIT_SYNC_LIMITS.maxFileBytes), true);
  assert.equal(reasonFor("papers/scan.pdf", GIT_SYNC_LIMITS.maxFileBytes + 1), "too-large");
});

test("size: a cap can be passed in, so the rule is testable without a 25 MB fixture", () => {
  assert.equal(reasonFor("notes/a.md", 11, 10), "too-large");
  assert.equal(included("notes/a.md", 10, 10), true);
});

test("size: an empty file is kept", () => {
  assert.equal(included("notes/empty.md", 0), true);
});

test("size: a negative or non-finite size is not trusted, so the file is skipped", () => {
  assert.equal(reasonFor("notes/a.md", -1), "too-large");
  assert.equal(reasonFor("notes/a.md", Number.NaN), "too-large");
});

test("ignore rules win over size: an ignored path is reported as ignored even when it is also huge", () => {
  assert.equal(reasonFor("node_modules/big.bin", 100 * MB), "ignored-directory");
});

test("isUnderIgnoredFolder is true only for paths below an ignored folder, so the status walk can skip them", () => {
  assert.equal(isUnderIgnoredFolder("node_modules/left-pad/index.js"), true);
  assert.equal(isUnderIgnoredFolder("node_modules/left-pad"), true);
  assert.equal(isUnderIgnoredFolder("node_modules"), false);
  assert.equal(isUnderIgnoredFolder("notes/dist"), false);
  assert.equal(isUnderIgnoredFolder("notes/a.md"), false);
  assert.equal(isUnderIgnoredFolder(".weaveforge/x.db"), true);
});
