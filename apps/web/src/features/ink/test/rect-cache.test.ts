// Perf review I3-I5: the pen path read getBoundingClientRect per sample, per
// move and per trail update, forcing layout on every pointermove. The cache
// reads each element once, until something can move it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRectCache } from "../ui/rect-cache";

class FakeObserver {
  static last: FakeObserver | null = null;
  observed: Element[] = [];
  constructor(readonly callback: () => void) {
    FakeObserver.last = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {}
}

function element(): { el: Element; reads: () => number; move: (left: number) => void } {
  let reads = 0;
  let left = 10;
  const el = {
    getBoundingClientRect: () => {
      reads += 1;
      return { left, top: 20, width: 300, height: 400, right: left + 300, bottom: 420 } as DOMRect;
    },
  } as unknown as Element;
  return { el, reads: () => reads, move: (l) => { left = l; } };
}

function setup() {
  const target = new EventTarget();
  const cache = createRectCache(target, FakeObserver as unknown as typeof ResizeObserver);
  return { target, cache };
}

test("pointermoves between invalidations read layout once", () => {
  const { cache } = setup();
  const { el, reads } = element();
  for (let i = 0; i < 50; i += 1) cache.rect(el);
  assert.equal(reads(), 1, "one layout read for 50 samples");
  assert.equal(cache.rect(el).left, 10);
});

test("a pointerdown, pointerup, scroll or resize drops the cached rect", () => {
  for (const type of ["pointerdown", "pointerup", "pointercancel", "scroll", "resize"]) {
    const { target, cache } = setup();
    const { el, reads, move } = element();
    cache.rect(el);
    move(99);
    target.dispatchEvent(new Event(type));
    assert.equal(cache.rect(el).left, 99, `${type} re-reads`);
    assert.equal(reads(), 2);
  }
});

test("the element resizing drops the cached rect", () => {
  const { cache } = setup();
  const { el, reads } = element();
  cache.rect(el);
  assert.deepEqual(FakeObserver.last?.observed, [el], "the element is observed once read");
  FakeObserver.last?.callback();
  cache.rect(el);
  assert.equal(reads(), 2);
});

test("without a window (tests, SSR) every call reads fresh", () => {
  const cache = createRectCache(null, undefined);
  const { el, reads } = element();
  cache.rect(el);
  cache.rect(el);
  assert.equal(reads(), 2);
});
