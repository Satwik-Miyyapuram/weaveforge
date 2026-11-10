import { before, test } from "node:test";
import assert from "node:assert/strict";

import type { WorkspaceTreeNode } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

const core = () => readyCore();

before(async () => {
  await loadTestCore();
});

/** A row with the fields the Rust side reads filled in, so a test can name only what it cares about. */
function bare(fields: Pick<WorkspaceTreeNode, "key" | "kind"> & Partial<WorkspaceTreeNode>): WorkspaceTreeNode {
  return { label: "", path: "", children: [], ...fields };
}

function tree() {
  return core().buildWorkspaceTree({
    projectRoot: "",
    notes: [
      { id: "n1", title: "Methods", parentId: undefined, folder: true },
      { id: "n2", title: "Sampling", parentId: "n1" },
      { id: "n3", title: "Sketch", parentId: "n1", kind: "ink_page" },
      { id: "n4", title: "Data", parentId: "n1", folder: true },
    ],
    papers: [{ id: "p1", title: "A paper", hasNote: false }],
    reportSections: [
      { id: "s1", title: "Intro", parentId: undefined },
      { id: "s2", title: "Background", parentId: "s1" },
    ],
  });
}

function find(nodes: readonly WorkspaceTreeNode[], key: string): WorkspaceTreeNode {
  for (const node of nodes) {
    if (node.key === key) return node;
    const inner = node.children.length ? findOr(node.children, key) : undefined;
    if (inner) return inner;
  }
  throw new Error(`no ${key}`);
}
function findOr(nodes: readonly WorkspaceTreeNode[], key: string): WorkspaceTreeNode | undefined {
  try {
    return find(nodes, key);
  } catch {
    return undefined;
  }
}

test("rules: only Notes and its folders hold notes and folders; a note holds nothing; Report takes sections; Papers nothing", () => {
  const roots = tree();
  assert.deepEqual(core().creatableUnder(find(roots, core().rootKey("notes"))), ["note", "folder"]);
  assert.deepEqual(core().creatableUnder(find(roots, "vault_page:n1")), ["note", "folder"]);
  assert.deepEqual(core().creatableUnder(find(roots, "vault_page:n4")), ["note", "folder"]);
  assert.deepEqual(core().creatableUnder(find(roots, "vault_page:n2")), [], "a note has no sub-notes");
  assert.deepEqual(core().creatableUnder(find(roots, "ink_page:n3")), [], "nor does an ink note");
  assert.deepEqual(core().creatableUnder(find(roots, core().rootKey("report"))), ["section"]);
  assert.deepEqual(core().creatableUnder(find(roots, "report_section:s2")), ["section"]);
  assert.deepEqual(core().creatableUnder(find(roots, "papers")), []);
  assert.deepEqual(core().creatableUnder(find(roots, "paper:p1")), []);
  assert.deepEqual(core().creatableUnder(bare({ key: "paper_pdf:p1", kind: "paper_pdf" })), []);
  assert.deepEqual(core().creatableUnder(bare({ key: "papers/p1", kind: "folder" })), []);
});

test("rename: notes and sections, never roots or papers", () => {
  const roots = tree();
  assert.equal(core().canRename(find(roots, "vault_page:n1")), true, "a folder");
  assert.equal(core().canRename(find(roots, "vault_page:n2")), true, "a note");
  assert.equal(core().canRename(find(roots, "report_section:s1")), true);
  assert.equal(core().canRename(find(roots, "paper:p1")), false);
  assert.equal(core().canRename(find(roots, "notes")), false);
  assert.equal(core().rootOf(bare({ key: "x", kind: "vault_page", isMember: true })), null);
});

