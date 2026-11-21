/**
 * The download's pause between papers does not leave abort listeners behind
 * (P2-203). Each pause added one to the walk's signal and never removed it,
 * so a long library piled up one per paper.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { pause } from "../application/parts-1";

function counted() {
  const controller = new AbortController();
  const { signal } = controller;
  let live = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
    live += 1;
    add(type, fn, opts);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((type: string, fn: EventListener, opts?: EventListenerOptions) => {
    live -= 1;
    remove(type, fn, opts);
  }) as typeof signal.removeEventListener;
  return { controller, signal, live: () => live };
}

test("pauses that run out remove their abort listener", async () => {
  const { signal, live } = counted();
  for (let i = 0; i < 5; i += 1) await pause(0, signal);
  assert.equal(live(), 0, "each pause left its listener on the signal");
});

test("an abort still ends a pause at once", async () => {
  const { controller, signal } = counted();
  const started = Date.now();
  const waiting = pause(60_000, signal);
  controller.abort();
  await waiting;
  assert.ok(Date.now() - started < 1000);
});
