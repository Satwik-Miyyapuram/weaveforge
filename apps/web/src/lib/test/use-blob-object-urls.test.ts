import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHook } from "./react-harness.js";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";

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
    (paths: string[]) => useBlobObjectUrls(paths, fetchOne),
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
    (paths: string[]) => useBlobObjectUrls(paths, fetchOne),
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
    (paths: string[]) => useBlobObjectUrls(paths, fetchOne),
    [],
  );
  const first = harness.current;

  await harness.rerender([]);
  await harness.flush();

  assert.deepEqual(calls, []);
  assert.equal(harness.current, first);
  await harness.unmount();
});

/**
 * A fetcher whose promises settle when the test says so.
 *
 * Every other test in this file resolves instantly, which is exactly why the
 * leak was invisible: with no window between the effect starting and its fetch
 * returning, the cancellation branch was never taken.
 */
function deferredFetcher() {
  const pending = new Map<string, (blob: Blob) => void>();
  return {
    fetchOne: (path: string) =>
      new Promise<Blob | null>((resolve) => {
        pending.set(path, resolve);
      }),
    settle: async (path: string) => {
      const resolve = pending.get(path);
      if (!resolve) throw new Error(`no pending fetch for ${path}`);
      pending.delete(path);
      resolve(new Blob([path]));
      // Let the continuation after the await run.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/** Counts object URLs so a leak shows up as created-minus-revoked. */
async function withUrlSpy<T>(body: (spy: { created: string[]; revoked: string[] }) => Promise<T>): Promise<T> {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let seq = 0;
  URL.createObjectURL = () => {
    const url = `blob:test/${seq++}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  try {
    return await body({ created, revoked });
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}

test("a path change mid-flight revokes the URLs the abandoned run created", async () => {
  await withUrlSpy(async ({ created, revoked }) => {
    const fetcher = deferredFetcher();
    const harness = await renderHook(
      (paths: string[]) => useBlobObjectUrls(paths, fetcher.fetchOne),
      ["paperimg:a"],
    );

    // The fetch for "a" is still in flight when the paths change, so run 1 is
    // cancelled before it can publish anything. Its URLs are the leak: cleanup
    // has already run and revoked what it held at that moment (nothing).
    await harness.rerender(["paperimg:b"]);
    await fetcher.settle("paperimg:a");
    await fetcher.settle("paperimg:b");
    await harness.flush();

    assert.deepEqual([...harness.current.keys()], ["paperimg:b"]);
    // One URL created for the abandoned "a", one for the live "b"; both are
    // accounted for — the live one is only revoked at unmount.
    assert.equal(created.length, 2);
    assert.deepEqual(revoked, [created[0]]);

    await harness.unmount();
    assert.equal(revoked.length, created.length);
  });
});
