import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canDrop,
  canRename,
  creatableUnder,
  creationKindFor,
  creationTarget,
  draftIcon,
  draftMakes,
  dropParentId,
  rootKey,
  rootOf,
} from "../application/explorer-edit";
import { buildWorkspaceTree, flattenTree, folderIdsOf, type WorkspaceTreeNode } from "../application/workspace-tree";

function tree() {
  return buildWorkspaceTree({
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
  assert.deepEqual(creatableUnder(find(roots, rootKey("notes"))), ["note", "folder"]);
  assert.deepEqual(creatableUnder(find(roots, "vault_page:n1")), ["note", "folder"]);
  assert.deepEqual(creatableUnder(find(roots, "vault_page:n4")), ["note", "folder"]);
  assert.deepEqual(creatableUnder(find(roots, "vault_page:n2")), [], "a note has no sub-notes");
  assert.deepEqual(creatableUnder(find(roots, "ink_page:n3")), [], "nor does an ink note");
  assert.deepEqual(creatableUnder(find(roots, rootKey("report"))), ["section"]);
  assert.deepEqual(creatableUnder(find(roots, "report_section:s2")), ["section"]);
  assert.deepEqual(creatableUnder(find(roots, "papers")), []);
  assert.deepEqual(creatableUnder(find(roots, "paper:p1")), []);
  assert.deepEqual(creatableUnder({ key: "paper_pdf:p1", kind: "paper_pdf" }), []);
  assert.deepEqual(creatableUnder({ key: "papers/p1", kind: "folder" }), []);
});

test("rename: notes and sections, never roots or papers", () => {
  const roots = tree();
  assert.equal(canRename(find(roots, "vault_page:n1")), true, "a folder");
  assert.equal(canRename(find(roots, "vault_page:n2")), true, "a note");
  assert.equal(canRename(find(roots, "report_section:s1")), true);
  assert.equal(canRename(find(roots, "paper:p1")), false);
  assert.equal(canRename(find(roots, "notes")), false);
  assert.equal(rootOf({ key: "x", kind: "vault_page", isMember: true }), null);
});

test("creation target: the active note's folder, else the Notes root; a paper never", () => {
  const folders = new Set(["n1"]);
  assert.deepEqual(creationTarget("note", { kind: "vault_page", id: "n2", parentId: "n1" }, folders), {
    root: "notes",
    parentId: "n1",
  });
  // A note nested under a note (made before folders existed) does not pass
  // its parent on: the new note goes to the top of Notes instead.
  assert.deepEqual(creationTarget("note", { kind: "vault_page", id: "x", parentId: "n2" }, folders), {
    root: "notes",
    parentId: null,
  });
  assert.deepEqual(creationTarget("note", { kind: "paper", id: "p1" }, folders), { root: "notes", parentId: null });
  assert.deepEqual(creationTarget("note", { kind: "report_section", id: "s1" }, folders), {
    root: "notes",
    parentId: null,
  });
  assert.deepEqual(creationTarget("section", { kind: "report_section", id: "s2", parentId: "s1" }, folders), {
    root: "report",
    parentId: "s1",
  });
  assert.deepEqual(creationTarget("note", undefined, folders), { root: "notes", parentId: null });
});

test("drop: same root only, onto a folder or a root, never onto a note, itself or its own descendant", () => {
  const roots = tree();
  const n1 = find(roots, "vault_page:n1");
  const n2 = find(roots, "vault_page:n2");
  const n3 = find(roots, "ink_page:n3");
  const n4 = find(roots, "vault_page:n4");
  const s1 = find(roots, "report_section:s1");
  const s2 = find(roots, "report_section:s2");
  assert.equal(canDrop(n3, n4), true, "into a folder");
  assert.equal(canDrop(n3, find(roots, "notes")), true);
  assert.equal(canDrop(n3, n2), false, "a note holds nothing");
  assert.equal(canDrop(n4, n2), false, "nor does a folder go under a note");
  assert.equal(canDrop(n1, n4), false, "own descendant");
  assert.equal(canDrop(n1, n1), false, "itself");
  assert.equal(canDrop(n2, s2), false, "another root");
  assert.equal(canDrop(n2, find(roots, "paper:p1")), false);
  assert.equal(canDrop(s2, find(roots, "report")), true);
  assert.equal(canDrop(s2, s1), true, "report sections still nest: that is the outline");
  assert.equal(dropParentId(find(roots, "notes")), null);
  assert.equal(dropParentId(n1), "n1");
});

test("new file: the kind is the table's answer for the document on screen", () => {
  // A section is in the outline, so the new file made from it is a section; a
  // note makes a note. Anything belonging to no root — a paper, or nothing open
  // at all — lands at the top of Notes, and the first kind Notes takes is a note.
  assert.equal(creationKindFor({ kind: "report_section" }), "section");
  assert.equal(creationKindFor({ kind: "vault_page" }), "note");
  assert.equal(creationKindFor({ kind: "ink_page" }), "note");
  assert.equal(creationKindFor({ kind: "paper" }), "note");
  assert.equal(creationKindFor(undefined), "note");
});

test("a draft of each kind: what it writes into, and whether it opens", () => {
  assert.deepEqual(draftMakes("note"), { ink: false, opens: true, folder: false });
  assert.deepEqual(draftMakes("section"), { ink: false, opens: true, folder: false });
  // A folder is made and left closed: there is nothing to write into a folder,
  // and opening one would open a grouping row rather than a document. It is
  // saved as a folder, so it is still one when it is empty.
  assert.deepEqual(draftMakes("folder"), { ink: false, opens: false, folder: true });
});

test("a draft row wears the icon of the kind it will become", () => {
  assert.equal(draftIcon("note"), "notes");
  assert.equal(draftIcon("folder"), "folder");
  assert.equal(draftIcon("section"), "doc");
});

test("a folder is a grouping row: marked as one, kept out of quick open, and listed by id", () => {
  const roots = tree();
  assert.equal(find(roots, "vault_page:n1").folder, true);
  assert.equal(find(roots, "vault_page:n2").folder, undefined);
  const opened = flattenTree(roots).map((node) => node.key);
  assert.ok(opened.includes("vault_page:n2"));
  assert.ok(!opened.includes("vault_page:n1"), "a folder is not a document to open");
  assert.deepEqual([...folderIdsOf(roots)].sort(), ["n1", "n4"]);
});
