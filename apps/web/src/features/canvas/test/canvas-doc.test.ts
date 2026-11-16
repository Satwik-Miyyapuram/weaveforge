import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_CANVAS_TEXT,
  fromFlow,
  groupCarry,
  makeNode,
  moveMembers,
  parseCanvasFile,
  toFlow,
  type CanvasFile,
} from "../application/canvas-doc";

const SAMPLE: CanvasFile = {
  nodes: [
    { id: "g", type: "group", label: "Ideas", x: 0, y: 0, width: 400, height: 300, color: "4" },
    { id: "t", type: "text", text: "# Hi", x: 20, y: 40, width: 250, height: 60, styleAttributes: { shape: "pill" } },
    { id: "f", type: "file", file: "notes/Plan.md", subpath: "#Goals", x: 500, y: 0, width: 400, height: 400 },
    { id: "l", type: "link", url: "https://obsidian.md", x: 500, y: 500, width: 300, height: 200 },
    { id: "u", type: "future-kind", x: 0, y: 600, width: 10, height: 10, payload: [1, 2] },
  ],
  edges: [
    { id: "e1", fromNode: "t", fromSide: "right", toNode: "f", toSide: "left", label: "see" },
    { id: "e2", fromNode: "f", toNode: "l", fromEnd: "arrow", toEnd: "none", color: "#ff0000", pathfinder: true },
  ],
  metadata: { version: "1.0-1.0" },
};

test("an unchanged round trip gives back the same file, plugin fields included", () => {
  const flow = toFlow(SAMPLE);
  assert.deepEqual(fromFlow(SAMPLE, flow.nodes, flow.edges), SAMPLE);
});

test("nodes map to positioned flow nodes; groups sit behind", () => {
  const { nodes } = toFlow(SAMPLE);
  assert.deepEqual(
    nodes.map((n) => [n.id, n.type, n.position.x, n.position.y, n.width, n.height]),
    [
      ["g", "group", 0, 0, 400, 300],
      ["t", "text", 20, 40, 250, 60],
      ["f", "file", 500, 0, 400, 400],
      ["l", "link", 500, 500, 300, 200],
      ["u", "unknown", 0, 600, 10, 10],
    ],
  );
  assert.ok(nodes[0]!.zIndex! < nodes[1]!.zIndex!);
});

test("edges map sides to handles and ends to markers (toEnd defaults to an arrow)", () => {
  const { edges } = toFlow(SAMPLE);
  assert.equal(edges[0]!.source, "t");
  assert.equal(edges[0]!.sourceHandle, "right");
  assert.equal(edges[0]!.targetHandle, "left");
  assert.equal(edges[0]!.label, "see");
  assert.equal(edges[0]!.markerEnd, true);
  assert.equal(edges[0]!.markerStart, false);
  assert.equal(edges[1]!.markerEnd, false);
  assert.equal(edges[1]!.markerStart, true);
  assert.equal(edges[1]!.color, "#ff0000");
});

test("moves, resizes, edits, deletions and new edges are written back", () => {
  const flow = toFlow(SAMPLE);
  const nodes = flow.nodes
    .filter((n) => n.id !== "l")
    .map((n) =>
      n.id === "t"
        ? { ...n, position: { x: 33.6, y: -10.2 }, width: 300.4, height: 80, data: { ...n.data, raw: { ...n.data.raw, text: "edited" } } }
        : n,
    );
  // An edge to a deleted node goes with it.
  const edges = [...flow.edges, { id: "e3", source: "g", target: "t", sourceHandle: "bottom", targetHandle: null, data: undefined }];
  const out = fromFlow(SAMPLE, nodes, edges);
  assert.deepEqual(out.nodes.map((n) => n.id), ["g", "t", "f", "u"]);
  const t = out.nodes[1]!;
  assert.deepEqual([t.x, t.y, t.width, t.height, t.text], [34, -10, 300, 80, "edited"]);
  assert.deepEqual(t.styleAttributes, { shape: "pill" });
  assert.deepEqual(out.edges, [
    SAMPLE.edges[0],
    { id: "e3", fromNode: "g", fromSide: "bottom", toNode: "t" },
  ]);
  assert.deepEqual(out.metadata, SAMPLE.metadata);
});

test("parse reads an empty body as an empty canvas and rejects non-canvas JSON", () => {
  assert.deepEqual(parseCanvasFile(""), { nodes: [], edges: [] });
  assert.deepEqual(parseCanvasFile("  \n"), { nodes: [], edges: [] });
  assert.deepEqual(parseCanvasFile(EMPTY_CANVAS_TEXT), { nodes: [], edges: [] });
  assert.deepEqual(parseCanvasFile('{"nodes":[{"id":"a","type":"text","text":"x","x":1,"y":2,"width":3,"height":4}]}').edges, []);
  assert.throws(() => parseCanvasFile("[1,2]"), /not a canvas/);
  assert.throws(() => parseCanvasFile('{"nodes":5}'), /not a canvas/);
  assert.throws(() => parseCanvasFile("{oops"));
});

test("makeNode gives each kind its required field and a 16-hex id", () => {
  const text = makeNode("text", { x: 10.4, y: 20.6 });
  assert.match(text.id, /^[0-9a-f]{16}$/);
  assert.deepEqual({ ...text, id: "" }, { id: "", type: "text", text: "", x: 10, y: 21, width: 250, height: 60 });
  assert.equal(makeNode("file", { x: 0, y: 0 }, { file: "notes/A.md" }).file, "notes/A.md");
  assert.equal(makeNode("link", { x: 0, y: 0 }, { url: "https://a.org" }).url, "https://a.org");
  assert.equal(makeNode("group", { x: 0, y: 0 }).label, "Group");
  assert.notEqual(makeNode("text", { x: 0, y: 0 }).id, makeNode("text", { x: 0, y: 0 }).id);
});

test("moveMembers shifts only the listed nodes", () => {
  const { nodes } = toFlow(SAMPLE);
  const moved = moveMembers(nodes, ["t", "u"], { x: 5, y: -5 });
  assert.deepEqual(
    moved.map((n) => [n.id, n.position.x, n.position.y]),
    [
      ["g", 0, 0],
      ["t", 25, 35],
      ["f", 500, 0],
      ["l", 500, 500],
      ["u", 5, 595],
    ],
  );
  assert.equal(moved[2], nodes[2], "untouched nodes keep their identity");
});

test("groupCarry gathers the members of every dragged group, once, leaving the dragged nodes alone", () => {
  const dragged = [
    { id: "g", type: "group" },
    { id: "g2", type: "group" },
    { id: "t", type: "text" },
  ];
  const members: Record<string, string[]> = { g: ["t", "a"], g2: ["a", "b", "g"] };
  assert.deepEqual(
    groupCarry(dragged, (id) => members[id] ?? []),
    ["a", "b"],
  );
});

test("groupCarry carries nothing when no group is dragged", () => {
  assert.deepEqual(
    groupCarry([{ id: "t", type: "text" }], () => ["x"]),
    [],
  );
});
