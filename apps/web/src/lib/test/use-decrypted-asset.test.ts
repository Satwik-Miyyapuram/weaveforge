import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHook } from "./react-harness.js";
import { useDecryptedObjectUrls } from "../use-decrypted-asset.js";

/** Records every path the hook asks for, so re-fetches show up as duplicates. */
function trackingFetcher() {
  const calls: string[] = [];
  return {
    calls,
    fetchOne: async (path: string) => {
      calls.push(path);
      return new Blob([path]);
    },
  };
}

test("a new array with the same paths does not re-run the fetcher", async () => {
  const { calls, fetchOne } = trackingFetcher();

  // Mirrors PaperCardThumbs before the fix: a fresh array every render. The
  // effect calls setUrls, so depending on array identity was an unbounded loop.
  const harness = await renderHook(
    (paths: string[]) => useDecryptedObjectUrls(paths, fetchOne),
    ["paperimg:a", "paperimg:b"],
  );
  assert.deepEqual(calls, ["paperimg:a", "paperimg:b"]);
  assert.equal(harness.current.size, 2);

  for (let i = 0; i < 3; i++) {
    await harness.rerender(["paperimg:a", "paperimg:b"]);
    await harness.flush();
  }

  assert.deepEqual(calls, ["paperimg:a", "paperimg:b"]);
  await harness.unmount();
});

test("changed path contents re-run the fetcher", async () => {
  const { calls, fetchOne } = trackingFetcher();

  const harness = await renderHook(
    (paths: string[]) => useDecryptedObjectUrls(paths, fetchOne),
    ["paperimg:a"],
  );
  assert.deepEqual(calls, ["paperimg:a"]);

  await harness.rerender(["paperimg:a", "paperimg:c"]);
  await harness.flush();

  assert.deepEqual(calls, ["paperimg:a", "paperimg:a", "paperimg:c"]);
  assert.deepEqual([...harness.current.keys()], ["paperimg:a", "paperimg:c"]);
  await harness.unmount();
});

test("an empty path list neither fetches nor churns the returned map", async () => {
  const { calls, fetchOne } = trackingFetcher();

  const harness = await renderHook(
    (paths: string[]) => useDecryptedObjectUrls(paths, fetchOne),
    [],
  );
  const first = harness.current;

  await harness.rerender([]);
  await harness.flush();

  assert.deepEqual(calls, []);
  assert.equal(harness.current, first);
  await harness.unmount();
});
