import { test } from "node:test";
import assert from "node:assert/strict";
import { addListMembership, readMemberFields, removeListMembership } from "../member-frontmatter";

const L = "[[review--l1.list]]";
const M = "[[other--l2.list]]";
const NOTE = "---\nweaveforge-id: n1\ntitle: Kept\n---\nBody line\n";

test("no frontmatter or no member keys reads as no lists", () => {
  assert.deepEqual(readMemberFields("Just a body\n"), { lists: [], listNotes: {} });
  assert.deepEqual(readMemberFields(NOTE), { lists: [], listNotes: {} });
});

test("reads lists and list-notes from the frontmatter", () => {
  const text = `---\nlists: ["${L}", "${M}"]\nlist-notes: {"${L}": "key"}\n---\nBody\n`;
  assert.deepEqual(readMemberFields(text), { lists: [L, M], listNotes: { [L]: "key" } });
});

test("an unparseable lists value reads as no lists, and a write refuses to overwrite it", () => {
  const text = "---\nlists:\n  - \"[[x]]\"\n---\nBody\n";
  assert.deepEqual(readMemberFields(text), { lists: [], listNotes: {} });
  assert.throws(() => addListMembership(text, L));
});

test("add puts lists and list-notes in place and keeps every other line byte for byte", () => {
  const out = addListMembership(NOTE, L, "key");
  assert.equal(out, `---\nweaveforge-id: n1\ntitle: Kept\nlists: ["${L}"]\nlist-notes: {"${L}":"key"}\n---\nBody line\n`);
  assert.deepEqual(readMemberFields(out), { lists: [L], listNotes: { [L]: "key" } });
});

test("add twice is idempotent, and a note-less add clears that list's note", () => {
  const once = addListMembership(NOTE, L, "key");
  assert.equal(addListMembership(once, L, "key"), once);
  const cleared = addListMembership(once, L);
  assert.deepEqual(readMemberFields(cleared), { lists: [L], listNotes: {} });
});

test("add to a file with no frontmatter adds a block in front of the body", () => {
  const out = addListMembership("Plain body\n", L);
  assert.equal(out, `---\nlists: ["${L}"]\n---\nPlain body\n`);
});

test("remove drops that list and its note, keeps the others, and drops the lines when none are left", () => {
  const both = addListMembership(addListMembership(NOTE, L, "key"), M);
  const without = removeListMembership(both, L);
  assert.deepEqual(readMemberFields(without), { lists: [M], listNotes: {} });
  assert.equal(removeListMembership(without, M), NOTE);
});
