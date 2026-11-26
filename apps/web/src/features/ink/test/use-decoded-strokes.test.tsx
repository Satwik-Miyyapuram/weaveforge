/**
 * A chunk that will not decode shows as an empty page, and says why once
 * (21-21): the failure is logged the first time, not on every re-render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { InkStroke } from "@weaveforge/core";



import type { InkStoredPage } from "../application/parts-1";
import { useDecodedStrokes } from "../ui/use-decoded-strokes";
import { typedCore } from "@/lib/rust-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Log = { level: string; source: string; message: string; detail?: string };

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

test("a corrupt chunk is logged once and shows empty (21-21)", async () => {
  const logs: Log[] = [];
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (entry: Log) => void logs.push(entry) } };
  try {
    const pages: InkStoredPage[] = [
      { chunkId: typedCore().newInkChunkId(), chunk: new Uint8Array([1, 2, 3, 4]), paper: "blank" as InkStoredPage["paper"] },
    ];
    let map: ReadonlyMap<number, unknown> = new Map();
    function Probe({ version }: { version: number }) {
      map = useDecodedStrokes({ pages, version });
      return null;
    }
    let root: ReturnType<typeof create> | null = null;
    act(() => void (root = create(createElement(Probe, { version: 0 }))));
    await settle();
    act(() => root!.update(createElement(Probe, { version: 1 })));
    await settle();
    assert.deepEqual(map.get(0), []);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.source, "ink");
    act(() => root!.unmount());
  } finally {
    g.window = original;
  }
});

test("the worker's fresh copy of the live page keeps the strokes already shown, so the rail keeps its outlines", async () => {
  const pages: InkStoredPage[] = [{ chunkId: typedCore().newInkChunkId(), chunk: null, paper: "blank" as InkStoredPage["paper"] }];
  const stroke = (t0: number): InkStroke => ({
    points: [t0, 0, t0 + 1, 1], pressures: [128, 128], width: 5, tool: "pen", colour: "text", t0, shape: "none", lineIndex: -1,
  });
  const first = [stroke(1), stroke(2)];
  let map: ReadonlyMap<number, readonly InkStroke[]> = new Map();
  function Probe({ live }: { live: readonly InkStroke[] }) {
    map = useDecodedStrokes({ pages, live: { pageIndex: 0, strokes: live } });
    return null;
  }
  let root: ReturnType<typeof create> | null = null;
  act(() => void (root = create(createElement(Probe, { live: first }))));
  await settle();
  assert.equal(map.get(0), first);
  act(() => root!.update(createElement(Probe, { live: structuredClone(first) })));
  await settle();
  assert.equal(map.get(0), first);
  const added = [...structuredClone(first), stroke(3)];
  act(() => root!.update(createElement(Probe, { live: added })));
  await settle();
  assert.equal(map.get(0)?.[0], first[0]);
  assert.equal(map.get(0)?.[2], added[2]);
  act(() => root!.unmount());
});
