import assert from "node:assert/strict";
import { test } from "node:test";

import { openWithRetry } from "../src/local-db-retry";

function opener(failures: number, value = "client") {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    open: async () => {
      calls += 1;
      if (calls <= failures) throw new Error(`attempt ${calls} failed`);
      return value;
    },
  };
}

function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

test("open with retry: a slow open is waited for, backing off", async () => {
  const o = opener(3);
  const s = sleeper();
  const client = await openWithRetry(o.open, { attempts: 10, backoffMs: 500, maxBackoffMs: 5000, sleep: s.sleep });
  assert.equal(client, "client");
  assert.equal(o.calls, 4);
  assert.deepEqual(s.waits, [500, 1000, 2000]);
});

// xlog-16: the recovery that follows says what failed; this does not say it first.
test("open with retry: giving up throws the last failure and logs nothing", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const error = t.mock.method(console, "error", () => undefined);
  const o = opener(Infinity);
  const s = sleeper();
  await assert.rejects(
    openWithRetry(o.open, { attempts: 5, backoffMs: 500, maxBackoffMs: 2000, sleep: s.sleep }),
    /attempt 5 failed/,
  );
  assert.equal(o.calls, 5);
  assert.deepEqual(s.waits, [500, 1000, 2000, 2000], "capped, and no wait after the last attempt");
  assert.equal(warn.mock.callCount() + error.mock.callCount(), 0);
});

test("open with retry: a failure that waiting cannot fix is thrown at once", async () => {
  const s = sleeper();
  let calls = 0;
  const busy = new Error("in use");
  await assert.rejects(
    openWithRetry(
      async () => {
        calls += 1;
        throw busy;
      },
      { attempts: 10, backoffMs: 500, maxBackoffMs: 5000, giveUpOn: (cause) => cause === busy, sleep: s.sleep },
    ),
    (thrown) => thrown === busy,
  );
  assert.equal(calls, 1);
  assert.deepEqual(s.waits, []);
});

test("open with retry: one attempt means no wait at all", async () => {
  const s = sleeper();
  await assert.rejects(openWithRetry(opener(1).open, { attempts: 1, backoffMs: 500, maxBackoffMs: 5000, sleep: s.sleep }));
  assert.deepEqual(s.waits, []);
});
