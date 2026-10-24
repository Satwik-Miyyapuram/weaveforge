/**
 * Copying answers whether it worked instead of rejecting (31-10): a blocked or
 * missing clipboard must not surface as an unhandled rejection or a "Copied".
 */
import assert from "node:assert/strict";
import test from "node:test";

import { copyText } from "@/lib/clipboard";

async function withNavigator<T>(value: unknown, run: () => Promise<T>): Promise<T> {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  try {
    return await run();
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test("a granted clipboard copies the text and answers true", async () => {
  const written: string[] = [];
  const ok = await withNavigator({ clipboard: { writeText: async (t: string) => void written.push(t) } }, () => copyText("abc"));
  assert.equal(ok, true);
  assert.deepEqual(written, ["abc"]);
});

test("a refused write answers false", async () => {
  const ok = await withNavigator(
    { clipboard: { writeText: () => Promise.reject(new Error("NotAllowedError")) } },
    () => copyText("abc"),
  );
  assert.equal(ok, false);
});

test("a write that throws synchronously answers false", async () => {
  const ok = await withNavigator({ clipboard: { writeText: () => { throw new Error("boom"); } } }, () => copyText("abc"));
  assert.equal(ok, false);
});

test("no clipboard API (insecure context) answers false", async () => {
  assert.equal(await withNavigator({}, () => copyText("abc")), false);
});

test("no navigator at all answers false", async () => {
  assert.equal(await withNavigator(undefined, () => copyText("abc")), false);
});
