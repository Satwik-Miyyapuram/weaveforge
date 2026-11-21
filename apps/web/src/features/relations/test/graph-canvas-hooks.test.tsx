/**
 * useFollowSeed moves the camera once per seed (P2-220). `nodes` is rebuilt on
 * every pin or data change, which used to pull the view back to the seed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useFollowSeed } from "../ui/graph-canvas-hooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { id: string; x: number; y: number };
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

test("a new nodes array with the same seed does not re-centre (P2-220)", async () => {
  const centred: [number, number][] = [];
  const cameraRef = { current: { centerAt: (x: number, y: number) => centred.push([x, y]), zoom: () => {} } };
  const autoFitRef = { current: true };
  function Probe({ seed, nodes }: { seed: string | null; nodes: Node[] }) {
    useFollowSeed(seed, nodes, cameraRef, autoFitRef, 5);
    return null;
  }
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(Probe, { seed: "a", nodes: [{ id: "a", x: 1, y: 2 }] }));
  });
  await wait(20);
  assert.deepEqual(centred, [[1, 2]]);

  await act(async () => { r.update(createElement(Probe, { seed: "a", nodes: [{ id: "a", x: 1, y: 2 }] })); });
  await wait(20);
  assert.equal(centred.length, 1, "same seed, new nodes: the view stays put");

  await act(async () => { r.update(createElement(Probe, { seed: "b", nodes: [{ id: "b", x: 3, y: 4 }] })); });
  await wait(20);
  assert.deepEqual(centred, [[1, 2], [3, 4]]);
  await act(async () => { r.unmount(); });
});

test("the seed's position is read when the timer fires, not when it was set", async () => {
  const centred: [number, number][] = [];
  const cameraRef = { current: { centerAt: (x: number, y: number) => centred.push([x, y]) } };
  const autoFitRef = { current: true };
  function Probe({ nodes }: { nodes: Node[] }) {
    useFollowSeed("a", nodes, cameraRef, autoFitRef, 15);
    return null;
  }
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(Probe, { nodes: [{ id: "a", x: Number.NaN, y: 0 }].filter(() => false) }));
  });
  // Placed by the layout before the delay is up.
  await act(async () => { r.update(createElement(Probe, { nodes: [{ id: "a", x: 5, y: 6 }] })); });
  await wait(40);
  assert.deepEqual(centred, [[5, 6]]);
  await act(async () => { r.unmount(); });
});