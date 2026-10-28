/**
 * The paper and the writing hand are the note's (§6.2.12, §4.1): a change
 * updates the header that is written back, every page already loaded, and the
 * state the bar reads, and it is a save.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { InkHand, InkNoteMeta, InkPaper } from "@weaveforge/core";

import { renderHook } from "@/lib/test/react-harness";
import type { InkStoredPage } from "../application/ink-chunk-store";
import { useInkMetaSetters } from "../ui/use-ink-meta-setters";

function setup() {
  const metaRef = { current: { hand: "right", paper: "blank" } as InkNoteMeta };
  const pagesRef = {
    current: [
      { chunkId: "a", chunk: null, paper: "blank" },
      { chunkId: "b", chunk: null, paper: "blank" },
    ] as InkStoredPage[],
  };
  const calls = { hand: [] as InkHand[], paper: [] as InkPaper[], saves: 0 };
  const deps = {
    metaRef,
    pagesRef,
    setHandState: (h: InkHand) => void calls.hand.push(h),
    setPaperState: (p: InkPaper) => void calls.paper.push(p),
    scheduleSave: () => void calls.saves++,
  };
  return { metaRef, pagesRef, calls, deps };
}

test("a new paper reaches the header, every loaded page and the bar, and saves", async () => {
  const { metaRef, pagesRef, calls, deps } = setup();
  const h = await renderHook(() => useInkMetaSetters(deps), undefined);
  h.current.setPaper("grid");
  assert.equal(metaRef.current.paper, "grid");
  assert.equal(metaRef.current.hand, "right", "the hand is kept");
  assert.deepEqual(pagesRef.current.map((p) => p.paper), ["grid", "grid"]);
  assert.deepEqual(calls.paper, ["grid"]);
  assert.equal(calls.saves, 1);
});

test("a new hand reaches the header and the bar, and saves", async () => {
  const { metaRef, calls, deps } = setup();
  const h = await renderHook(() => useInkMetaSetters(deps), undefined);
  h.current.setHand("left");
  assert.equal(metaRef.current.hand, "left");
  assert.equal(metaRef.current.paper, "blank", "the paper is kept");
  assert.deepEqual(calls.hand, ["left"]);
  assert.equal(calls.saves, 1);
});

test("before the pages load, a paper change still saves", async () => {
  const { calls, deps } = setup();
  const h = await renderHook(() => useInkMetaSetters({ ...deps, pagesRef: { current: null } }), undefined);
  h.current.setPaper("ruled");
  assert.equal(calls.saves, 1);
});
