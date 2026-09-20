import assert from "node:assert/strict";
import test from "node:test";

import { canStoreUnchanged } from "@/lib/image-compress";

/**
 * The one decision in the image pipeline that can be tested without a canvas.
 *
 * Everything else in `image-compress.ts` needs `createImageBitmap` and a 2D
 * context, which the node runner has neither of. This predicate is where the
 * behaviour a person notices is decided: whether dropping a screenshot costs a
 * decode-and-re-encode or is stored as it came.
 */

test("a small image already in a preferred format is stored as it came", () => {
  assert.equal(canStoreUnchanged({ type: "image/webp", size: 40 * 1024 }), true);
  assert.equal(canStoreUnchanged({ type: "image/jpeg", size: 40 * 1024 }), true);
});

test("a large image is still re-encoded, whatever its format", () => {
  // The point of the pipeline: multi-MB photos and screenshots are what it
  // exists to shrink.
  assert.equal(canStoreUnchanged({ type: "image/webp", size: 5 * 1024 * 1024 }), false);
  assert.equal(canStoreUnchanged({ type: "image/jpeg", size: 5 * 1024 * 1024 }), false);
});

test("a small image in a format we do not ship is still converted", () => {
  // A 40 KB PNG screenshot becomes a much smaller WebP; that conversion is the
  // reason the module exists, and it costs one decode of a small file.
  assert.equal(canStoreUnchanged({ type: "image/png", size: 40 * 1024 }), false);
  assert.equal(canStoreUnchanged({ type: "image/bmp", size: 1024 }), false);
});

test("the boundary is inclusive, so the documented threshold is the behaviour", () => {
  assert.equal(canStoreUnchanged({ type: "image/webp", size: 64 * 1024 }), true);
  assert.equal(canStoreUnchanged({ type: "image/webp", size: 64 * 1024 + 1 }), false);
});
