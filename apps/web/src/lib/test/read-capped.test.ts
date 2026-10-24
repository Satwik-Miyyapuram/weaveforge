import test from "node:test";
import assert from "node:assert/strict";
import { readCapped } from "../read-capped";

/**
 * The one capped body reader every proxy and safe-fetch share: the cap holds
 * while reading, whatever `content-length` said, and a body past it is
 * cancelled rather than drained.
 */

function streamOf(chunks: Uint8Array[]): { body: ReadableStream<Uint8Array>; state: { pulls: number; cancelled: boolean } } {
  const state = { pulls: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++;
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { body, state };
}

const bytes = (...values: number[]) => new Uint8Array(values);

test("a body under the cap comes back whole, chunks in order", async () => {
  const { body } = streamOf([bytes(1, 2), bytes(3), bytes(4, 5, 6)]);
  assert.deepEqual(await readCapped(body, 10), bytes(1, 2, 3, 4, 5, 6));
});

test("a body exactly at the cap is accepted", async () => {
  const { body } = streamOf([bytes(1, 2, 3), bytes(4)]);
  assert.deepEqual(await readCapped(body, 4), bytes(1, 2, 3, 4));
});

test("one byte past the cap is refused and the stream cancelled", async () => {
  const { body, state } = streamOf([bytes(1, 2, 3), bytes(4, 5), bytes(6)]);
  assert.equal(await readCapped(body, 4), null);
  assert.equal(state.cancelled, true);
  assert.equal(state.pulls, 2, "nothing is read after the cap is passed");
});

test("no body is an empty body", async () => {
  assert.deepEqual(await readCapped(null, 4), new Uint8Array());
  assert.deepEqual(await readCapped(undefined, 4), new Uint8Array());
});

test("an empty stream and empty chunks read as nothing", async () => {
  assert.deepEqual(await readCapped(streamOf([]).body, 0), new Uint8Array());
  assert.deepEqual(await readCapped(streamOf([bytes(), bytes(7), bytes()]).body, 1), bytes(7));
});

test("many small chunks past the starting buffer still come back whole", async () => {
  const chunks = Array.from({ length: 3000 }, (_, i) => bytes(i % 256, (i * 7) % 256, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30));
  const expected = new Uint8Array(chunks.length * 32);
  chunks.forEach((c, i) => expected.set(c, i * 32));
  const got = await readCapped(streamOf(chunks).body, expected.byteLength);
  assert.ok(got);
  assert.equal(got.byteLength, expected.byteLength);
  assert.deepEqual(got, expected);
});