test("creation target: the active note's folder, else the Notes root; a paper never", () => {
  const folders = new Set(["n1"]);
  assert.deepEqual(core().creationTarget("note", { kind: "vault_page", id: "n2", parentId: "n1" }, folders), {
    root: "notes",
    parentId: "n1",
  });
  // A note nested under a note (made before folders existed) does not pass
  // its parent on: the new note goes to the top of Notes instead.
  assert.deepEqual(core().creationTarget("note", { kind: "vault_page", id: "x", parentId: "n2" }, folders), {
    root: "notes",
    parentId: null,
  });
  assert.deepEqual(core().creationTarget("note", { kind: "paper", id: "p1" }, folders), {
    root: "notes",
    parentId: null,
  });
  assert.deepEqual(core().creationTarget("note", { kind: "report_section", id: "s1" }, folders), {
    root: "notes",
    parentId: null,
  });
  assert.deepEqual(
    core().creationTarget("section", { kind: "report_section", id: "s2", parentId: "s1" }, folders),
    { root: "report", parentId: "s1" },
  );
  assert.deepEqual(core().creationTarget("note", undefined, folders), { root: "notes", parentId: null });
});

test("drop: same root only, onto a folder or a root, never onto a note, itself or its own descendant", () => {
  const roots = tree();
  const n1 = find(roots, "vault_page:n1");
  const n2 = find(roots, "vault_page:n2");
  const n3 = find(roots, "ink_page:n3");
  const n4 = find(roots, "vault_page:n4");
  const s1 = find(roots, "report_section:s1");
  const s2 = find(roots, "report_section:s2");
  assert.equal(core().canDrop(n3, n4), true, "into a folder");
  assert.equal(core().canDrop(n3, find(roots, "notes")), true);
  assert.equal(core().canDrop(n3, n2), false, "a note holds nothing");
  assert.equal(core().canDrop(n4, n2), false, "nor does a folder go under a note");
  assert.equal(core().canDrop(n1, n4), false, "own descendant");
  assert.equal(core().canDrop(n1, n1), false, "itself");
  assert.equal(core().canDrop(n2, s2), false, "another root");
  assert.equal(core().canDrop(n2, find(roots, "paper:p1")), false);
  assert.equal(core().canDrop(s2, find(roots, "report")), true);
  assert.equal(core().canDrop(s2, s1), true, "report sections still nest: that is the outline");
  assert.equal(core().dropParentId(find(roots, "notes")), null);
  assert.equal(core().dropParentId(n1), "n1");
});

test("new file: the kind is the table's answer for the document on screen", () => {
  // A section is in the outline, so the new file made from it is a section; a
  // note makes a note. Anything belonging to no root (a paper, or nothing open
  // at all) lands at the top of Notes, and the first kind Notes takes is a note.
  assert.equal(core().creationKindFor({ kind: "report_section" }), "section");
  assert.equal(core().creationKindFor({ kind: "vault_page" }), "note");
  assert.equal(core().creationKindFor({ kind: "ink_page" }), "note");
  assert.equal(core().creationKindFor({ kind: "paper" }), "note");
  assert.equal(core().creationKindFor(undefined), "note");
});

test("a draft of each kind: what it writes into, and whether it opens", () => {
  assert.deepEqual(core().draftMakes("note"), { ink: false, opens: true, folder: false });
  assert.deepEqual(core().draftMakes("section"), { ink: false, opens: true, folder: false });
  // A folder is made and left closed: there is nothing to write into a folder,
  // and opening one would open a grouping row rather than a document. It is
  // saved as a folder, so it is still one when it is empty.
  assert.deepEqual(core().draftMakes("folder"), { ink: false, opens: false, folder: true });
});

test("a draft row wears the icon of the kind it will become", () => {
  assert.equal(core().draftIcon("note"), "notes");
  assert.equal(core().draftIcon("folder"), "folder");
  assert.equal(core().draftIcon("section"), "doc");
});

test("a folder is a grouping row: marked as one, kept out of quick open, and listed by id", () => {
  const roots = tree();
  assert.equal(find(roots, "vault_page:n1").folder, true);
  assert.equal(find(roots, "vault_page:n2").folder, undefined);
  const opened = core().flattenTree(roots).map((node) => node.key);
  assert.ok(opened.includes("vault_page:n2"));
  assert.ok(!opened.includes("vault_page:n1"), "a folder is not a document to open");
  assert.deepEqual([...core().folderIdsOf(roots)].sort(), ["n1", "n4"]);
});
