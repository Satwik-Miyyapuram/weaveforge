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
