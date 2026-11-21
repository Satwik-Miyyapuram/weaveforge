/**
 * A delay that runs out takes its abort listener off the run's signal
 * (P2-257). Each paper of a long run added one and none came off, so they
 * piled up on the one long-lived signal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { abortableDelay } from "../application/parts-1";

function countingSignal() {
  const controller = new AbortController();
  const signal = controller.signal;
  let live = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((...args: Parameters<typeof add>) => { live += 1; add(...args); }) as typeof add;
  signal.removeEventListener = ((...args: Parameters<typeof remove>) => { live -= 1; remove(...args); }) as typeof remove;
  return { controller, signal, live: () => live };
}

test("a delay that runs out removes its abort listener (P2-257)", async () => {
  const s = countingSignal();
  for (let i = 0; i < 3; i++) await abortableDelay(1, s.signal);
  assert.equal(s.live(), 0);
});

test("an abort still ends the delay at once", async () => {
  const s = countingSignal();
  const started = Date.now();
  const waiting = abortableDelay(60_000, s.signal);
  s.controller.abort();
  await waiting;
  assert.ok(Date.now() - started < 1_000);
});

test("no signal is fine", async () => {
  await abortableDelay(1);
});