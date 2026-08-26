import assert from "node:assert/strict";
import test from "node:test";
import {
  flatPath,
  logPath,
  parseKindSuffix,
  parseWorkspaceFolder,
  stripKindSuffix,
  treePaths,
} from "../../src/index.js";

test("every built path spells its kind into the filename", () => {
  assert.match(flatPath("paper", "p1", "Attention"), /\.paper\.md$/);
  assert.match(logPath("l1", "2026-03-14"), /\.log\.md$/);
  assert.match(
    treePaths([{ id: "s1", title: "Results" }], "report_section").get("s1")!,
    /\.report\.md$/,
  );
});

test("a suffix is read back off the path, and an unknown one is not invented", () => {
  assert.equal(parseKindSuffix("notes/method--a1b2c3.note.md"), "vault_page");
  assert.equal(parseKindSuffix("report/results.report.md"), "report_section");
  assert.equal(parseKindSuffix("notes/plain.md"), null);
  assert.equal(parseKindSuffix("notes/holiday.snapshot.md"), null);
});

test("the title never keeps the suffix, and a dotted title never loses part of itself", () => {
  assert.equal(stripKindSuffix("method--a1b2c3.note.md"), "method--a1b2c3");
  assert.equal(stripKindSuffix("plain.md"), "plain");
  // "v2" is not a kind, so it belongs to the title.
  assert.equal(stripKindSuffix("draft.v2.md"), "draft.v2");
});

test("a folder written before suffixes existed still imports", () => {
  const parsed = parseWorkspaceFolder({ "notes/hand-written.md": "Typed into the folder." });

  assert.equal(parsed[0]!.type, "vault_page");
  assert.equal(parsed[0]!.title, "hand-written");
});

test("the directory outranks the suffix, because a moved file is where it sits", () => {
  const parsed = parseWorkspaceFolder({ "notes/misfiled.paper.md": "Body." });

  assert.equal(parsed[0]!.type, "vault_page");
  assert.equal(parsed[0]!.title, "misfiled");
});

test("a suffix rescues a file no directory speaks for", () => {
  const parsed = parseWorkspaceFolder({ "inbox/idea.note.md": "Body." });

  assert.equal(parsed[0]!.type, "vault_page");
  assert.equal(parsed[0]!.title, "idea");
});
