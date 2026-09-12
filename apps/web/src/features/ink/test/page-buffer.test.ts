/**
 * The page buffer: the geometry the renderer and the picker read.
 *
 * Two properties matter and both are about a gesture not disturbing anything:
 * an erase is O(1) with no allocation and no renumbering, and a stroke's index is
 * stable for the life of the buffer, because the R-tree's leaves and the GPU's
 * instance ranges all point at it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  INK_CHUNK_HEADER_BYTES,
  INK_CHUNK_MAGIC,
  blankInkPage,
  decodeInkChunkBody,
  encodeInkChunkBody,
  makeInkStroke,
  pageFromChunk,
  type InkPage,
} from "@weaveforge/core";

import {
  InkPageBuffer,
  boundsContain,
  boundsIntersect,
  boundsOf,
  fromGeometry,
  toGeometry,
  type InkStrokeGeometry,
} from "../application/page-buffer";

/** A stroke that is a horizontal line at `y`, `count` points from `x0`. */
function line(x0: number, y: number, count: number, width = 6) {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push(x0 + i * 20, y);
    pressures.push(120 + i);
  }
  return makeInkStroke({ points, pressures, width, t0: 0 });
}

function pageOf(...strokes: ReturnType<typeof line>[]): InkPage {
  return {
    width: INK_A4_WIDTH,
    height: INK_A4_HEIGHT,
    paper: "blank",
    background: 0,
    strokes,
    lines: [],
  };
}

test("a stroke becomes typed arrays and an exact bounding box", () => {
  const geometry = toGeometry(line(100, 300, 4));
  assert.equal(geometry.x.length, 4);
  assert.deepEqual(Array.from(geometry.x), [100, 120, 140, 160]);
  assert.deepEqual(Array.from(geometry.y), [300, 300, 300, 300]);
  assert.deepEqual(Array.from(geometry.pressure), [120, 121, 122, 123]);
  assert.deepEqual(geometry.bounds, [100, 300, 160, 300], "a flat line has a flat box");
  assert.equal(geometry.line, -1, "an unsegmented stroke says so");
});

test("bounds arithmetic is inclusive and slack grows the box", () => {
  const bounds = boundsOf(Float32Array.from([10, 40, 25]), Float32Array.from([5, 60, 30]));
  assert.deepEqual(bounds, [10, 5, 40, 60]);
  assert.equal(boundsIntersect(bounds, [40, 60, 90, 90]), true, "touching counts as intersecting");
  assert.equal(boundsIntersect(bounds, [41, 61, 90, 90]), false);
  assert.equal(boundsIntersect(bounds, [45, 65, 90, 90], 5), true, "slack reaches it");
  assert.equal(boundsContain(bounds, 10, 5), true, "the box contains its own corner");
  assert.equal(boundsContain(bounds, 9, 5), false);
  assert.equal(boundsContain(bounds, 9, 5, 1), true);
});

test("a page round-trips through the chunk with its geometry intact", () => {
  const page = pageOf(line(100, 300, 40), line(500, 700, 25, 60));
  const buffer = new InkPageBuffer(page);
  assert.equal(buffer.liveCount, 2);

  const packed = encodeInkChunkBody(buffer.toPage());
  const back = pageFromChunk(decodeInkChunkBody(packed));
  const again = new InkPageBuffer(back);

  const first = again.stroke(0)!;
  assert.deepEqual(Array.from(first.x).slice(0, 3), [100, 120, 140]);
  assert.equal(first.width, 6);
  assert.equal(again.stroke(1)!.width, 60, "a 6 mm highlighter keeps its width through the buffer");
  assert.equal(again.liveCount, 2);

  // And packing the buffer's page twice gives identical bytes: the buffer is a
  // faithful round trip rather than a lossy view.
  assert.deepEqual(encodeInkChunkBody(again.toPage()), packed);
});

test("an erase is a bit, not a splice: indices stay stable", () => {
  const buffer = new InkPageBuffer(pageOf(line(100, 300, 4), line(200, 400, 4), line(300, 500, 4)));
  assert.equal(buffer.erase(1), true);
  assert.equal(buffer.stroke(1), null, "the erased stroke is not readable");
  assert.equal(buffer.liveCount, 2);
  assert.deepEqual(buffer.liveStrokes().map((stroke) => stroke.bounds[1]), [300, 500]);
  // The survivors keep their indices, which is what the index and the GPU rely on.
  assert.equal(buffer.stroke(2)!.bounds[1], 500);
  assert.equal(buffer.erase(1), false, "erasing twice is a no-op, not an error");
  assert.equal(buffer.restore(1), true, "and undo brings it back in place");
  assert.equal(buffer.liveCount, 3);
});

