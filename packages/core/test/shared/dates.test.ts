/**
 * addDays is calendar arithmetic on a date string (01-04): the answer must not
 * depend on the machine's time zone or a daylight-saving change in between.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { addDays, localIsoDate } from "../../src/shared/dates.js";

/** Run `body` with the process in another time zone, then put it back. */
function inZone(zone: string, body: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    body();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

const ZONES = ["UTC", "Pacific/Auckland", "Pacific/Kiritimati", "America/Los_Angeles", "Pacific/Pago_Pago", "Europe/Amsterdam"];

for (const zone of ZONES) {
  test(`addDays gives calendar dates in ${zone}`, () => {
    inZone(zone, () => {
      assert.equal(addDays("2026-01-15", 14), "2026-01-29");
      assert.equal(addDays("2026-01-15", 0), "2026-01-15");
      assert.equal(addDays("2026-03-01", -1), "2026-02-28");
      assert.equal(addDays("2024-02-28", 1), "2024-02-29", "leap day");
      assert.equal(addDays("2026-12-31", 1), "2027-01-01", "year end");
      // Across the spring and autumn clock changes in both hemispheres.
      assert.equal(addDays("2026-03-28", 2), "2026-03-30");
      assert.equal(addDays("2026-04-04", 2), "2026-04-06");
      assert.equal(addDays("2026-09-26", 2), "2026-09-28");
      assert.equal(addDays("2026-10-24", 2), "2026-10-26");
      assert.equal(addDays("2026-11-01", 1), "2026-11-02");
    });
  });
}

test("localIsoDate: the local calendar date, even near midnight (35-20)", () => {
  // Built from local fields, so the answer holds in every time zone.
  assert.equal(localIsoDate(new Date(2026, 0, 1, 23, 59)), "2026-01-01");
  assert.equal(localIsoDate(new Date(2026, 0, 2, 0, 1)), "2026-01-02");
  assert.equal(localIsoDate(new Date(2026, 11, 31, 23, 30)), "2026-12-31");
  assert.equal(localIsoDate(new Date(2026, 8, 5, 12)), "2026-09-05");
});
