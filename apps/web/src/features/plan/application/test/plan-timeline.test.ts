import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Milestone } from "@weaveforge/core";

import { clusterMarks, daysUntilDate, planPace, planTimeline } from "../plan-timeline";

const ms = (id: string, targetDate: string | undefined, status: Milestone["status"] = "planned") =>
  ({ id, title: id, targetDate, status, dependencies: [], compute: [] }) as unknown as Milestone;

const now = new Date(2026, 8, 26);

test("no dated milestone, no timeline", () => {
  assert.equal(planTimeline([ms("a", undefined)], now), null);
});

test("marks are placed in date order and today sits on the track", () => {
  const t = planTimeline([ms("late", "2026-12-26"), ms("early", "2026-07-26", "done")], now)!;
  assert.deepEqual(t.marks.map((m) => m.id), ["early", "late"]);
  assert.equal(t.marks[0]?.at, 0);
  assert.equal(t.marks[1]?.at, 100);
  assert.ok(t.today > 40 && t.today < 60);
});

test("today before every milestone starts the track", () => {
  const t = planTimeline([ms("a", "2026-12-01")], now)!;
  assert.equal(t.today, 0);
  assert.equal(t.marks[0]?.at, 100);
});

test("month ticks are thinned to six at most", () => {
  const t = planTimeline([ms("a", "2025-01-01"), ms("b", "2027-12-01")], now)!;
  assert.ok(t.months.length <= 6 && t.months.length > 0);
  assert.ok(t.months.every((m, i, all) => i === 0 || m.at > all[i - 1]!.at));
});

test("pace counts overdue and due-soon milestones, ignoring done ones", () => {
  assert.equal(planPace([ms("a", "2026-10-01"), ms("b", "2026-12-01")], now), "on track · 1 due soon");
  assert.equal(planPace([ms("a", "2026-09-01"), ms("b", "2026-09-01", "done")], now), "1 overdue");
});

test("marks closer than the gap fold into one cluster", () => {
  const mk = (id: string, at: number) => ({ id, title: id, status: "planned" as const, at });
  const c = clusterMarks([mk("a", 10), mk("b", 11), mk("c", 12.5), mk("d", 40)], 2);
  assert.deepEqual(c.map((x) => x.marks.map((m) => m.id)), [["a", "b", "c"], ["d"]]);
  assert.equal(c[0]?.at, 11.25);
});

test("daysUntilDate counts calendar days, as planPace does (30-22)", () => {
  const late = new Date(2026, 8, 26, 23, 59);
  assert.equal(daysUntilDate("2026-09-26", late), 0);
  assert.equal(daysUntilDate("2026-09-27", late), 1);
  assert.equal(daysUntilDate("2026-09-25", late), -1);
  assert.equal(daysUntilDate("2026-10-10", late), 14);
  assert.equal(planPace([ms("a", "2026-10-10")], late), "on track · 1 due soon");
  assert.equal(planPace([ms("a", "2026-09-25")], late), "1 overdue");
});

test("daysUntilDate is one day across a 25-hour night", () => {
  const original = process.env.TZ;
  process.env.TZ = "Europe/Amsterdam";
  try {
    // Clocks go back on 25 October 2026: that day lasts 25 hours.
    const justAfterMidnight = new Date(2026, 9, 25, 0, 30);
    assert.equal(daysUntilDate("2026-10-26", justAfterMidnight), 1);
    assert.equal(daysUntilDate("2026-10-25", justAfterMidnight), 0);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
