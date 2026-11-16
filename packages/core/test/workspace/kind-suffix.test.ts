import { rust } from "../../src/shared/rust.js";
import assert from "node:assert/strict";
import test from "node:test";


test("every built path spells its kind into the filename", () => {
  assert.match(rust().flatPath("paper", "p1", "Attention"), /\.paper\.md$/);
  assert.match(rust().logPath("l1", "2026-03-14"), /\.log\.md$/);
  assert.match(
    rust().treePaths([{ id: "s1", title: "Results" }], "report_section").get("s1")!,
    /\.report\.md$/,
  );
});

test("a suffix is read back off the path, and an unknown one is not invented", () => {
  assert.equal(rust().parseKindSuffix("notes/method--a1b2c3.note.md"), "vault_page");
  assert.equal(rust().parseKindSuffix("report/results.report.md"), "report_section");
  assert.equal(rust().parseKindSuffix("notes/plain.md"), null);
  assert.equal(rust().parseKindSuffix("notes/holiday.snapshot.md"), null);
});

test("the title never keeps the suffix, and a dotted title never loses part of itself", () => {
  assert.equal(rust().stripKindSuffix("method--a1b2c3.note.md"), "method--a1b2c3");
  assert.equal(rust().stripKindSuffix("plain.md"), "plain");
  // "v2" is not a kind, so it belongs to the title.
  assert.equal(rust().stripKindSuffix("draft.v2.md"), "draft.v2");
});

test("a folder written before suffixes existed still imports", () => {
  const parsed = rust().parseWorkspaceFolder({ "notes/hand-written.md": "Typed into the folder." });

  assert.equal(parsed[0]!.type, "vault_page");
  assert.equal(parsed[0]!.title, "hand-written");
});

test("the directory outranks the suffix, because a moved file is where it sits", () => {
  const parsed = rust().parseWorkspaceFolder({ "notes/misfiled.paper.md": "Body." });

  assert.equal(parsed[0]!.type, "vault_page");
  assert.equal(parsed[0]!.title, "misfiled");
});

test("a suffix rescues a file no directory speaks for", () => {
  const parsed = rust().parseWorkspaceFolder({ "inbox/idea.note.md": "Body." });

  assert.equal(parsed[0]!.type, "vault_page");
  assert.equal(parsed[0]!.title, "idea");
});
