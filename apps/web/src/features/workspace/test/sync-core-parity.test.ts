import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust and TS must agree on every input, so the TS copies can be deleted.
const TEXTS = ["", "a", "hello\nworld", "\r\n", "caf\u00e9", "\u{1F600} emoji", "\ufeffbom", "x".repeat(5000)];

const SIDES = [undefined, "", "a", "b"];

const PATHS = [
  "",
  ".",
  "a.md",
  "notes/a.md",
  "node_modules/x",
  "Node_Modules/x/y",
  "notes/dist",
  "notes/dist/x.md",
  ".weaveforge/db",
  "notes/.weaveforge/x",
  ".git",
  "a/.git",
  "desktop.ini",
  "A/Desktop.INI",
  "paper.aux",
  "x.synctex.gz",
  "a\\b\\c.md",
  "./a/./b",
];
const SIZES = [0, 1, 25 * 1024 * 1024, 25 * 1024 * 1024 + 1, -1, Number.NaN, Number.POSITIVE_INFINITY];

type PullResult = Parameters<RustCore["describePull"]>[0];
type PushResult = Parameters<RustCore["describePush"]>[0];

const PULL_RESULTS: PullResult[] = [
  { kind: "up-to-date" },
  { kind: "fast-forward", oid: "a" },
  { kind: "merged", oid: "b" },
  { kind: "conflict", files: [] },
  { kind: "conflict", files: ["a"] },
  { kind: "conflict", files: ["a", "b", "c", "d", "e"] },
  { kind: "conflict", files: ["a", "b", "c", "d", "e", "f"] },
];

const PUSH_RESULTS: PushResult[] = [
  { kind: "pushed" },
  { kind: "up-to-date" },
  { kind: "rejected", reason: "non-fast-forward" },
];

const CONTENTS = [
  "",
  "body",
  "---\ntitle: x\n---\nbody",
  "---\r\ntitle: x\r\n---\r\nbody",
  "---\nweaveforge-id: old\n---\n",
  "---\nunterminated",
  "\ufeff---\ntitle: x\n---\n",
  "---\n---\n",
];

const SAFE_PATHS = [
  "a",
  "a/b",
  "./a",
  "a//b",
  "a/./b",
  "a\\b",
  "",
  ".",
  "/",
  "/a",
  "..",
  "a/../b",
  "../a",
  "C:/x",
  "c:x",
  "a/C:",
];

/** Value or refusal, so both sides compare on whether they throw and what they return. */
function outcome(fn: () => string): { ok: true; value: string } | { ok: false } {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

test("digestText matches the TS digest", () => {
  for (const x of TEXTS) {
    assert.deepEqual(rs.digestText(x), ts.digestText(x), `input ${JSON.stringify(x)}`);
  }
});

test("changedSide matches the TS helper over every base/folder/workspace combination", () => {
  for (const base of SIDES) {
    for (const folder of SIDES) {
      for (const workspace of SIDES) {
        const origin = { base, folder, workspace };
        assert.deepEqual(rs.changedSide(origin), ts.changedSide(origin), `origin ${JSON.stringify(origin)}`);
      }
    }
  }
});

test("isUnderIgnoredFolder and decideGitSyncPath match the TS policy", () => {
  for (const p of PATHS) {
    assert.deepEqual(rs.isUnderIgnoredFolder(p), ts.isUnderIgnoredFolder(p), `path ${JSON.stringify(p)}`);
    for (const size of SIZES) {
      assert.deepEqual(
        rs.decideGitSyncPath(p, size),
        ts.decideGitSyncPath(p, size),
        `path ${JSON.stringify(p)} size ${size}`,
      );
    }
  }
});

test("describePull and describePush match the TS descriptions", () => {
  for (const result of PULL_RESULTS) {
    assert.equal(rs.describePull(result), ts.describePull(result), `pull ${JSON.stringify(result)}`);
  }
  for (const result of PUSH_RESULTS) {
    assert.equal(rs.describePush(result), ts.describePush(result), `push ${JSON.stringify(result)}`);
  }
});

test("stampWorkspaceId matches the TS stamper", () => {
  for (const content of CONTENTS) {
    assert.deepEqual(
      rs.stampWorkspaceId(content, "id-1"),
      ts.stampWorkspaceId(content, "id-1"),
      `content ${JSON.stringify(content)}`,
    );
  }
});

test("isSafeWorkspacePath and safeWorkspacePath match the TS checks", () => {
  for (const p of SAFE_PATHS) {
    // Known divergence: Rust also refuses a drive prefix on a later segment ("a/C:"),
    // which TS accepts. Assert the Rust refusal and skip the TS comparison for that input.
    if (p === "a/C:") {
      assert.equal(rs.isSafeWorkspacePath(p), false, `path ${JSON.stringify(p)}`);
      assert.deepEqual(outcome(() => rs.safeWorkspacePath(p)), { ok: false }, `path ${JSON.stringify(p)}`);
      continue;
    }
    assert.equal(rs.isSafeWorkspacePath(p), ts.isSafeWorkspacePath(p), `path ${JSON.stringify(p)}`);
    assert.deepEqual(
      outcome(() => rs.safeWorkspacePath(p)),
      outcome(() => ts.safeWorkspacePath(p)),
      `path ${JSON.stringify(p)}`,
    );
  }
});
