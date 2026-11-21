import { test } from "node:test";
import assert from "node:assert/strict";
import { INK_CHUNK_MAX_INFLATED_BYTES, inkChunkCodec, pipeThrough } from "../application/parts-1";

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

test("output past the limit stops the read and rejects, with no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const packed = await pipeThrough(new CompressionStream("deflate-raw"), new Uint8Array(100_000));
    await assert.rejects(pipeThrough(new DecompressionStream("deflate-raw"), packed, 1000), /larger than/);
    assert.equal((await pipeThrough(new DecompressionStream("deflate-raw"), packed, 100_000)).length, 100_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

// A crafted .inkb of a few kilobytes can inflate to gigabytes; the codec reads one
// chunk only up to the cap and treats anything larger as corrupt.
test("the stored codec refuses a chunk that inflates past the cap", async () => {
  const codec = inkChunkCodec("deflate-raw");
  assert.ok(codec);
  const bomb = await codec.compress(new Uint8Array(INK_CHUNK_MAX_INFLATED_BYTES + 1));
  assert.ok(bomb.length < 1024 * 1024);
  await assert.rejects(codec.decompress(bomb), /larger than/);
});

test("empty input round-trips to empty", async () => {
  const packed = await pipeThrough(new CompressionStream("deflate-raw"), new Uint8Array());
  assert.equal((await pipeThrough(new DecompressionStream("deflate-raw"), packed)).length, 0);
});
