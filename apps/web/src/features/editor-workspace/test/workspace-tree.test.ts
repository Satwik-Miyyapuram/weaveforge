import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildListsTree,
  buildWorkspaceTree,
  flattenTree,
  listMembership,
  listPath,
  type ListsTreeInput,
  type WorkspaceTreeNode,
  type WorkspaceTreeInput,
} from "../application/workspace-tree";

const EMPTY: WorkspaceTreeInput = { notes: [], papers: [], reportSections: [] };

function roots(input: Partial<WorkspaceTreeInput> = {}) {
  const tree = buildWorkspaceTree({ ...EMPTY, ...input });
  return { tree, notes: tree[0]!, papers: tree[1]!, report: tree[2]! };
}

/** Every node in a forest, whatever its depth — for assertions about shape. */
function everyNode(nodes: readonly WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  return nodes.flatMap((node) => [node, ...everyNode(node.children)]);
}

test("three roots, always, so an empty workspace still shows where things go", () => {
  const { tree } = roots();
  assert.deepEqual(
    tree.map((node) => node.label),
    ["Notes", "Papers", "Report"],
  );
  assert.deepEqual(
    tree.map((node) => node.children.length),
    [0, 0, 0],
  );
});

test("a note nests under its parent and carries the path the mirror would write", () => {
  const { notes } = roots({
    notes: [
      { id: "a", title: "Method" },
      { id: "b", title: "Baselines", parentId: "a" },
    ],
  });

  assert.equal(notes.children.length, 1);
  const method = notes.children[0]!;
  assert.equal(method.key, "vault_page:a");
  assert.equal(method.path, "notes/method/method.note.md");
  assert.equal(method.children[0]!.path, "notes/method/baselines.note.md");
});

test("children sort by label, not by the order the rows arrived in", () => {
  const { notes } = roots({
    notes: [
      { id: "z", title: "Zeta" },
      { id: "a", title: "alpha" },
      { id: "m", title: "Chapter 10" },
      { id: "n", title: "Chapter 2" },
    ],
  });

  assert.deepEqual(
    notes.children.map((node) => node.label),
    ["alpha", "Chapter 2", "Chapter 10", "Zeta"],
  );
});

test("a note whose parent is gone stays visible at the root rather than vanishing", () => {
  const { notes } = roots({ notes: [{ id: "orphan", title: "Orphan", parentId: "deleted" }] });

  assert.deepEqual(
    notes.children.map((node) => node.id),
    ["orphan"],
  );
});

test("a note that claims itself as its parent does not hang the tree", () => {
  const { notes } = roots({ notes: [{ id: "loop", title: "Loop", parentId: "loop" }] });

  assert.equal(notes.children.length, 1);
  assert.equal(notes.children[0]!.children.length, 0);
});

test("a paper with no note is listed and flagged, never hidden", () => {
  const { papers } = roots({
    papers: [
      { id: "p1", title: "Attention Is All You Need", hasNote: true },
      { id: "p2", title: "Batch Norm", hasNote: false },
    ],
  });

  assert.deepEqual(
    papers.children.map((node) => [node.label, node.missingNote ?? false]),
    [
      ["Attention Is All You Need", false],
      ["Batch Norm", true],
    ],
  );
  assert.match(papers.children[0]!.path, /^papers\/.*\.paper\.md$/);
});

test("an untitled entity gets a label rather than an empty row", () => {
  const { notes } = roots({ notes: [{ id: "u", title: "   " }] });

  assert.equal(notes.children[0]!.label, "Untitled");
});

test("flattening drops the folders and keeps every document, depth-first", () => {
  const { tree } = roots({
    notes: [
      { id: "a", title: "Method" },
      { id: "b", title: "Baselines", parentId: "a" },
    ],
    papers: [{ id: "p1", title: "Attention", hasNote: true }],
    reportSections: [{ id: "s1", title: "Results" }],
  });

  assert.deepEqual(
    flattenTree(tree).map((node) => node.key),
    ["vault_page:a", "vault_page:b", "paper:p1", "report_section:s1"],
  );
});

/* -------------------------------------------------------------------------
 * Reading lists (§3.1)
 * ---------------------------------------------------------------------- */

const LISTS: ListsTreeInput = {
  lists: [
    { id: "l1", title: "Latent spaces" },
    { id: "l2", title: "Disentanglement", parentId: "l1" },
    { id: "l3", title: "Screening — September" },
  ],
  items: [
    { listId: "l2", kind: "paper", id: "p1" },
    { listId: "l2", kind: "paper", id: "p2" },
    { listId: "l2", kind: "vault_page", id: "n1" },
    { listId: "l1", kind: "paper", id: "p3" },
    { listId: "l3", kind: "paper", id: "p1", inheritedFromListId: "l1" },
    { listId: "l3", kind: "paper", id: "p9", duplicateOfItemId: "p1" },
  ],
  titles: new Map([
    ["paper:p1", "β-VAE: Learning"],
    ["paper:p2", "Disentanglement: a review"],
    ["paper:p3", "Screening methods"],
    ["vault_page:n1", "Disentanglement reading cluster"],
  ]),
};

