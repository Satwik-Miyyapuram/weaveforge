import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canDrop,
  canRename,
  creatableUnder,
  creationTarget,
  dropParentId,
  rootKey,
  rootOf,
} from "../application/explorer-edit";
import { buildWorkspaceTree, type WorkspaceTreeNode } from "../application/workspace-tree";

function tree() {
  return buildWorkspaceTree({
    notes: [
      { id: "n1", title: "Methods", parentId: undefined },
      { id: "n2", title: "Sampling", parentId: "n1" },
      { id: "n3", title: "Sketch", parentId: "n2", kind: "ink_page" },
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

test("rules: Notes takes notes, ink and folders; Report takes sections; Papers takes nothing", () => {
  const roots = tree();
  assert.deepEqual(creatableUnder(find(roots, rootKey("notes"))), ["note", "ink", "folder"]);
  assert.deepEqual(creatableUnder(find(roots, "vault_page:n2")), ["note", "ink", "folder"]);
  assert.deepEqual(creatableUnder(find(roots, "ink_page:n3")), ["note", "ink", "folder"]);
  assert.deepEqual(creatableUnder(find(roots, rootKey("report"))), ["section"]);
  assert.deepEqual(creatableUnder(find(roots, "report_section:s2")), ["section"]);
  assert.deepEqual(creatableUnder(find(roots, "papers")), []);
  assert.deepEqual(creatableUnder(find(roots, "paper:p1")), []);
});

test("rename: notes and sections, never roots or papers", () => {
  const roots = tree();
  assert.equal(canRename(find(roots, "vault_page:n1")), true);
  assert.equal(canRename(find(roots, "report_section:s1")), true);
  assert.equal(canRename(find(roots, "paper:p1")), false);
  assert.equal(canRename(find(roots, "notes")), false);
  assert.equal(rootOf({ key: "x", kind: "vault_page", isMember: true }), null);
});

test("creation target: the active note's folder, else the Notes root; a paper never", () => {
  assert.deepEqual(creationTarget("note", { kind: "vault_page", id: "n2", parentId: "n1" }), {
    root: "notes",
    parentId: "n1",
  });
  assert.deepEqual(creationTarget("ink", { kind: "ink_page", id: "n3", parentId: "n2" }), {
    root: "notes",
    parentId: "n2",
  });
  assert.deepEqual(creationTarget("note", { kind: "paper", id: "p1" }), { root: "notes", parentId: null });
  assert.deepEqual(creationTarget("note", { kind: "report_section", id: "s1" }), {
    root: "notes",
    parentId: null,
  });
  assert.deepEqual(creationTarget("section", { kind: "report_section", id: "s2", parentId: "s1" }), {
    root: "report",
    parentId: "s1",
  });
  assert.deepEqual(creationTarget("note", undefined), { root: "notes", parentId: null });
});

test("drop: same root only, never onto itself or its own descendant", () => {
  const roots = tree();
  const n1 = find(roots, "vault_page:n1");
  const n2 = find(roots, "vault_page:n2");
  const n3 = find(roots, "ink_page:n3");
  const s2 = find(roots, "report_section:s2");
  assert.equal(canDrop(n3, n1), true);
  assert.equal(canDrop(n3, find(roots, "notes")), true);
  assert.equal(canDrop(n1, n3), false, "own descendant");
  assert.equal(canDrop(n1, n1), false, "itself");
  assert.equal(canDrop(n2, s2), false, "another root");
  assert.equal(canDrop(n2, find(roots, "paper:p1")), false);
  assert.equal(canDrop(s2, find(roots, "report")), true);
  assert.equal(dropParentId(find(roots, "notes")), null);
  assert.equal(dropParentId(n1), "n1");
});
