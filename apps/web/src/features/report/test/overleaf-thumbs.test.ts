import assert from "node:assert/strict";
import { test } from "node:test";

import { loadOverleafThumb, saveOverleafThumb, serialQueue, type OverleafThumbDeps } from "../lib/parts";

function memoryStore() {
  const map = new Map<string, string>();
  return { map, get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v) };
}

function deps(over: Partial<OverleafThumbDeps> = {}): OverleafThumbDeps & { compiles: string[] } {
  const compiles: string[] = [];
  return {
    compiles,
    store: memoryStore(),
    fetchPdf: async (_session, project) => { compiles.push(project); return new Blob(["%PDF"]); },
    render: async () => "data:image/webp;base64,AAA",
    ...over,
  };
}

test("a project with no saved picture is compiled once and its page kept", async () => {
  const d = deps();
  assert.equal(await loadOverleafThumb(d, "s1", "p1"), "data:image/webp;base64,AAA");
  assert.equal(await loadOverleafThumb(d, "s1", "p1"), "data:image/webp;base64,AAA");
  assert.deepEqual(d.compiles, ["p1"]);
});

test("a saved picture is shown without compiling, even signed out", async () => {
  const d = deps();
  saveOverleafThumb(d.store, "p1", "data:image/webp;base64,OLD");
  assert.equal(await loadOverleafThumb(d, null, "p1"), "data:image/webp;base64,OLD");
  assert.deepEqual(d.compiles, []);
});

test("signed out with nothing saved gives no picture and no request", async () => {
  const d = deps();
  assert.equal(await loadOverleafThumb(d, null, "p1"), null);
  assert.deepEqual(d.compiles, []);
});

test("a failed compile or render gives no picture and saves nothing", async () => {
  const store = memoryStore();
  assert.equal(await loadOverleafThumb(deps({ store, fetchPdf: async () => null }), "s1", "p1"), null);
  assert.equal(await loadOverleafThumb(deps({ store, render: async () => { throw new Error("bad pdf"); } }), "s1", "p1"), null);
  assert.equal(store.map.size, 0);
  const throws = deps({ fetchPdf: async () => { throw new Error("offline"); } });
  assert.equal(await loadOverleafThumb(throws, "s1", "p1"), null);
});

test("an oversized picture is not saved, so storage is not filled", () => {
  const store = memoryStore();
  saveOverleafThumb(store, "p1", `data:image/webp;base64,${"A".repeat(400_000)}`);
  assert.equal(store.map.size, 0);
});

test("a store that throws is treated as empty", async () => {
  const d = deps({ store: { get: () => { throw new Error("denied"); }, set: () => { throw new Error("denied"); } } });
  assert.equal(await loadOverleafThumb(d, "s1", "p1"), "data:image/webp;base64,AAA");
});

test("the queue runs one task at a time, in order, and survives a failure", async () => {
  const run = serialQueue();
  const log: string[] = [];
  let release!: () => void;
  const first = run(async () => { log.push("a start"); await new Promise<void>((r) => { release = r; }); log.push("a end"); });
  const second = run(async () => { log.push("b"); throw new Error("x"); });
  const third = run(async () => { log.push("c"); return 3; });
  await Promise.resolve();
  assert.deepEqual(log, ["a start"]);
  release();
  await first;
  await assert.rejects(second);
  assert.equal(await third, 3);
  assert.deepEqual(log, ["a start", "a end", "b", "c"]);
});
