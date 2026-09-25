import assert from "node:assert/strict";
import test from "node:test";

import { RateLimiter, PASTE_FETCH_LIMIT } from "../rate-limit";

/**
 * The budget on pasted-resource fetches.
 *
 * What it has to be: a person pasting several images at once gets through, and a
 * loop does not. Both halves are asserted here rather than left to the route,
 * because the route can only show that *some* limit exists — this is where the
 * numbers and the refill are pinned. The clock is injected, so the suite does not
 * sleep for a minute to watch a bucket fill.
 */

test("a burst up to the capacity is allowed, and the next one is not", () => {
  let now = 0;
  const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now });

  assert.deepEqual(
    [limiter.take("u1").allowed, limiter.take("u1").allowed, limiter.take("u1").allowed],
    [true, true, true],
  );

  const refused = limiter.take("u1");
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.equal(refused.retryAfterSeconds, 1, "a second for the next token at 1/s");
});

test("the bucket refills with time, and never past its capacity", () => {
  let now = 0;
  const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 0.5, now: () => now });

  limiter.take("u1");
  limiter.take("u1");
  assert.equal(limiter.take("u1").allowed, false);

  // Half a token a second: two seconds per request.
  now += 2000;
  assert.equal(limiter.take("u1").allowed, true);
  assert.equal(limiter.take("u1").allowed, false, "one token, one request");

  // An hour of idling does not bank an hour of requests.
  now += 3_600_000;
  assert.equal(limiter.take("u1").allowed, true);
  assert.equal(limiter.take("u1").allowed, true);
  assert.equal(limiter.take("u1").allowed, false, "capped at the capacity, not at the total");
});

test("one caller's spending does not spend another's", () => {
  const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 0.001, now: () => 0 });

  assert.equal(limiter.take("u1").allowed, true);
  assert.equal(limiter.take("u1").allowed, false);
  assert.equal(limiter.take("u2").allowed, true, "a bucket per identity");
});

test("a clock that goes backwards does not mint tokens", () => {
  // NTP steps the clock back; without the guard the elapsed time is negative and
  // the bucket gains tokens for time that has not passed.
  let now = 10_000;
  const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1, now: () => now });

  limiter.take("u1");
  now -= 5_000;
  assert.equal(limiter.take("u1").allowed, false);
});

test("the product budget lets a page of figures through and starves a loop", () => {
  // The numbers themselves: twenty at once, then half a request a second. Written
  // as assertions on the exported policy so a change to it has to change this.
  assert.equal(PASTE_FETCH_LIMIT.capacity, 20);
  assert.equal(PASTE_FETCH_LIMIT.refillPerSecond, 0.5);

  let now = 0;
  const limiter = new RateLimiter({ ...PASTE_FETCH_LIMIT, now: () => now });
  let allowed = 0;
  for (let i = 0; i < 40; i += 1) if (limiter.take("u1").allowed) allowed += 1;
  assert.equal(allowed, 20, "a burst of twenty gets through");

  // A loop asking as fast as it can gets half a request per second after that.
  now += 10_000;
  let second = 0;
  for (let i = 0; i < 40; i += 1) if (limiter.take("u1").allowed) second += 1;
  assert.equal(second, 5, "ten seconds of refill, five requests");
});
