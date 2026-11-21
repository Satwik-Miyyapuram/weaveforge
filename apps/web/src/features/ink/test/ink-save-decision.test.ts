/**
 * The ink save decision: whether a page write, a clear (remove), or nothing
 * should happen, and whether the save is safe to report as ok.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decideInkWrite } from "../ui/ink-save-decision";

const bytes = new Uint8Array([1, 2, 3]);

test("readable page with bytes is written", () => {
  const result = decideInkWrite(
    { chunkId: "c1", chunk: new Uint8Array([9]) },
    { bytes, cleared: false, pageIndex: 0 },
    0,
  );
  assert.deepEqual(result, { action: "write", ok: true });
});

test("cleared same page with stored chunk is removed", () => {
  const result = decideInkWrite(
    { chunkId: "c1", chunk: new Uint8Array([9]) },
    { bytes: null, cleared: true, pageIndex: 2 },
    2,
  );
  assert.deepEqual(result, { action: "remove", ok: true });
});

test("cleared same page with no stored chunk is a no-op success", () => {
  const result = decideInkWrite(
    { chunkId: "c1", chunk: null },
    { bytes: null, cleared: true, pageIndex: 2 },
    2,
  );
  assert.deepEqual(result, { action: "none", ok: true });
});

test("bytes null and not cleared means worker still loading", () => {
  const result = decideInkWrite(
    { chunkId: "c1", chunk: null },
    { bytes: null, cleared: false, pageIndex: 0 },
    0,
  );
  assert.deepEqual(result, { action: "none", ok: false, reason: "not-ready" });
});

test("cleared for a different page is not ready", () => {
  const result = decideInkWrite(
    { chunkId: "c1", chunk: new Uint8Array([9]) },
    { bytes: null, cleared: true, pageIndex: 1 },
    2,
  );
  assert.deepEqual(result, { action: "none", ok: false, reason: "not-ready" });
});

test("no current page means no-pages", () => {
  const result = decideInkWrite(undefined, { bytes, cleared: false, pageIndex: 0 }, 0);
  assert.deepEqual(result, { action: "none", ok: false, reason: "no-pages" });
});

test("unreadable page with bytes is unreadable", () => {
  const result = decideInkWrite(
    { chunkId: "c1", chunk: null, unreadable: true },
    { bytes, cleared: false, pageIndex: 0 },
    0,
  );
  assert.deepEqual(result, { action: "none", ok: false, reason: "unreadable" });
});

test("unreadable page cleared with stored chunk is unreadable", () => {
  const result = decideInkWrite(
    { chunkId: "c1", chunk: new Uint8Array([9]), unreadable: true },
    { bytes: null, cleared: true, pageIndex: 0 },
    0,
  );
  assert.deepEqual(result, { action: "none", ok: false, reason: "unreadable" });
});
