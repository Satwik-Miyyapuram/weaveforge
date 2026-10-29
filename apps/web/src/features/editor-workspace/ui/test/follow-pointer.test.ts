import { test } from "node:test";
import assert from "node:assert/strict";

import { followPointer } from "../follow-pointer";

function pointer(type: string, clientX = 0): Event {
  return Object.assign(new Event(type), { clientX });
}

test("moves reach the handler until pointerup (28-04)", () => {
  const target = new EventTarget();
  const seen: number[] = [];
  followPointer(target, (event) => seen.push(event.clientX));
  target.dispatchEvent(pointer("pointermove", 1));
  target.dispatchEvent(pointer("pointerup"));
  target.dispatchEvent(pointer("pointermove", 2));
  assert.deepEqual(seen, [1]);
});

test("pointercancel tears the drag down too (28-04)", () => {
  const target = new EventTarget();
  const seen: number[] = [];
  followPointer(target, (event) => seen.push(event.clientX));
  target.dispatchEvent(pointer("pointermove", 1));
  target.dispatchEvent(pointer("pointercancel"));
  target.dispatchEvent(pointer("pointermove", 2));
  target.dispatchEvent(pointer("pointerup"));
  target.dispatchEvent(pointer("pointermove", 3));
  assert.deepEqual(seen, [1]);
});

test("the returned stop ends the drag early, and twice is harmless", () => {
  const target = new EventTarget();
  const seen: number[] = [];
  const stop = followPointer(target, (event) => seen.push(event.clientX));
  stop();
  stop();
  target.dispatchEvent(pointer("pointermove", 1));
  assert.deepEqual(seen, []);
});
