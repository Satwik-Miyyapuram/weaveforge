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

const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const notePath = "notes/n--111111.note.md";
const noteText = (extra: string, body: string) =>
  `---\nweaveforge-id: ${NOTE_ID}\nweaveforge-type: vault_page\ntitle: T\n${extra}---\n${body}`;
const NOTE_TEXTS = [
  noteText("", "body\n"),
  noteText("tags: [a, b]\n", "body\n"),
  noteText("status: done\nupdated_at: 2024-01-01T00:00:00Z\n", "line 1\nline 2\n"),
  noteText("n: 1.5\nflag: true\n", ""),
  noteText("", "\r\nwindows\r\n"),
  `﻿${noteText("", "bom\n")}`,
  "no frontmatter at all",
  `---\nweaveforge-id: ${NOTE_ID}\nweaveforge-type: paper\ntitle: P\n---\nsummary`,
];

test("vaultPageBase and vaultPageSide match the TS", () => {
  for (const text of NOTE_TEXTS) {
    assert.deepEqual(
      rs.vaultPageBase(notePath, text),
      ts.vaultPageBase(notePath, text),
      `base ${JSON.stringify(text)}`,
    );
    assert.deepEqual(
      rs.vaultPageSide(notePath, text),
      ts.vaultPageSide(notePath, text),
      `side ${JSON.stringify(text)}`,
    );
  }
});

const FIELD_VALUES: unknown[] = [
  undefined,
  null,
  "a",
  "b",
  1,
  1.0,
  true,
  ["x"],
  "2024-01-01T00:00:00Z",
  "2024-01-01T00:00:00.000Z",
];
const withField = (value: unknown): Record<string, unknown> => ({
  title: "T",
  ...(value === undefined ? {} : { f: value }),
});

/**
 * A merge with absent values spelled one way. The Rust sends JSON, so an absent
 * conflict side crosses as `null` and a field both sides dropped is left out,
 * where the TS keeps it as `undefined`. The conflict card shows `null` and
 * `undefined` alike, and the frontmatter writer skips `undefined` keys.
 */
function absentAsUndefined<
  T extends {
    fields: Record<string, unknown>;
    conflicts: Array<{ base?: unknown; local?: unknown; remote?: unknown }>;
  },
>(merged: T): T {
  return {
    ...merged,
    fields: Object.fromEntries(Object.entries(merged.fields).filter(([, value]) => value !== undefined)),
    conflicts: merged.conflicts.map((c) => ({
      ...c,
      base: c.base ?? undefined,
      local: c.local ?? undefined,
      remote: c.remote ?? undefined,
    })),
  };
}

test("mergeVaultPage matches the TS", () => {
  for (const b of FIELD_VALUES) {
    for (const l of FIELD_VALUES) {
      for (const r of FIELD_VALUES) {
        const base = {
          fields: withField(b),
          bodyDigest: ts.digestText("body"),
        };
        const folder = { fields: withField(l), body: "body" };
        const workspace = { fields: withField(r), body: "body" };
        assert.deepEqual(
          absentAsUndefined(rs.mergeVaultPage(base, folder, workspace)),
          absentAsUndefined(ts.mergeVaultPage(base, folder, workspace)),
          `fields ${JSON.stringify([b, l, r])}`,
        );
      }
    }
  }

  const BODIES = ["body", "new", "other"];
  const base = {
    fields: withField(undefined),
    bodyDigest: ts.digestText("body"),
  };
  for (const folderBody of BODIES) {
    for (const workspaceBody of BODIES) {
      const folder = { fields: withField(undefined), body: folderBody };
      const workspace = { fields: withField(undefined), body: workspaceBody };
      assert.deepEqual(
        rs.mergeVaultPage(base, folder, workspace),
        ts.mergeVaultPage(base, folder, workspace),
        `bodies ${JSON.stringify([folderBody, workspaceBody])}`,
      );
    }
  }
});

const HUNK_PAIRS: Array<[string, string]> = [
  ["a\nb\nc", "a\nB\nc"],
  ["", "x"],
  ["x", ""],
  ["a\nb", "c\nd"],
  ["1\n2\n3\n4\n5", "1\nX\n3\nY\n5"],
  ["a\r\nb", "a\nB"],
];
const HUNK_PICKS: Array<Readonly<Record<number, "ours" | "theirs" | "both">>> = [
  {},
  { 0: "theirs" },
  { 0: "both" },
  { 1: "theirs" },
  { 0: "theirs", 1: "both" },
  { 5: "theirs" },
];

test("mergeHunks matches the TS", () => {
  for (const [ours, theirs] of HUNK_PAIRS) {
    for (const picks of HUNK_PICKS) {
      assert.deepEqual(
        rs.mergeHunks(ours, theirs, picks),
        ts.mergeHunks(ours, theirs, picks),
        `input ${JSON.stringify([ours, theirs, picks])}`,
      );
    }
  }
});

test("writeConflictMarkers matches the TS", () => {
  for (const [ours, theirs] of HUNK_PAIRS) {
    assert.deepEqual(
      rs.writeConflictMarkers(ours, theirs),
      ts.writeConflictMarkers(ours, theirs),
      `input ${JSON.stringify([ours, theirs])}`,
    );
  }
});

test("readFrontmatter matches the TS", () => {
  const texts = [
    ...NOTE_TEXTS,
    '---\na: "q\\"uote"\n---\nx',
    "---\nk: 'it''s'\n---\n",
    "---\n---\n",
    "---\nnot closed",
  ];
  for (const text of texts) {
    assert.deepEqual(rs.readFrontmatter(text), ts.readFrontmatter(text), `input ${JSON.stringify(text)}`);
  }
});

test("writeFrontmatter matches the TS", () => {
  const FIELD_MAPS: Array<Record<string, ts.FrontmatterValue | undefined>> = [
    {},
    { title: "T" },
    { a: "x: y", b: "#hash", c: "" },
    { n: 0, m: -1.5, t: true, f: false },
    { tags: ["a", "b c"], empty: [] },
    { skip: undefined, keep: "k" },
    { quote: 'say "hi"', back: "a\\b" },
  ];
  for (const fields of FIELD_MAPS) {
    for (const body of ["", "body\n"]) {
      assert.deepEqual(
        rs.writeFrontmatter(fields, body),
        ts.writeFrontmatter(fields, body),
        `input ${JSON.stringify([fields, body])}`,
      );
    }
  }
});
