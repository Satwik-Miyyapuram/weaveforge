import { test } from "node:test";
import assert from "node:assert/strict";

import { duplicatePlan } from "../application/duplicate-note";

const note = (over: Partial<NonNullable<Parameters<typeof duplicatePlan>[0]>> & { id?: string } = {}) => ({
  kind: "vault_page",
  id: "n2",
  title: "Sampling",
  body: "# Sampling\n\nWhole body.",
  hydrated: true,
  parentId: "n1",
  ...over,
});

test("a note duplicates into its own folder with its whole body", () => {
  assert.deepEqual(duplicatePlan(note(), [note()]), {
    title: "Sampling (copy)",
    parentId: "n1",
    body: "# Sampling\n\nWhole body.",
  });
});

test("an ink note keeps its ink body; a root note stays at the root", () => {
  const ink = note({ kind: "ink_page", body: "ink-meta\n---\ntext", parentId: undefined });
  assert.deepEqual(duplicatePlan(ink, [ink]), { title: "Sampling (copy)", parentId: undefined, body: "ink-meta\n---\ntext" });
});

test("the copy's title skips one any note already has, in any folder", () => {
  const notes = [
    note(),
    note({ id: "c1", title: "Sampling (copy)" }),
    note({ id: "c2", title: "sampling (copy 2)", parentId: "n9" }),
  ];
  assert.equal(duplicatePlan(note(), notes)?.title, "Sampling (copy 3)");
  // Titles are compared by the key the caller gives (the core's normalizer).
  const spaced = [note(), note({ id: "c1", title: "Sampling  (copy)" })];
  const squash = (t: string) => t.toLowerCase().replace(/\s+/g, " ");
  assert.equal(duplicatePlan(note(), spaced, squash)?.title, "Sampling (copy 2)");
  // A paper with that title is not a note's clash.
  assert.equal(duplicatePlan(note(), [note(), note({ kind: "paper", title: "Sampling (copy)" })])?.title, "Sampling (copy)");
});

test("only a note is duplicated, and only once its whole body is loaded", () => {
  assert.equal(duplicatePlan(note({ kind: "paper" }), []), null);
  assert.equal(duplicatePlan(note({ kind: "report_section" }), []), null);
  // A preview body is the first 320 characters; copying it would cut the note.
  assert.equal(duplicatePlan(note({ hydrated: false }), []), null);
  assert.equal(duplicatePlan(undefined, []), null);
});
