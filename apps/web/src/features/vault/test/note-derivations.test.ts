import { test } from "node:test";
import assert from "node:assert/strict";
import type { VaultPageSummary } from "@weaveforge/core";

import { noteBacklinks, noteTags, scopeNotes } from "../application/note-derivations";

function note(id: string, title: string, bodyPreview = ""): VaultPageSummary {
  return { id, title, bodyPreview, sortOrder: 0, createdAt: "", updatedAt: "" } as VaultPageSummary;
}

const a = note("a", "Alpha", "see [[Beta]] #x");
const b = note("b", "Beta", "#y #x");
const c = note("c", "Gamma", "links [[beta|alias]]");
const all = [a, b, c];

test("backlinks are the other notes that link to the selected title, case-folded (34-25)", () => {
  assert.deepEqual(noteBacklinks(all, "b"), [
    { id: "a", title: "Alpha" },
    { id: "c", title: "Gamma" },
  ]);
});

test("no selection or an unknown id has no backlinks (34-25)", () => {
  assert.deepEqual(noteBacklinks(all, null), []);
  assert.deepEqual(noteBacklinks(all, "missing"), []);
});

test("a note does not backlink itself (34-25)", () => {
  const self = note("s", "Self", "[[Self]]");
  assert.deepEqual(noteBacklinks([self], "s"), []);
});

test("tags are distinct and sorted across notes (34-25)", () => {
  assert.deepEqual(noteTags(all), ["x", "y"]);
  assert.deepEqual(noteTags([]), []);
});

test("no filters keep every note, in order (34-25)", () => {
  assert.deepEqual(scopeNotes(all, { listFilter: [], tagFilter: [], membership: new Map() }), all);
});

test("a list filter keeps notes in any chosen list (34-25)", () => {
  const membership = new Map([["L1", new Set(["a"])], ["L2", new Set(["c"])]]);
  const out = scopeNotes(all, { listFilter: ["L1", "L2"], tagFilter: [], membership });
  assert.deepEqual(out.map((n) => n.id), ["a", "c"]);
});

test("an unknown list matches nothing (34-25)", () => {
  const out = scopeNotes(all, { listFilter: ["gone"], tagFilter: [], membership: new Map() });
  assert.deepEqual(out, []);
});

test("tag and list filters both apply (34-25)", () => {
  const membership = new Map([["L1", new Set(["a", "b"])]]);
  const out = scopeNotes(all, { listFilter: ["L1"], tagFilter: ["y"], membership });
  assert.deepEqual(out.map((n) => n.id), ["b"]);
});
