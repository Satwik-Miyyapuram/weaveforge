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

test("markers wrap only conflicting hunks and preserve agreed context", () => {
  const marked = writeConflictMarkers(OURS, THEIRS);

  // The agreed heading stays at the top outside any marker.
  assert.ok(marked.startsWith("# Method\n\n<<<<<<< this app\nWe ran three seeds.\n=======\nWe ran five seeds.\n>>>>>>> the folder"));
  // Agreed text in the middle is outside markers too.
  assert.match(marked, />>>>>>> the folder\nThe effect held\.\n/);
  assert.equal(hasConflictMarkers(marked), true);
  assert.match(marked, /We ran three seeds\./);
  assert.match(marked, /We ran five seeds\./);
});

test("markers wrap the entire body when there is no agreed text", () => {
  const marked = writeConflictMarkers("All ours", "All theirs");
  assert.equal(marked, `${MARKER_OURS}\nAll ours\n=======\nAll theirs\n${MARKER_THEIRS}`);
  assert.equal(hasConflictMarkers(marked), true);
});

test("detects standard git conflict markers as well as app markers", () => {
  const gitMarker = ["<<<<<<< HEAD", "ours from git", "=======", "theirs from git", ">>>>>>> branch"].join("\n");
  assert.equal(hasConflictMarkers(gitMarker), true);

  const shortMarker = ["<<<<<<<", "foo", "=======", "bar", ">>>>>>>"].join("\n");
  assert.equal(hasConflictMarkers(shortMarker), true);
});

test("CRLF line endings normalize and diff without false line changes", () => {
  const oursCrlf = "# Title\r\n\r\nParagraph 1.\r\n";
  const theirsCrlf = "# Title\r\n\r\nParagraph 1.\r\n";
  const { hunks } = diffBody(oursCrlf, theirsCrlf);
  assert.deepEqual(hunks, []);

  const theirsEdited = "# Title\r\n\r\nParagraph 2.\r\n";
  const diff = diffBody(oursCrlf, theirsEdited);
  assert.equal(diff.hunks.length, 1);
  assert.deepEqual(diff.hunks[0]!.ours, ["Paragraph 1."]);
  assert.deepEqual(diff.hunks[0]!.theirs, ["Paragraph 2."]);
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
