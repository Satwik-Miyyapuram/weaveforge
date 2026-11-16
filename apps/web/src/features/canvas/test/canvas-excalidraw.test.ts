/**
 * Excalidraw import and export through the wasm core: the canvas crosses the
 * boundary as text, so unknown fields and the file layout stay as Rust wrote them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";

const { importExcalidraw, exportExcalidraw, normalizeCanvasText } = readyCore();

const drawing = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    { id: "t1", type: "text", x: 10, y: 20, width: 100, height: 30, text: "hello" },
    {
      id: "d1",
      type: "freedraw",
      x: 0,
      y: 0,
      strokeColor: "#1e1e1e",
      strokeWidth: 2,
      points: [[0, 0], [5, 5]],
      pressures: [],
    },
  ],
  files: {},
});

test("excalidraw: import gives canvas text in the saved layout", () => {
  const read = importExcalidraw(drawing);
  assert.equal(normalizeCanvasText(read.canvasText), read.canvasText);
  assert.match(read.canvasText, /"text":"hello"/);
  assert.match(read.canvasText, /"wfInk":\[/);
  assert.deepEqual(read.images, []);
  assert.ok(Array.isArray(read.warnings));
});

test("excalidraw: export of an imported drawing imports back the same", () => {
  const first = importExcalidraw(drawing);
  const written = exportExcalidraw(first.canvasText, first.images);
  assert.equal(JSON.parse(written.json).type, "excalidraw");
  assert.equal(importExcalidraw(written.json).canvasText, first.canvasText);
});

test("excalidraw: text that is not a drawing or not a canvas throws", () => {
  assert.throws(() => importExcalidraw("not json"));
  assert.throws(() => exportExcalidraw("not json", []));
});
