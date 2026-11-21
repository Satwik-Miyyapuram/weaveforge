import { test } from "node:test";
import assert from "node:assert/strict";
import type { DocumentSearchMatch, PageTextItem } from "@weaveforge/wasm";
import { coalesceToFrame, measureFindDomBoxes } from "../ui/find-overlay.js";

test("measureFindDomBoxes returns null when document is undefined or DOM layout is unavailable", () => {
  // In pure Node.js without browser DOM Range layout, it returns null cleanly so geometric fallback is used
  const items: PageTextItem[] = [
    { str: "Inductive ", transform: [1, 0, 0, 1, 72, 700], width: 50, height: 12 },
    { str: "Graphs", transform: [1, 0, 0, 1, 122, 700], width: 45, height: 12 },
  ];
  const matches: DocumentSearchMatch[] = [
    { pageIndex: 0, start: 10, end: 15 },
  ];

  const dummyEl = {} as HTMLElement;
  const result = measureFindDomBoxes(dummyEl, dummyEl, items, matches, 0, 0);
  assert.equal(result, null);
});

test("mutations in one frame run the measure once, and cancel drops a pending run (P2-172)", () => {
  const frames: (() => void)[] = [];
  const cancelled: number[] = [];
  let runs = 0;
  const coalesced = coalesceToFrame(
    () => runs++,
    (cb) => frames.push(cb),
    (id) => cancelled.push(id),
  );
  coalesced.schedule();
  coalesced.schedule();
  coalesced.schedule();
  assert.equal(frames.length, 1, "one frame for a burst of mutations");
  frames[0]!();
  assert.equal(runs, 1);
  coalesced.schedule();
  assert.equal(frames.length, 2, "a later mutation asks for a new frame");
  coalesced.cancel();
  assert.deepEqual(cancelled, [2]);
});

test("measureFindDomBoxes looks each span up once, not per match (P2-172)", () => {
  const g = globalThis as { document?: unknown; NodeFilter?: unknown };
  const had = { document: "document" in g, NodeFilter: "NodeFilter" in g };
  const old = { document: g.document, NodeFilter: g.NodeFilter };
  g.NodeFilter = { SHOW_TEXT: 4 };
  g.document = {
    createTreeWalker: (span: { text: { textContent: string } }) => {
      let done = false;
      return { nextNode: () => (done ? null : ((done = true), span.text)) };
    },
    createRange: () => ({
      setStart() {},
      setEnd() {},
      getClientRects: () => [{ left: 10, top: 20, width: 5, height: 8 }],
    }),
  };
  try {
    const items: PageTextItem[] = [
      { str: "aa aa ", transform: [1, 0, 0, 1, 0, 0], width: 30, height: 10 },
      { str: "aa", transform: [1, 0, 0, 1, 30, 0], width: 10, height: 10 },
    ];
    const spans = items.map((item, i) => ({
      text: { textContent: item.str },
      getAttribute: (name: string) => (name === "data-item-index" ? String(i) : null),
    }));
    let one = 0;
    let all = 0;
    const textLayer = {
      querySelector: () => { one++; return null; },
      querySelectorAll: () => { all++; return spans; },
    } as unknown as HTMLElement;
    const pageBox = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } as unknown as HTMLElement;
    const matches: DocumentSearchMatch[] = [
      { pageIndex: 0, start: 0, end: 2 },
      { pageIndex: 0, start: 3, end: 5 },
      { pageIndex: 0, start: 6, end: 8 },
    ];
    const boxes = measureFindDomBoxes(textLayer, pageBox, items, matches, 1, 0);
    assert.equal(boxes?.length, 3);
    assert.deepEqual(boxes?.map((b) => b.current), [false, true, false]);
    assert.equal(all, 1, "one querySelectorAll per measure");
    assert.equal(one, 0, "no querySelector per match");
  } finally {
    if (had.document) g.document = old.document;
    else delete g.document;
    if (had.NodeFilter) g.NodeFilter = old.NodeFilter;
    else delete g.NodeFilter;
  }
});