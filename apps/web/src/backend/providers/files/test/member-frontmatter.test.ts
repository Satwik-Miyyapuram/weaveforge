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

test("an unparseable lists value throws on read and on write; it never reads as empty", () => {
  const broken = `---\nlists: ["${L}"\n---\nBody\n`;
  assert.throws(() => readMemberFields(broken), /lists/);
  assert.throws(() => addListMembership(broken, L));
  const badQuote = `---\nlists:\n  - "${L}\n---\nBody\n`;
  assert.throws(() => readMemberFields(badQuote), /lists/);
  assert.throws(() => removeListMembership(badQuote, L));
});

test("plain scalars in block items read as their text: a bare word and an unquoted link", () => {
  const text = `---\nlists:\n  - reading\n  - ${L}\n---\nBody\n`;
  assert.deepEqual(readMemberFields(text).lists, ["reading", L]);
});

test("reads the block mapping Obsidian writes for list-notes, and keeps block style on rewrite", () => {
  const N = "[[new--l3.list]]";
  const obsidian = `---\nweaveforge-id: n1\nlists:\n  - "${L}"\n  - ${M}\nlist-notes:\n  "${L}": key\n  "${M}": "second, quoted"\n---\nBody line\n`;
  assert.deepEqual(readMemberFields(obsidian), { lists: [L, M], listNotes: { [L]: "key", [M]: "second, quoted" } });
  assert.equal(
    removeListMembership(obsidian, L),
    `---\nweaveforge-id: n1\nlists:\n  - ${M}\nlist-notes:\n  "${M}": "second, quoted"\n---\nBody line\n`,
  );
  assert.deepEqual(readMemberFields(addListMembership(obsidian, N)).lists, [L, M, N]);
});

test("an unparseable block is never rewritten: add and remove both throw", () => {
  const openItem = `---\nlists:\n  - "${L}"\n  - "open\n---\nBody\n`;
  assert.throws(() => addListMembership(openItem, M));
  assert.throws(() => removeListMembership(openItem, L));
  const nested = "---\nlists:\n  nested: thing\n---\nBody\n";
  assert.throws(() => addListMembership(nested, M));
});

test("reads a YAML block sequence (indented or at the key's column) as well as a flow sequence", () => {
  const indented = `---\nlists:\n  - "${L}"\n  - "${M}"\n---\nBody\n`;
  assert.deepEqual(readMemberFields(indented).lists, [L, M]);
  const flush = `---\nlists:\n- "${L}"\n- "${M}"\ntitle: Kept\n---\nBody\n`;
  assert.deepEqual(readMemberFields(flush).lists, [L, M]);
  assert.deepEqual(readMemberFields(`---\nlists: ["${L}"]\n---\nBody\n`).lists, [L]);
});

test("rewriting a block-sequence list keeps the block style, removes only the dropped item's line", () => {
  const text = `---\nlists:\n- "${L}"\n- "${M}"\ntitle: Kept\n---\nBody\n`;
  const without = removeListMembership(text, L);
  assert.equal(without, `---\nlists:\n- "${M}"\ntitle: Kept\n---\nBody\n`);
  assert.deepEqual(readMemberFields(without).lists, [M]);
  assert.equal(removeListMembership(without, M), "---\ntitle: Kept\n---\nBody\n");
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
