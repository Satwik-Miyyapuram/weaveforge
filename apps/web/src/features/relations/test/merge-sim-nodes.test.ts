/**
 * mergeSimNodes reuses the simulation's node objects across graph updates
 * (26-04): the position survives, every data field comes from the new node.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mergeSimNodes } from "../ui/graph-canvas-hooks";

type N = {
  id: string; label: string; val: number; color: string; kind: string;
  year?: number; sectionId?: string; experimentStatus?: string;
  x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number;
};

const base = (over: Partial<N> = {}): N => ({ id: "a", label: "A", val: 1, color: "#000", kind: "paper", ...over });

test("an update keeps the position and takes year, sectionId and experiment fields (26-04)", () => {
  const cache = new Map<string, N>();
  const [first] = mergeSimNodes([base({ year: 2017, sectionId: "s1", experimentStatus: "running" })], cache, new Map(), null);
  Object.assign(first!, { x: 10, y: 20, vx: 1, vy: 2 });
  const [next] = mergeSimNodes([base({ label: "B", year: 2018, sectionId: "s2", experimentStatus: "done" })], cache, new Map(), null);
  assert.deepEqual(
    { x: next!.x, y: next!.y, vx: next!.vx, vy: next!.vy },
    { x: 10, y: 20, vx: 1, vy: 2 },
  );
  assert.equal(next!.label, "B");
  assert.equal(next!.year, 2018);
  assert.equal(next!.sectionId, "s2");
  assert.equal(next!.experimentStatus, "done");
});

test("a field the new node no longer has is cleared", () => {
  const cache = new Map<string, N>();
  mergeSimNodes([base({ year: 2017 })], cache, new Map(), null);
  const [next] = mergeSimNodes([base()], cache, new Map(), null);
  assert.equal(next!.year, undefined);
});

test("a pin still wins over the cached position and dropped nodes leave the cache", () => {
  const cache = new Map<string, N>();
  mergeSimNodes([base(), base({ id: "b" })], cache, new Map(), null);
  const [next] = mergeSimNodes([base()], cache, new Map([["a", { x: 5, y: 6 }]]), null);
  assert.deepEqual({ fx: next!.fx, fy: next!.fy }, { fx: 5, fy: 6 });
  assert.deepEqual([...cache.keys()], ["a"]);
});
