import { test } from "node:test";
import assert from "node:assert/strict";
import { settleAfterLoad } from "../src/settle-after-load";

test("clears the cache once, a fixed delay after the first load", () => {
  const target = new EventTarget();
  const timers: { run: () => void; ms: number }[] = [];
  let cleared = 0;
  settleAfterLoad(target, () => void cleared++, 3000, (run, ms) => timers.push({ run, ms }));

  assert.equal(timers.length, 0, "nothing before load");
  target.dispatchEvent(new Event("load"));
  target.dispatchEvent(new Event("load"));
  assert.equal(timers.length, 1, "a second load schedules nothing");
  assert.equal(timers[0]?.ms, 3000);
  assert.equal(cleared, 0, "waits for the delay");
  timers[0]?.run();
  assert.equal(cleared, 1);
});