test("compaction renumbers, and says how", () => {
  const buffer = new InkPageBuffer(pageOf(line(100, 300, 4), line(200, 400, 4), line(300, 500, 4)));
  buffer.erase(0);
  buffer.erase(2);
  const remap = buffer.compact();
  assert.equal(buffer.capacity, 1);
  assert.equal(buffer.liveCount, 1);
  assert.equal(buffer.stroke(0)!.bounds[1], 400, "the survivor is first now");
  assert.deepEqual([...remap.entries()], [[0, 1]], "and the map says where it came from");
});

test("a blank page has bounds and no strokes", () => {
  const buffer = new InkPageBuffer(blankInkPage());
  assert.equal(buffer.liveCount, 0);
  assert.deepEqual(buffer.bounds(), [0, 0, 0, 0]);
  assert.deepEqual(buffer.toPage().strokes, []);
  assert.equal(buffer.capacity, 0);
});

test("the page's bounds cover every live stroke and ignore dead ones", () => {
  const buffer = new InkPageBuffer(pageOf(line(100, 300, 4), line(900, 1500, 4)));
  assert.deepEqual(buffer.bounds(), [100, 300, 960, 1500]);
  buffer.erase(1);
  assert.deepEqual(buffer.bounds(), [100, 300, 160, 300], "an erased stroke does not extend the page");
});

test("geometry converts back to the model without losing a point", () => {
  const original = line(100, 300, 12);
  const geometry: InkStrokeGeometry = toGeometry(original);
  const model = fromGeometry(geometry);
  assert.deepEqual(model.points, original.points);
  assert.deepEqual(model.pressures, original.pressures);
  assert.equal(model.width, original.width);
  assert.equal(model.tool, original.tool);
});

test("a stroke with no points is held without breaking the bounds", () => {
  const buffer = new InkPageBuffer(blankInkPage());
  const index = buffer.append({ points: [], pressures: [], width: 6, tool: "pen", colour: "text" });
  assert.equal(buffer.stroke(index)!.x.length, 0);
  assert.deepEqual(buffer.stroke(index)!.bounds, [0, 0, 0, 0]);
  assert.deepEqual(buffer.bounds(), [0, 0, 0, 0], "an empty stroke does not move the page's box");
});

test("pressure that arrived as nonsense is stored as none", () => {
  const geometry = toGeometry({
    points: [0, 0, 10, 0, 20, 0],
    pressures: [Number.NaN, -5, 400],
    width: 6,
    tool: "pen",
    colour: "text",
  });
  assert.deepEqual(Array.from(geometry.pressure), [0, 0, 255], "clamped, with NaN read as no sample");
});

test("a chunk written from a buffer is a chunk the container reads back", () => {
  // The buffer produces the model; the container writes the bytes. This is the
  // seam between the two, and the reason the magic is asserted: the buffer has no
  // part in the header, so a page that survives the buffer but not the container
  // would be a page that saves as garbage.
  const buffer = new InkPageBuffer(pageOf(line(100, 300, 8)));
  const chunk = new Uint8Array(INK_CHUNK_HEADER_BYTES + encodeInkChunkBody(buffer.toPage()).length);
  chunk.set(new TextEncoder().encode(INK_CHUNK_MAGIC), 0);
  new DataView(chunk.buffer).setUint16(4, 1, true);
  const body = encodeInkChunkBody(buffer.toPage());
  new DataView(chunk.buffer).setUint32(8, body.length, true);
  new DataView(chunk.buffer).setUint32(12, body.length, true);
  chunk.set(body, INK_CHUNK_HEADER_BYTES);

  const back = new InkPageBuffer(
    pageFromChunk(decodeInkChunkBody(chunk.subarray(INK_CHUNK_HEADER_BYTES))),
  );
  assert.equal(String.fromCharCode(...chunk.subarray(0, 4)), INK_CHUNK_MAGIC);
  assert.equal(back.liveCount, 1);
  assert.deepEqual(Array.from(back.stroke(0)!.x), Array.from(buffer.stroke(0)!.x));
  assert.deepEqual(back.stroke(0)!.bounds, buffer.stroke(0)!.bounds);
});
