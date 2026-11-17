import { test } from "node:test";
import assert from "node:assert/strict";

import type { CanvasFile } from "../application/canvas-doc";
import { addStroke, moveItems, patchNode, removeItems, strokesOf } from "../application/freeform-edit";
import type { InkStroke } from "../application/freeform-ink";

const stroke: InkStroke = { id: "s1", x: 10, y: 10, w: 2, c: "#000000", t: "pen", p: [0, 0], r: [255] };

function sample(): CanvasFile {
  return {
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 100, height: 40, text: "a" },
      { id: "b", type: "text", x: 200, y: 0, width: 100, height: 40, text: "b" },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b" }],
    plugin: { keep: true },
  };
}

test("moving rounds node positions, moves strokes, and leaves other fields alone", () => {
  const file: CanvasFile = { ...sample(), wfInk: [stroke] };
  const moved = moveItems(file, new Set(["a", "s1"]), 5.4, -2);
  assert.deepEqual(moved.nodes[0], { id: "a", type: "text", x: 5, y: -2, width: 100, height: 40, text: "a" });
  assert.equal(moved.nodes[1]?.x, 200);
  assert.equal(strokesOf(moved)[0]?.x, 15.4);
  assert.equal(strokesOf(moved)[0]?.y, 8);
  assert.deepEqual(moved.plugin, { keep: true });
  assert.equal(file.nodes[0]?.x, 0, "the input is not changed");
});

test("patching one node changes only its fields", () => {
  const next = patchNode(sample(), "b", { text: "changed" });
  assert.equal(next.nodes[1]?.text, "changed");
  assert.equal(next.nodes[1]?.x, 200);
  assert.equal(next.nodes[0]?.text, "a");
});

test("removing a node also removes the edges that end at it", () => {
  const next = removeItems(sample(), new Set(["b"]));
  assert.equal(next.nodes.length, 1);
  assert.deepEqual(next.edges, []);
});

test("removing strokes leaves no wfInk field when none remain", () => {
  const file: CanvasFile = { ...sample(), wfInk: [stroke] };
  const next = removeItems(file, new Set(["s1"]));
  assert.equal("wfInk" in next, false);
  assert.equal(next.nodes.length, 2);
});

test("adding a stroke appends it to wfInk", () => {
  const once = addStroke(sample(), stroke);
  const twice = addStroke(once, { ...stroke, id: "s2" });
  assert.deepEqual(strokesOf(twice).map((s) => s.id), ["s1", "s2"]);
});

test("edits keep the wfInk items they cannot read, instead of dropping them", () => {
  const later = { id: "v2", kind: "shape" };
  const file = { ...sample(), wfInk: [later, stroke] } as unknown as CanvasFile;
  assert.deepEqual(addStroke(file, { ...stroke, id: "s2" }).wfInk, [later, stroke, { ...stroke, id: "s2" }]);
  assert.deepEqual(moveItems(file, new Set(["s1"]), 1, 1).wfInk?.[0], later);
  assert.deepEqual(removeItems(file, new Set(["s1"])).wfInk, [later]);
});

test("a wfInk value that is not a list survives edits", () => {
  const file = { ...sample(), wfInk: { future: true } } as unknown as CanvasFile;
  assert.deepEqual(removeItems(file, new Set(["a"])).wfInk, { future: true });
  assert.deepEqual(moveItems(file, new Set(["a"]), 1, 1).wfInk, { future: true });
});
