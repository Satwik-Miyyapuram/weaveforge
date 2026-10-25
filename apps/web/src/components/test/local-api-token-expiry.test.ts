import assert from "node:assert/strict";
import { test } from "node:test";

import { customExpiryMin } from "../local-api-tokens";

function inZone<T>(zone: string, run: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

test("the earliest custom expiry is tomorrow in local time (12-07)", () => {
  // 21:30 in Los Angeles is already the next day in UTC.
  assert.equal(inZone("America/Los_Angeles", () => customExpiryMin(new Date(2026, 9, 25, 21, 30))), "2026-10-26");
  assert.equal(inZone("Asia/Tokyo", () => customExpiryMin(new Date(2026, 9, 25, 0, 30))), "2026-10-26");
});

test("tomorrow rolls over month and year ends", () => {
  assert.equal(customExpiryMin(new Date(2026, 11, 31, 12)), "2027-01-01");
  assert.equal(customExpiryMin(new Date(2028, 1, 28, 12)), "2028-02-29");
});
