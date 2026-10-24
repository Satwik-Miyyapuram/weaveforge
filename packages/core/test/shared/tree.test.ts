import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../../src/shared/tree.js";

interface Item {
  id: string;
  parentId?: string;
  order: number;
  name: string;
}
interface Node {
  item: Item;
  children: Node[];
}

function tree(items: Item[]): Node[] {
  return buildTree<Item, Node>(items, {
    id: (item) => item.id,
    parentId: (item) => item.parentId,
    node: (item) => ({ item, children: [] }),
    compare: (a, b) =>
      a.item.order - b.item.order || a.item.name.localeCompare(b.item.name),
  });
}

const names = (nodes: Node[]): string[] =>
  nodes.map((n) => `${n.item.name}(${names(n.children).join(",")})`);

test("children hang under their parent, roots keep the orphans", () => {
  const roots = tree([
    { id: "b", parentId: "a", order: 0, name: "b" },
    { id: "a", order: 0, name: "a" },
    { id: "c", parentId: "b", order: 0, name: "c" },
  ]);
  assert.deepEqual(names(roots), ["a(b(c()))"]);
});

test("siblings sort at every level, not only the roots", () => {
  const roots = tree([
    { id: "a", order: 1, name: "a" },
    { id: "z", order: 0, name: "z" },
    { id: "a2", parentId: "a", order: 5, name: "late" },
    { id: "a1", parentId: "a", order: 1, name: "early" },
  ]);
  assert.deepEqual(names(roots), ["z()", "a(early(),late())"]);
});

test("an item whose parent is missing becomes a root rather than vanishing", () => {
  const roots = tree([{ id: "x", parentId: "gone", order: 0, name: "x" }]);
  assert.deepEqual(names(roots), ["x()"]);
});

// A parent loop in the data (01-06): no node on it is reachable from a root,
// so it used to vanish. The loop is cut at one node, which becomes a root.
test("a two-node parent loop is rooted once, not dropped", () => {
  const roots = tree([
    { id: "a", parentId: "b", order: 0, name: "a" },
    { id: "b", parentId: "a", order: 0, name: "b" },
    { id: "r", order: 1, name: "r" },
  ]);
  assert.deepEqual(names(roots), ["a(b())", "r()"]);
});

test("a node that is its own parent is a root, and sorting ends", () => {
  const roots = tree([{ id: "s", parentId: "s", order: 0, name: "s" }]);
  assert.deepEqual(names(roots), ["s()"]);
});

test("a node hanging off a loop stays under its parent", () => {
  const roots = tree([
    { id: "c", parentId: "a", order: 0, name: "c" },
    { id: "a", parentId: "b", order: 0, name: "a" },
    { id: "b", parentId: "a", order: 0, name: "b" },
  ]);
  const all = names(roots).join();
  assert.equal(roots.length, 1, "one loop, one root");
  assert.match(all, /a\(.*c\(\)/, "c is still a's child");
  assert.equal(all.split("(").length - 1, 3, "every node appears once");
});

test("two separate loops each get a root", () => {
  const roots = tree([
    { id: "a", parentId: "b", order: 0, name: "a" },
    { id: "b", parentId: "a", order: 0, name: "b" },
    { id: "x", parentId: "y", order: 0, name: "x" },
    { id: "y", parentId: "x", order: 0, name: "y" },
  ]);
  assert.equal(roots.length, 2);
});
