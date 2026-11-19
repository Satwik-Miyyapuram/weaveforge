import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerSamples, type SampleEvent } from "../application/pointer-samples";

function ev(x: number, y: number, extra: Partial<SampleEvent> = {}): SampleEvent {
  return { clientX: x, clientY: y, pressure: 0.5, ...extra };
}

test("every coalesced sample is kept, in order, before the dispatched event", () => {
  const a = ev(1, 1);
  const b = ev(2, 2);
  const c = ev(3, 3);
  const dispatched = ev(4, 4, { getCoalescedEvents: () => [a, b, c] });
  assert.deepEqual(pointerSamples(dispatched).map((e) => e.clientX), [1, 2, 3, 4]);
});

test("without getCoalescedEvents the dispatched event alone is the sample", () => {
  const only = ev(7, 7);
  assert.deepEqual(pointerSamples(only), [only]);
});

test("an empty or missing coalesced list still keeps the dispatched event", () => {
  const none = ev(5, 5, { getCoalescedEvents: () => [] });
  assert.deepEqual(pointerSamples(none).map((e) => e.clientX), [5]);
  const broken = ev(6, 6, { getCoalescedEvents: () => { throw new Error("no"); } });
  assert.deepEqual(pointerSamples(broken).map((e) => e.clientX), [6]);
});

test("a dense run of samples is not thinned: no distance filter", () => {
  const run = Array.from({ length: 50 }, (_, i) => ev(i * 0.2, 0));
  const dispatched = ev(10, 0, { getCoalescedEvents: () => run });
  assert.equal(pointerSamples(dispatched).length, 51);
});
