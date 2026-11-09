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

// Literal values: the TS policy is gone, so these pin the Rust git sync policy.
test("isUnderIgnoredFolder and decideGitSyncPath give the git sync verdicts", () => {
  assert.equal(rs.isUnderIgnoredFolder("node_modules/left-pad/index.js"), true);
  assert.equal(rs.isUnderIgnoredFolder("notes/a.md"), false);
  assert.equal(rs.isUnderIgnoredFolder("notes/dist"), false);
  assert.deepEqual(rs.decideGitSyncPath("notes/a.md", 10), { include: true });
  assert.deepEqual(rs.decideGitSyncPath("a.aux", 1), { include: false, reason: "ignored-file" });
  assert.deepEqual(rs.decideGitSyncPath("a.md", 25 * 1024 * 1024 + 1), { include: false, reason: "too-large" });
  assert.deepEqual(rs.decideGitSyncPath("", 1), { include: false, reason: "invalid-path" });
});

test("describePull and describePush match the TS descriptions", () => {
  for (const result of PULL_RESULTS) {
    assert.equal(rs.describePull(result), ts.describePull(result), `pull ${JSON.stringify(result)}`);
  }
  for (const result of PUSH_RESULTS) {
    assert.equal(rs.describePush(result), ts.describePush(result), `push ${JSON.stringify(result)}`);
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

const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const notePath = "notes/n--111111.note.md";
const noteText = (extra: string, body: string) =>
  `---\nweaveforge-id: ${NOTE_ID}\nweaveforge-type: vault_page\ntitle: T\n${extra}---\n${body}`;

test("vaultPageBase and vaultPageSide read a note and give null for a paper", () => {
  const body = "line 1\nline 2\n";
  const text = noteText("status: done\n", body);
  const side = rs.vaultPageSide(notePath, text);
  assert.equal(side?.body, body);
  assert.equal(side?.fields.title, "T");
  assert.equal(side?.fields.status, "done");
  const base = rs.vaultPageBase(notePath, text);
  assert.equal(base?.bodyDigest, ts.digestText(body));
  assert.equal(base?.fields.status, "done");
  const paper = `---\nweaveforge-id: ${NOTE_ID}\nweaveforge-type: paper\ntitle: P\n---\nsummary`;
  assert.equal(rs.vaultPageBase(notePath, paper), null);
  assert.equal(rs.vaultPageSide(notePath, paper), null);
});

test("mergeVaultPage takes a field only one side moved and reports one both moved", () => {
  const base = { fields: { title: "T", status: "a" }, bodyDigest: rs.vaultPageBase(notePath, noteText("status: a\n", "body\n"))!.bodyDigest };
  const onlyFolder = rs.mergeVaultPage(base, { fields: { title: "T", status: "b" }, body: "body\n" }, { fields: { title: "T", status: "a" }, body: "body\n" });
  assert.equal(onlyFolder.fields.status, "b");
  assert.deepEqual(onlyFolder.conflicts, []);
  const both = rs.mergeVaultPage(base, { fields: { title: "T", status: "b" }, body: "body\n" }, { fields: { title: "T", status: "c" }, body: "body\n" });
  assert.deepEqual(both.conflicts, [{ field: "status", base: "a", local: "b", remote: "c" }]);
  assert.equal(both.fields.status, "c");
});

test("mergeVaultPage takes the body only the folder changed", () => {
  const base = { fields: { title: "T" }, bodyDigest: rs.vaultPageBase(notePath, noteText("", "body\n"))!.bodyDigest };
  const merged = rs.mergeVaultPage(base, { fields: { title: "T" }, body: "new\n" }, { fields: { title: "T" }, body: "body\n" });
  assert.equal(merged.body, "new\n");
  assert.deepEqual(merged.conflicts, []);
});

test("writeFrontmatter writes keys in order, quotes what needs it, drops undefined and empty", () => {
  assert.equal(
    rs.writeFrontmatter({ title: "T", tags: ["a", "b c"], n: 0, flag: false, skip: undefined, empty: [] }, "body\n"),
    '---\ntitle: T\ntags: [a, "b c"]\nn: 0\nflag: false\n---\nbody\n',
  );
  assert.equal(
    rs.writeFrontmatter({ a: "x: y", b: "#hash", c: "" }, ""),
    '---\na: "x: y"\nb: "#hash"\nc: ""\n---\n',
  );
});

test("readFrontmatter reads flow lists and the body after the fence", () => {
  const parsed = rs.readFrontmatter("---\ntags: [a, b]\ntitle: T\n---\nbody\n");
  assert.deepEqual(parsed.frontmatter.tags, ["a", "b"]);
  assert.equal(parsed.frontmatter.title, "T");
  assert.equal(parsed.body, "body\n");
  assert.deepEqual(rs.readFrontmatter("Just prose.").frontmatter, {});
  assert.equal(rs.readFrontmatter("Just prose.").body, "Just prose.");
});

test("a quoted value written by writeFrontmatter reads back to the same string", () => {
  const text = rs.writeFrontmatter({ quote: 'say "hi"', back: "a\\b" }, "");
  const parsed = rs.readFrontmatter(text);
  assert.equal(parsed.frontmatter.quote, 'say "hi"');
  assert.equal(parsed.frontmatter.back, "a\\b");
});

// Literal expectations for the Rust rules that replaced the deleted TS helpers.
// The removed parity tests compared Rust with TS over these same inputs.

test("changedSide reads who moved from the three digests", () => {
  assert.equal(rs.changedSide({ base: "a", folder: "a", workspace: "a" }), "neither");
  assert.equal(rs.changedSide({ base: "a", folder: "b", workspace: "a" }), "folder");
  assert.equal(rs.changedSide({ base: "a", folder: "a", workspace: "b" }), "workspace");
  assert.equal(rs.changedSide({ base: "a", folder: "b", workspace: "c" }), "both");
  // Both sides arriving at the same text is agreement, not a conflict.
  assert.equal(rs.changedSide({ base: "a", folder: "b", workspace: "b" }), "neither");
  assert.equal(rs.changedSide({ base: "", folder: "", workspace: "a" }), "workspace");
});

test("changedSide is unknown when a side is missing, unless folder and workspace agree", () => {
  assert.equal(rs.changedSide({}), "unknown");
  assert.equal(rs.changedSide({ base: "a" }), "unknown");
  assert.equal(rs.changedSide({ folder: "x", workspace: "y" }), "unknown");
  assert.equal(rs.changedSide({ base: "x", workspace: "y" }), "unknown");
  assert.equal(rs.changedSide({ base: "x", folder: "y" }), "unknown");
  assert.equal(rs.changedSide({ folder: "aa", workspace: "aa" }), "neither");
  assert.equal(rs.changedSide({ folder: "aa", workspace: "bb" }), "unknown");
});

test("stampWorkspaceId adds the id line, or returns null when an id is already there", () => {
  assert.equal(rs.stampWorkspaceId("body", "id-1"), "---\nweaveforge-id: id-1\n---\n\nbody");
  assert.equal(rs.stampWorkspaceId("", "id-1"), "---\nweaveforge-id: id-1\n---\n\n");
  assert.equal(
    rs.stampWorkspaceId("---\ntitle: x\n---\nbody", "id-1"),
    "---\nweaveforge-id: id-1\ntitle: x\n---\nbody",
  );
  assert.equal(
    rs.stampWorkspaceId("---\r\ntitle: x\r\n---\r\nbody", "id-1"),
    "---\r\nweaveforge-id: id-1\r\ntitle: x\r\n---\r\nbody",
  );
  assert.equal(rs.stampWorkspaceId("---\nweaveforge-id: old\n---\n", "id-1"), null);
  assert.equal(
    rs.stampWorkspaceId("---\nunterminated", "id-1"),
    "---\nweaveforge-id: id-1\n---\n\n---\nunterminated",
  );
  assert.equal(
    rs.stampWorkspaceId("﻿---\ntitle: x\n---\n", "id-1"),
    "﻿---\nweaveforge-id: id-1\ntitle: x\n---\n",
  );
  assert.equal(rs.stampWorkspaceId("---\n---\n", "id-1"), "---\nweaveforge-id: id-1\n---\n");
});

test("mergeHunks composes the body from one pick per hunk, defaulting to ours", () => {
  assert.equal(rs.mergeHunks("a\nb\nc", "a\nB\nc", {}), "a\nb\nc");
  assert.equal(rs.mergeHunks("a\nb\nc", "a\nB\nc", { 0: "theirs" }), "a\nB\nc");
  assert.equal(rs.mergeHunks("a\nb\nc", "a\nB\nc", { 0: "both" }), "a\nb\nB\nc");
  assert.equal(rs.mergeHunks("a\nb\nc", "a\nB\nc", { 1: "theirs" }), "a\nb\nc");
  assert.equal(rs.mergeHunks("a\nb", "c\nd", { 0: "theirs" }), "c\nd");
  assert.equal(rs.mergeHunks("a\nb", "c\nd", { 0: "both" }), "a\nb\nc\nd");
  assert.equal(rs.mergeHunks("a\r\nb", "a\nB", {}), "a\nb");
});

test("writeConflictMarkers wraps only the differing lines", () => {
  assert.equal(
    rs.writeConflictMarkers("a\nb\nc", "a\nB\nc"),
    "a\n<<<<<<< this app\nb\n=======\nB\n>>>>>>> the folder\nc",
  );
  assert.equal(rs.writeConflictMarkers("", "x"), "<<<<<<< this app\n\n=======\nx\n>>>>>>> the folder");
  assert.equal(
    rs.writeConflictMarkers("a\nb", "c\nd"),
    "<<<<<<< this app\na\nb\n=======\nc\nd\n>>>>>>> the folder",
  );
  assert.equal(rs.writeConflictMarkers("a", "a"), "a");
});
