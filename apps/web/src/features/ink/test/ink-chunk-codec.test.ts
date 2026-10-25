import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeThrough } from "../application/ink-chunk-codec";

test("corrupt deflate rejects once and leaves no unhandled rejection (18-05)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await assert.rejects(pipeThrough(new DecompressionStream("deflate-raw"), new Uint8Array([0xff, 0xff, 0xff, 0xff])));
    // Let the writer's own write/close promises settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a round trip still returns the bytes it was given", async () => {
  const bytes = new TextEncoder().encode("ink ".repeat(200));
  const packed = await pipeThrough(new CompressionStream("deflate-raw"), bytes);
  assert.ok(packed.length < bytes.length);
  assert.deepEqual(await pipeThrough(new DecompressionStream("deflate-raw"), packed), bytes);
});

test("empty input round-trips to empty", async () => {
  const packed = await pipeThrough(new CompressionStream("deflate-raw"), new Uint8Array());
  assert.equal((await pipeThrough(new DecompressionStream("deflate-raw"), packed)).length, 0);
});
