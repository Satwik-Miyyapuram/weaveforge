import { before, test } from "node:test";
import assert from "node:assert/strict";

import type { DuplicateSource } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

const note = (over: Partial<DuplicateSource> & { id?: string } = {}): DuplicateSource & { id?: string } => ({
  kind: "vault_page",
  id: "n2",
  title: "Sampling",
  body: "# Sampling\n\nWhole body.",
  hydrated: true,
  parentId: "n1",
  ...over,
});

test("a note duplicates into its own folder with its whole body", () => {
  assert.deepEqual(readyCore().duplicatePlan(note(), [note()]), {
    title: "Sampling (copy)",
    parentId: "n1",
    body: "# Sampling\n\nWhole body.",
  });
});

test("an ink note keeps its ink body; a root note stays at the root", () => {
  // A root document has no parentId key at all, not an undefined one.
  const ink = note({ kind: "ink_page", body: "ink-meta\n---\ntext", parentId: undefined });
  assert.deepEqual(readyCore().duplicatePlan(ink, [ink]), { title: "Sampling (copy)", body: "ink-meta\n---\ntext" });
});

test("the copy's title skips one any note already has, in any folder", () => {
  const notes = [
    note(),
    note({ id: "c1", title: "Sampling (copy)" }),
    note({ id: "c2", title: "sampling (copy 2)", parentId: "n9" }),
  ];
  assert.equal(readyCore().duplicatePlan(note(), notes)?.title, "Sampling (copy 3)");
  // Titles are compared by the core's title key, so spacing and case do not matter.
  const spaced = [note(), note({ id: "c1", title: "Sampling  (copy)" })];
  assert.equal(readyCore().duplicatePlan(note(), spaced)?.title, "Sampling (copy 2)");
  // A paper with that title is not a note's clash.
  assert.equal(
    readyCore().duplicatePlan(note(), [note(), note({ kind: "paper", title: "Sampling (copy)" })])?.title,
    "Sampling (copy)",
  );
});

test("only a note is duplicated, and only once its whole body is loaded", () => {
  assert.equal(readyCore().duplicatePlan(note({ kind: "paper" }), []), null);
  assert.equal(readyCore().duplicatePlan(note({ kind: "report_section" }), []), null);
  // A preview body is the first 320 characters; copying it would cut the note.
  assert.equal(readyCore().duplicatePlan(note({ hydrated: false }), []), null);
  assert.equal(readyCore().duplicatePlan(undefined, []), null);
});
