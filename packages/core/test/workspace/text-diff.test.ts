import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKER_OURS,
  MARKER_THEIRS,
  diffBody,
  hasConflictMarkers,
  mergeHunks,
  parseWorkspaceFolder,
  diffWorkspace,
  writeConflictMarkers,
} from "../../src/index.js";

const OURS = ["# Method", "", "We ran three seeds.", "The effect held.", ""].join("\n");
const THEIRS = ["# Method", "", "We ran five seeds.", "The effect held.", "It was smaller.", ""].join("\n");

test("a body diff is hunks of disagreeing lines, with the agreed lines between them", () => {
  const { lines, hunks } = diffBody(OURS, THEIRS);

  // Two disagreements: the seed count, and the sentence theirs adds.
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0]!.ours, ["We ran three seeds."]);
  assert.deepEqual(hunks[0]!.theirs, ["We ran five seeds."]);
  assert.deepEqual(hunks[1]!.ours, []);
  assert.deepEqual(hunks[1]!.theirs, ["It was smaller."]);
  // The agreed lines are the spine, and they are never a choice.
  assert.ok(lines.some((line) => line.op === "same" && line.text === "# Method"));
});

test("taking one hunk leaves the other as ours", () => {
  // The whole point of per-hunk: keep their seed count, keep our shorter ending.
  const merged = mergeHunks(OURS, THEIRS, { 0: "theirs" });

  assert.match(merged, /We ran five seeds\./);
  assert.doesNotMatch(merged, /It was smaller\./);
  assert.match(merged, /We ran five seeds\.\nThe effect held\.\n$/);
});

test("an unchosen hunk keeps ours, and both keeps both", () => {
  assert.equal(mergeHunks(OURS, THEIRS), OURS);
  const both = mergeHunks(OURS, THEIRS, { 0: "both" });
  assert.match(both, /We ran three seeds\.\nWe ran five seeds\./);
});

test("a body neither side touched has no hunks and merges to itself", () => {
  const { hunks } = diffBody(OURS, OURS);
  assert.deepEqual(hunks, []);
  assert.equal(mergeHunks(OURS, OURS), OURS);
});

test("markers are written both ways and read back", () => {
  const marked = writeConflictMarkers(OURS, THEIRS);

  assert.ok(marked.startsWith(MARKER_OURS));
  assert.ok(marked.includes(`\n${MARKER_THEIRS}`));
  assert.equal(hasConflictMarkers(marked), true);
  // The two copies are both in there, in full.
  assert.match(marked, /We ran three seeds\./);
  assert.match(marked, /We ran five seeds\./);
});

test("a setext heading is not a conflict marker", () => {
  // `=======` under a line is ordinary markdown, and a vault full of headings
  // must not read as a vault full of conflicts.
  const heading = ["Chapter 3", "=======", "Body text.", ""].join("\n");

  assert.equal(hasConflictMarkers(heading), false);
  // A stray closing label with no opening one is not a conflict either.
  assert.equal(hasConflictMarkers(`text\n${MARKER_THEIRS}\n`), false);
});

test("a file holding markers is a conflict however its id reads, and never an update", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const marked = writeConflictMarkers(OURS, THEIRS);
  const parsed = parseWorkspaceFolder({
    [`notes/method--a1b2c3.note.md`]: [
      "---",
      `weaveforge-id: ${id}`,
      "weaveforge-type: vault_page",
      "title: Method",
      "---",
      marked,
    ].join("\n"),
  });
  const diff = diffWorkspace(parsed, [{ id, type: "vault_page", title: "Method", body: OURS }], {
    origin: () => "folder",
  });

  assert.equal(diff.entries[0]!.action, "conflict");
  assert.equal(diff.entries[0]!.kind, "markers");
  assert.match(diff.entries[0]!.reason ?? "", /conflict markers/);
});
