/** One date format in the UI: "1 Jul 2026", relative under a week (D12, D-01). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDate, formatDateTime, formatRelative } from "../format-date";

const now = new Date("2026-07-10T12:00:00");

test("a date reads day, short month, year", () => {
  assert.equal(formatDate("2026-07-01"), "1 Jul 2026");
  assert.equal(formatDate("2025-12-18T09:30:00Z"), "18 Dec 2025");
});

test("a date and time uses the 24 h clock", () => {
  assert.equal(formatDateTime(new Date("2026-07-01T14:05:00").toISOString()), "1 Jul 2026, 14:05");
});

test("missing or broken input shows nothing", () => {
  for (const bad of [null, undefined, "", "not a date"]) {
    assert.equal(formatDate(bad), "");
    assert.equal(formatDateTime(bad), "");
    assert.equal(formatRelative(bad, now), "");
  }
});

test("recent activity reads relative, older falls back to the date", () => {
  assert.equal(formatRelative("2026-07-10T11:59:40", now), "Just now");
  assert.equal(formatRelative("2026-07-10T11:55:00", now), "5m ago");
  assert.equal(formatRelative("2026-07-10T10:00:00", now), "2h ago");
  assert.equal(formatRelative("2026-07-07T12:00:00", now), "3d ago");
  assert.equal(formatRelative("2026-07-01T12:00:00", now), "1 Jul 2026");
  // A clock a little ahead never says "in 2m".
  assert.equal(formatRelative("2026-07-10T12:02:00", now), "Just now");
});
