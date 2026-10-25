import assert from "node:assert/strict";
import test from "node:test";

import { collectGarbage } from "../src/collect-garbage";

/**
 * Boot leaves tens of MB of dead buffers (the engine's WASM and data bundle)
 * that V8 only frees on its idle GC, about 30 s later (M03). One collection
 * right after the database opens frees them at once.
 */

const MB = 1024 * 1024;

test("collectGarbage frees dead buffers now, without --expose-gc", () => {
  assert.equal(typeof (globalThis as { gc?: unknown }).gc, "undefined", "run without --expose-gc");
  let junk: ArrayBuffer[] | null = Array.from({ length: 8 }, () => new ArrayBuffer(8 * MB));
  const held = process.memoryUsage().arrayBuffers;
  junk = null;
  assert.equal(collectGarbage(), true);
  const after = process.memoryUsage().arrayBuffers;
  assert.ok(held - after >= 50 * MB, `freed ${Math.round((held - after) / MB)} MB of 64`);
});

test("collectGarbage leaves no gc global behind and can run twice", () => {
  assert.equal(collectGarbage(), true);
  assert.equal(collectGarbage(), true);
  assert.equal(typeof (globalThis as { gc?: unknown }).gc, "undefined");
});
