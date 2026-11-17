import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_CANVAS_TEXT,
  makeNode,
  newCanvasId,
  nodeBox,
  nodeLabel,
  parseCanvasFile,
  setInk,
  type CanvasFile,
} from "../application/canvas-doc";

test("a blank body reads as an empty canvas", () => {
  assert.deepEqual(parseCanvasFile("   "), { nodes: [], edges: [] });
});

test("the empty canvas text is the one Obsidian writes", () => {
  assert.equal(EMPTY_CANVAS_TEXT, '{\n\t"nodes":[],\n\t"edges":[]\n}');
  assert.deepEqual(parseCanvasFile(EMPTY_CANVAS_TEXT), { nodes: [], edges: [] });
});

test("JSON that is not an object with nodes and edges is refused with the canvas message", () => {
  const message = "This note's body is not a canvas (JSON Canvas needs an object with nodes and edges).";
  assert.throws(() => parseCanvasFile("[]"), { message });
  assert.throws(() => parseCanvasFile("null"), { message });
  assert.throws(() => parseCanvasFile('{"nodes":{}, "edges":[]}'), { message });
  assert.throws(() => parseCanvasFile('{"nodes":[], "edges":"x"}'), { message });
});

test("top-level fields a later spec or plugin wrote survive the read", () => {
  const file = parseCanvasFile('{"nodes":[],"edges":[],"plugin":{"a":1}}');
  assert.deepEqual(file.plugin, { a: 1 });
});

test("a node keeps every field it was read with", () => {
  const file = parseCanvasFile(
    '{"nodes":[{"id":"n1","type":"text","x":1,"y":2,"width":3,"height":4,"text":"hi","styleAttributes":{"k":true}}],"edges":[]}',
  );
  assert.deepEqual(file.nodes[0]?.styleAttributes, { k: true });
});

test("a new node takes the id and rounded position it was made at", () => {
  const node = makeNode("text", { x: 10.6, y: -3.2 }, { width: 320, height: 40 });
  assert.match(node.id, /^[0-9a-f]{16}$/);
  assert.equal(node.type, "text");
  assert.equal(node.x, 11);
  assert.equal(node.y, -3);
  assert.equal(node.width, 320);
  assert.equal(node.text, "");
});

test("a new picture, link or group carries the field its kind needs", () => {
  assert.equal(makeNode("file", { x: 0, y: 0 }, { width: 100, height: 100 }, { file: "vault:a.webp" }).file, "vault:a.webp");
  assert.equal(makeNode("link", { x: 0, y: 0 }, { width: 100, height: 100 }).url, "");
  assert.equal(makeNode("group", { x: 0, y: 0 }, { width: 100, height: 100 }).label, "Group");
});

test("a node without usable coordinates is boxed at the origin with default size", () => {
  const raw = { id: "x", type: "text" } as unknown as Parameters<typeof nodeBox>[0];
  assert.deepEqual(nodeBox(raw), { x: 0, y: 0, width: 320, height: 40 });
});

test("a node with stored coordinates is boxed as stored", () => {
  assert.deepEqual(nodeBox({ id: "x", type: "text", x: 5, y: 6, width: 7, height: 8 }), { x: 5, y: 6, width: 7, height: 8 });
});

test("setting ink replaces wfInk, and an empty stroke list leaves no field behind", () => {
  const file: CanvasFile = { nodes: [], edges: [] };
  const inked = setInk(file, [{ id: "s", x: 0, y: 0, w: 2, c: "#000000", t: "pen", p: [0, 0], r: [255] }]);
  assert.equal((inked.wfInk as unknown[]).length, 1);
  assert.equal(file.wfInk, undefined);
  const cleared = setInk(inked, []);
  assert.equal("wfInk" in cleared, false);
});

test("newCanvasId gives 16 lowercase hex digits and does not repeat in a run", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newCanvasId()));
  for (const id of ids) assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(ids.size, 200);
});

test("each card has a short spoken name from its kind and content", () => {
  const at = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(nodeLabel({ id: "t", type: "text", ...at, text: "# Plan\nmore" }), "Text: # Plan");
  assert.equal(nodeLabel({ id: "t", type: "text", ...at, text: "x".repeat(80) }), `Text: ${"x".repeat(40)}…`);
  assert.equal(nodeLabel({ id: "t", type: "text", ...at }), "Text: empty");
  assert.equal(nodeLabel({ id: "f", type: "file", ...at, file: "notes/a.md" }), "File: a.md");
  assert.equal(nodeLabel({ id: "l", type: "link", ...at, url: "https://x.org" }), "Link: https://x.org");
  assert.equal(nodeLabel({ id: "g", type: "group", ...at, label: "Ideas" }), "Group: Ideas");
  assert.equal(nodeLabel({ id: "g", type: "group", ...at }), "Group");
  assert.equal(nodeLabel({ id: "u", type: "shape", ...at }), "shape node");
});