test("the section header is the Lists root, so lists sit at level one", () => {
  const tree = buildListsTree(LISTS);
  assert.deepEqual(
    tree.map((node) => node.label),
    ["Latent spaces", "Screening — September"],
  );
  assert.ok(tree.every((node) => node.kind === "reading_list"));
});

test("a list nests under its parent list and carries the mirrored path", () => {
  const tree = buildListsTree(LISTS);
  const parent = tree.find((node) => node.id === "l1")!;
  // A list row is both a folder and a member holder: its nested lists come
  // first, then its own papers and notes.
  assert.deepEqual(
    parent.children.map((node) => [node.label, node.kind]),
    [
      ["Disentanglement", "reading_list"],
      ["Screening methods", "paper"],
    ],
  );
  // A nested list's path carries its parent's slug, derived from the parent's
  // own title when the caller did not compute one.
  assert.equal(parent.path, "reading-lists/latent-spaces.list.md");
  assert.equal(parent.children[0]!.path, "reading-lists/latent-spaces/disentanglement.list.md");
});

test("members hang off their list, papers first and each sorted by label", () => {
  const tree = buildListsTree(LISTS);
  const nested = tree.find((node) => node.id === "l1")!.children[0]!;
  assert.deepEqual(
    nested.children.map((node) => node.label),
    ["Disentanglement: a review", "β-VAE: Learning", "Disentanglement reading cluster"],
    "papers first, then notes, each sorted by label",
  );
});

test("a top-level list's members are papers first, then notes, each sorted", () => {
  const tree = buildListsTree({ ...LISTS, lists: [{ id: "l2", title: "Disentanglement" }] });
  assert.deepEqual(
    tree[0]!.children.map((node) => node.kind),
    ["paper", "paper", "vault_page"],
  );
});

test("a member's key is prefixed by its list but its kind and id are the entity's", () => {
  const tree = buildListsTree(LISTS);
  const nested = tree.find((node) => node.id === "l1")!.children[0]!;
  const paper = nested.children.find((node) => node.id === "p1")!;

  assert.equal(paper.key, "reading_list:l2/paper:p1");
  assert.equal(paper.kind, "paper");
  assert.equal(paper.id, "p1");
  assert.equal(paper.isMember, true);
});

test("the same paper under two lists is two rows with two keys", () => {
  const tree = buildListsTree(LISTS);
  const p1 = everyNode(tree).filter((node) => node.id === "p1");
  assert.equal(p1.length, 2, "one under its parent list, one inherited into Screening");
  assert.notEqual(p1[0]!.key, p1[1]!.key);
  assert.deepEqual(
    p1.map((node) => node.key),
    ["reading_list:l2/paper:p1", "reading_list:l3/paper:p1"],
  );
});

test("a member row reuses the member's own path, not the list's", () => {
  const tree = buildListsTree(LISTS);
  const nested = tree.find((node) => node.id === "l1")!.children[0]!;
  const paper = nested.children.find((node) => node.id === "p1")!;
  assert.ok(paper.path.endsWith(".md"));
  assert.equal(paper.path.includes("reading-lists/"), false);
});

test("an inherited membership is flagged and names where it came from", () => {
  const tree = buildListsTree(LISTS);
  const screening = tree.find((node) => node.id === "l3")!;
  const inherited = screening.children[0]!;
  assert.equal(inherited.inherited, true);
  assert.equal(inherited.inheritedFrom, "Latent spaces");
});

test("a duplicate is hidden: that decision belongs to the screening screen", () => {
  const tree = buildListsTree(LISTS);
  const screening = tree.find((node) => node.id === "l3")!;
  assert.equal(screening.children.some((node) => node.id === "p9"), false);
});

test("quick open never lists a member row, which would be the same document twice", () => {
  const files = buildWorkspaceTree({
    notes: [],
    papers: [{ id: "p1", title: "β-VAE: Learning", hasNote: true }],
    reportSections: [],
  });
  const lists = buildListsTree(LISTS);
  const indexed = [...flattenTree(files), ...flattenTree(lists)];

  // Files contributes the paper once; the two member rows in Reading lists
  // contribute nothing, because they are the same file seen through a list.
  assert.deepEqual(
    indexed.filter((node) => node.id === "p1").map((node) => node.key),
    ["paper:p1"],
  );
  // The list rows themselves are documents and are still indexed.
  assert.equal(indexed.filter((node) => node.kind === "reading_list").length, 3);
});

test("membership is a lookup, so a Files row can say how many lists it is in", () => {
  const membership = listMembership(
    LISTS.items,
    new Map([
      ["reading_list:l1", "Latent spaces"],
      ["reading_list:l2", "Disentanglement"],
      ["reading_list:l3", "Screening — September"],
    ]),
  );
  assert.deepEqual(membership.get("paper:p1"), ["Disentanglement", "Screening — September"]);
  assert.equal(membership.get("paper:p9"), undefined, "a duplicate is not a membership");
});
