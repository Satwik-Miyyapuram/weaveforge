/**
 * `inChunks`: the one batch-by-id loop the repositories share (xhelp-21, 34-20).
 *
 * An `in` list travels in the URL, so a long id list is split. The split must
 * not ask for nothing, must not lose or reorder a chunk, and must issue the
 * chunks together.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { inChunks } from "../row-access";

function recorder() {
  const asked: string[][] = [];
  let inFlight = 0;
  let peak = 0;
  const fetch = async (chunk: string[]) => {
    asked.push(chunk);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight -= 1;
    return chunk.map((id) => ({ id }));
  };
  return { asked, fetch, peak: () => peak };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

test("no ids: no request, empty result", async () => {
  const rec = recorder();
  assert.deepEqual(await inChunks([], rec.fetch), []);
  assert.equal(rec.asked.length, 0);
});

test("exactly one chunk's worth is one request", async () => {
  const rec = recorder();
  const out = await inChunks(ids(200), rec.fetch);
  assert.equal(rec.asked.length, 1);
  assert.equal(out.length, 200);
});

test("splits at limit: one more id is a second request", async () => {
  const rec = recorder();
  await inChunks(ids(201), rec.fetch);
  assert.deepEqual(rec.asked.map((c) => c.length), [200, 1]);
});

test("helper keeps order across chunks", async () => {
  const rec = recorder();
  const out = await inChunks(ids(7), rec.fetch, 3);
  assert.deepEqual(rec.asked.map((c) => c.length), [3, 3, 1]);
  assert.deepEqual(out.map((r) => r.id), ids(7));
});

test("chunks are requested together, not one after another", async () => {
  const rec = recorder();
  await inChunks(ids(450), rec.fetch);
  assert.equal(rec.asked.length, 3);
  assert.equal(rec.peak(), 3);
});

test("a failed chunk rejects the whole read", async () => {
  await assert.rejects(
    inChunks(
      ids(5),
      async (chunk) => {
        if (chunk[0] === "id-2") throw new Error("414 URI too long");
        return chunk;
      },
      2,
    ),
    /414/,
  );
});
