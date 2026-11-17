/**
 * Importing an Excalidraw drawing into a freeform page and exporting the page
 * back: pictures go through the page's store, and the page's own items stay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";
import { exportDrawing, importDrawing } from "../application/excalidraw-transfer";
import { encodeStroke } from "../application/freeform-ink";
import { strokesOf } from "../application/freeform-edit";
import type { CanvasFile } from "../application/canvas-doc";

const prefix = readyCore().vaultImagePrefix();
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const drawing = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    { id: "t1", type: "text", x: 10, y: 20, width: 100, height: 30, text: "hello" },
    { id: "i1", type: "image", x: 5, y: 6, width: 100, height: 80, fileId: "f1" },
    { id: "d1", type: "freedraw", x: 0, y: 0, strokeColor: "#1e1e1e", strokeWidth: 2, points: [[0, 0], [5, 5]], pressures: [] },
  ],
  files: { f1: { id: "f1", mimeType: "image/png", dataURL: PNG } },
});

function ownPage(): CanvasFile {
  const stroke = encodeStroke({ id: "s0", colour: "#000000", width: 2, tool: "pen", points: [{ x: 1, y: 1, pressure: 0.5 }, { x: 9, y: 9, pressure: 0.5 }] });
  return { nodes: [{ id: "own", type: "text", x: 0, y: 0, width: 50, height: 20, text: "mine" }], edges: [], wfInk: [stroke] };
}

function storeInto(stored: File[]) {
  return async (file: File) => {
    stored.push(file);
    return `assets/${stored.length}.png`;
  };
}

test("import adds the drawing's cards and strokes after the page's own", async () => {
  const { file } = await importDrawing(ownPage(), drawing, storeInto([]));
  assert.equal(file.nodes[0]?.id, "own");
  assert.ok(file.nodes.some((node) => node.text === "hello"));
  const strokes = strokesOf(file);
  assert.equal(strokes.length, 2);
  assert.equal(strokes[0]?.id, "s0");
});

test("import stores each picture and points its card at the stored path", async () => {
  const stored: File[] = [];
  const { file } = await importDrawing({ nodes: [], edges: [] }, drawing, storeInto(stored));
  const [picture] = stored;
  assert.equal(stored.length, 1);
  assert.ok(picture);
  assert.equal(picture.type, "image/png");
  assert.deepEqual(new Uint8Array(await picture.arrayBuffer()), new Uint8Array(Buffer.from("iVBORw0KGgo=", "base64")));
  const card = file.nodes.find((node) => node.type === "file");
  assert.equal(card?.file, `${prefix}assets/1.png`);
});

test("importing the same drawing twice gives every item its own id", async () => {
  const once = await importDrawing({ nodes: [], edges: [] }, drawing, storeInto([]));
  const twice = await importDrawing(once.file, drawing, storeInto([]));
  const ids = [...twice.file.nodes.map((node) => node.id), ...strokesOf(twice.file).map((stroke) => stroke.id)];
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, ids.length);
});

test("import of text that is not a drawing throws and stores nothing", async () => {
  const stored: File[] = [];
  await assert.rejects(importDrawing(ownPage(), "not json", storeInto(stored)));
  assert.equal(stored.length, 0);
});

test("export embeds the page's stored pictures, and imports back with them", async () => {
  const page: CanvasFile = {
    nodes: [{ id: "p1", type: "file", x: 0, y: 0, width: 40, height: 30, file: `${prefix}assets/a.png` }],
    edges: [],
  };
  const asked: string[] = [];
  const written = await exportDrawing(page, async (path) => {
    asked.push(path);
    return new Blob([Buffer.from("iVBORw0KGgo=", "base64")], { type: "image/png" });
  });
  assert.deepEqual(asked, ["assets/a.png"]);
  const json = JSON.parse(written.json) as { files: Record<string, { dataURL: string; mimeType: string }> };
  assert.deepEqual(Object.values(json.files).map((entry) => [entry.mimeType, entry.dataURL]), [["image/png", PNG]]);
  const stored: File[] = [];
  await importDrawing({ nodes: [], edges: [] }, written.json, storeInto(stored));
  assert.equal(stored.length, 1);
});

test("export leaves notes and papers on the page out of the picture fetch", async () => {
  const page: CanvasFile = {
    nodes: [{ id: "n1", type: "file", x: 0, y: 0, width: 40, height: 30, file: "notes/idea.md" }],
    edges: [],
  };
  const written = await exportDrawing(page, async () => assert.fail("fetched a note"));
  assert.equal(JSON.parse(written.json).type, "excalidraw");
});
