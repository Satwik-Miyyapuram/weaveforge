/**
 * `submit` answers whether the action went through, so a dialog closes on
 * success and stays open with its error on failure (31-03).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";

import { useSubmit } from "@/lib/hooks/use-submit";
import { renderHook } from "./react-harness";

test("a successful action resolves true and leaves no error", async () => {
  const h = await renderHook(() => useSubmit(async () => {}), {});
  let ok: boolean | undefined;
  await act(async () => {
    ok = await h.current.submit();
  });
  assert.equal(ok, true);
  assert.equal(h.current.error, null);
  assert.equal(h.current.busy, false);
});

test("a throwing action resolves false and shows its message", async () => {
  const h = await renderHook(() => useSubmit(async () => { throw new Error("Bad key"); }), {});
  let ok: boolean | undefined;
  await act(async () => {
    ok = await h.current.submit();
  });
  assert.equal(ok, false);
  assert.match(h.current.error ?? "", /Bad key/);
  assert.equal(h.current.busy, false);
});

test("a synchronous throw counts as a failure too", async () => {
  const h = await renderHook(() => useSubmit(() => { throw new Error("sync"); }), {});
  let ok: boolean | undefined;
  await act(async () => {
    ok = await h.current.submit();
  });
  assert.equal(ok, false);
  assert.match(h.current.error ?? "", /sync/);
});

test("the form event is still prevented", async () => {
  const h = await renderHook(() => useSubmit(async () => {}), {});
  let prevented = false;
  await act(async () => {
    await h.current.submit({ preventDefault: () => { prevented = true; } } as never);
  });
  assert.equal(prevented, true);
});
