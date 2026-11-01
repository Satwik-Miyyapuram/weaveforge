import { test } from "node:test";
import assert from "node:assert/strict";

import { renderHook } from "@/lib/test/react-harness";
import { useCoreLoad } from "../core-gate";

test("starts loading, then ready when the load resolves", async () => {
  const h = await renderHook(() => useCoreLoad(() => Promise.resolve()), undefined);
  await h.flush();
  assert.equal(h.current.state, "ready");
});

test("a failed load reports failed, and retry loads again", async () => {
  let calls = 0;
  const load = () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve();
  };
  const h = await renderHook(() => useCoreLoad(load), undefined);
  await h.flush();
  assert.equal(h.current.state, "failed");

  h.current.retry();
  await h.flush();
  await h.flush();
  assert.equal(h.current.state, "ready");
  assert.equal(calls, 2);
});

test("a load still pending stays loading", async () => {
  const h = await renderHook(() => useCoreLoad(() => new Promise<unknown>(() => {})), undefined);
  await h.flush();
  assert.equal(h.current.state, "loading");
});
