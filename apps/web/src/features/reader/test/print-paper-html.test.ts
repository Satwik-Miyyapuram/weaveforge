/**
 * The hidden print frame always goes away (P2-205). It was removed only on
 * `afterprint`, so a print that threw, or a browser that never fired the
 * event, left one frame in the page per print.
 */
import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { PRINT_FRAME_TTL_MS, printPaperHtml } from "../ui/paper-html-view";

before(async () => { await loadTestCore(); });

type Listener = () => void;

/** A fake document whose one iframe records listeners and removal. */
function fakePage(print: () => void) {
  const state = { removed: 0, onLoad: null as Listener | null, afterprint: null as Listener | null };
  const frame = {
    style: {},
    setAttribute() {},
    set srcdoc(_v: string) {},
    addEventListener(type: string, fn: Listener) { if (type === "load") state.onLoad = fn; },
    remove() { state.removed += 1; },
    contentWindow: {
      addEventListener(type: string, fn: Listener) { if (type === "afterprint") state.afterprint = fn; },
      focus() {},
      print,
    },
  };
  const realDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => frame,
    body: { appendChild() {} },
  };
  return { state, restore: () => { (globalThis as { document?: unknown }).document = realDocument; } };
}

const page = {
  paperId: "p1",
  url: "https://example.org/p1",
  title: "T",
  html: "<p>x</p>",
  savedAt: "2026-01-01T00:00:00Z",
} as never;

test("a print that throws still removes the frame (P2-205)", () => {
  const p = fakePage(() => { throw new Error("print blocked"); });
  try {
    printPaperHtml(page);
    assert.throws(() => p.state.onLoad!(), /print blocked/);
    assert.equal(p.state.removed > 0, true);
  } finally {
    p.restore();
  }
});

test("a frame whose afterprint never fires is removed after a while (P2-205)", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const p = fakePage(() => {});
  try {
    printPaperHtml(page);
    p.state.onLoad!();
    assert.equal(p.state.removed, 0, "still there while the dialog may be open");
    mock.timers.tick(PRINT_FRAME_TTL_MS);
    assert.equal(p.state.removed > 0, true);
  } finally {
    p.restore();
    mock.timers.reset();
  }
});

test("afterprint removes the frame and the fallback does nothing more", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const p = fakePage(() => {});
  try {
    printPaperHtml(page);
    p.state.onLoad!();
    p.state.afterprint!();
    assert.equal(p.state.removed, 1);
    mock.timers.tick(PRINT_FRAME_TTL_MS);
    assert.equal(p.state.removed, 1);
  } finally {
    p.restore();
    mock.timers.reset();
  }
});