/**
 * The WebGL render stats count strokes, not batches: a batch holds every
 * stroke of one colour and pass, so many strokes share one batch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InkBatches, type InkBatchTarget } from "../render/webgl-batches";

function pool(): InkBatches {
  const gl = { createBuffer: () => ({}) } as unknown as WebGL2RenderingContext;
  return new InkBatches({ gl } as InkBatchTarget);
}

const record = (stroke: number) => ({ stroke, offset: stroke * 4, count: 4 });

test("an empty pool has no strokes", () => {
  assert.equal(pool().strokes, 0);
});

test("strokes sums the records in every batch, not the batch count", () => {
  const batches = pool();
  const text = batches.batchFor("text", false);
  text.records.push(record(0), record(1), record(2));
  batches.batchFor("danger", true).records.push(record(3));
  assert.equal([...batches.all()].length, 2);
  assert.equal(batches.strokes, 4);
});

test("the live batch's stroke in flight is not resident", () => {
  const batches = pool();
  batches.batchFor("text", false).records.push(record(0));
  batches.batchFor("text", false, true).records.push(record(1));
  assert.equal(batches.strokes, 1);
});

test("clear leaves no strokes resident", () => {
  const batches = pool();
  batches.batchFor("text", false).records.push(record(0), record(1));
  batches.clear();
  assert.equal(batches.strokes, 0);
});
