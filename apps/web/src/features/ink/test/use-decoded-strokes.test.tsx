/**
 * A chunk that will not decode shows as an empty page, and says why once
 * (21-21): the failure is logged the first time, not on every re-render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { newInkChunkId } from "@weaveforge/core";

import type { InkStoredPage } from "../application/ink-chunk-store";
import { useDecodedStrokes } from "../ui/use-decoded-strokes";

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
      { chunkId: newInkChunkId(), chunk: new Uint8Array([1, 2, 3, 4]), paper: "blank" as InkStoredPage["paper"] },
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
