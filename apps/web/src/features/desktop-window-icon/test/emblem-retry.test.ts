/**
 * A failed emblem fetch is not cached for the session (P2-142): the next
 * theme change fetches again instead of failing forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadEmblem } from "../index";

test("a failed emblem fetch is retried on the next call (P2-142)", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response("", { status: 503 })
      : new Response("<svg/>", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(loadEmblem(), /did not load \(503\)/);
    assert.equal(await loadEmblem(), "<svg/>");
    assert.equal(await loadEmblem(), "<svg/>", "a good emblem stays cached");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});