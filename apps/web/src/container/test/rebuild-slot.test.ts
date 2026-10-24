/**
 * The app container is built once per backend/storage config and rebuilt when
 * the config changes (09-11). Builds that overlap must leave exactly one live
 * container, for the newest config, and dispose every other one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createRebuildSlot } from "../rebuild-slot";

type Built = { key: string; n: number; disposed: boolean; dispose: () => void };

function harness() {
  const builds: Array<{ built: Built; finish: () => void; fail: (err: Error) => void }> = [];
  let currentKey = "a";
  const slot = createRebuildSlot<Built>(
    () =>
      new Promise<Built>((resolve, reject) => {
        const built: Built = {
          key: currentKey,
          n: builds.length + 1,
          disposed: false,
          dispose: () => {
            built.disposed = true;
          },
        };
        builds.push({ built, finish: () => resolve(built), fail: reject });
      }),
  );
  return {
    slot,
    builds,
    ensure(key: string) {
      currentKey = key;
      return slot.ensure(key);
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("two calls for the same key share one build", async () => {
  const h = harness();
  const first = h.ensure("a");
  const second = h.ensure("a");
  await tick();
  assert.equal(h.builds.length, 1);
  h.builds[0]!.finish();
  assert.equal(await first, await second);
  assert.equal(h.slot.get("a"), h.builds[0]!.built);
});

test("a built key is returned without building again", async () => {
  const h = harness();
  const first = h.ensure("a");
  await tick();
  h.builds[0]!.finish();
  await first;
  assert.equal(await h.ensure("a"), h.builds[0]!.built);
  assert.equal(h.builds.length, 1);
});

test("a key change builds anew and disposes the old one only after", async () => {
  const h = harness();
  const a = h.ensure("a");
  await tick();
  h.builds[0]!.finish();
  await a;

  const b = h.ensure("b");
  await tick();
  assert.equal(h.builds[0]!.built.disposed, false, "the working one stays until the new one is built");
  h.builds[1]!.finish();
  assert.equal((await b).key, "b");
  assert.equal(h.builds[0]!.built.disposed, true);
  assert.equal(h.slot.get("a"), null);
});

test("an older build that finishes last is disposed, not installed (09-11)", async () => {
  const h = harness();
  const a = h.ensure("a");
  const b = h.ensure("b");
  await tick();
  assert.equal(h.builds.length, 2);

  h.builds[1]!.finish();
  assert.equal((await b).key, "b");
  h.builds[0]!.finish();
  const fromA = await a;

  assert.equal(fromA.key, "b", "the stale caller gets the live container");
  assert.equal(h.builds[0]!.built.disposed, true, "the stale build is released");
  assert.equal(h.builds[1]!.built.disposed, false, "the newer build is not torn down");
  assert.equal(h.slot.get("b"), h.builds[1]!.built);
  assert.equal(h.slot.get("a"), null);
});

test("an older build that finishes first is replaced by the newer one", async () => {
  const h = harness();
  const a = h.ensure("a");
  const b = h.ensure("b");
  await tick();

  h.builds[0]!.finish();
  h.builds[1]!.finish();
  await Promise.all([a, b]);

  assert.equal(h.builds[0]!.built.disposed, true);
  assert.equal(h.builds[1]!.built.disposed, false);
  assert.equal(h.slot.get("b"), h.builds[1]!.built);
});

test("a stale build for the same key does not clear the newer build in flight", async () => {
  // a, then b, then a again: the first build's cleanup must not forget the third.
  const h = harness();
  const first = h.ensure("a");
  void h.ensure("b").catch(() => {});
  const third = h.ensure("a");
  await tick();
  assert.equal(h.builds.length, 3);

  h.builds[0]!.finish();
  await tick();
  void h.ensure("a");
  await tick();
  assert.equal(h.builds.length, 3, "the in-flight build for a is reused");

  h.builds[2]!.finish();
  h.builds[1]!.finish();
  assert.equal(await first, h.builds[2]!.built);
  assert.equal(await third, h.builds[2]!.built);
  assert.equal(h.builds[0]!.built.disposed, true);
});

test("a failed build leaves the working one in place", async () => {
  const h = harness();
  const a = h.ensure("a");
  await tick();
  h.builds[0]!.finish();
  await a;

  const b = h.ensure("b");
  await tick();
  h.builds[1]!.fail(new Error("bad config"));
  await assert.rejects(b, /bad config/);
  assert.equal(h.builds[0]!.built.disposed, false);
  assert.equal(h.slot.get("a"), h.builds[0]!.built);

  const retry = h.ensure("b");
  await tick();
  assert.equal(h.builds.length, 3, "a failed build is retried, not cached");
  h.builds[2]!.finish();
  assert.equal((await retry).key, "b");
});
