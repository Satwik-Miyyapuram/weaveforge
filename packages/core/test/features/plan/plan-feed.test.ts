import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeIcsText,
  foldIcsLine,
  milestonesToIcs,
  planWidgetData,
  type FeedMilestone,
} from "../../../src/features/plan/application/plan-feed.js";
import type { Milestone } from "../../../src/features/plan/domain/milestone.js";

const now = new Date("2026-09-26T10:30:00Z");

function item(id: string, over: Partial<Milestone> = {}, projectName?: string): FeedMilestone {
  return {
    milestone: {
      id,
      title: `Milestone ${id}`,
      status: "planned",
      dependencies: [],
      compute: [],
      createdAt: "2026-01-01T00:00:00Z",
      ...over,
    },
    projectName,
  };
}

test("escapeIcsText escapes the four TEXT specials", () => {
  assert.equal(escapeIcsText("a\\b;c,d\ne\r\nf"), "a\\\\b\\;c\\,d\\ne\\nf");
});

test("foldIcsLine folds at 75 octets without splitting a multi-byte character", () => {
  const line = `SUMMARY:${"é".repeat(60)}`;
  const folded = foldIcsLine(line);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(Buffer.byteLength(part, "utf8") <= 75, part);
  assert.equal(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join(""), line);
  assert.equal(foldIcsLine("SHORT:ok"), "SHORT:ok");
});

test("milestonesToIcs emits one all-day event per dated open milestone, soonest first", () => {
  const ics = milestonesToIcs(
    [
      item("b", { targetDate: "2026-10-20", title: "Submit draft, v2" }, "Thesis"),
      item("a", { targetDate: "2026-10-01" }),
      item("undated"),
      item("done", { targetDate: "2026-09-01", status: "done" }),
      item("bad", { targetDate: "2026-02-31" }),
    ],
    { now },
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
  assert.ok(ics.indexOf("UID:a@weaveforge.org") < ics.indexOf("UID:b@weaveforge.org"));
  assert.match(ics, /DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021/);
  assert.match(ics, /SUMMARY:⚑ Submit draft\\, v2/);
  assert.match(ics, /CATEGORIES:Thesis/);
  assert.match(ics, /DTSTAMP:20260926T103000Z/);
  assert.doesNotMatch(ics, /VALARM/);
  assert.ok(!ics.replace(/\r\n/g, "").includes("\n"), "every line ends in CRLF");
});

test("milestonesToIcs rolls month ends and adds reminders only to open deadlines", () => {
  const ics = milestonesToIcs(
    [item("m", { targetDate: "2026-12-31" }), item("d", { targetDate: "2026-11-01", status: "done" })],
    { now, includeDone: true, reminderDays: 2 },
  );
  assert.match(ics, /DTEND;VALUE=DATE:20270101/);
  assert.match(ics, /SUMMARY:✓ Milestone d/);
  assert.equal(ics.match(/BEGIN:VALARM/g)?.length, 1);
  assert.match(ics, /TRIGGER:-P2D/);
});

test("planWidgetData counts days, overdue and undated milestones", () => {
  const data = planWidgetData(
    [
      item("late", { targetDate: "2026-09-20" }),
      item("soon", { targetDate: "2026-09-29", status: "in_progress" }, " Lab "),
      item("open"),
      item("closed", { status: "done" }),
    ],
    { now },
  );
  assert.equal(data.today, "2026-09-26");
  assert.deepEqual(
    data.items.map((i) => [i.id, i.daysLeft, i.project]),
    [
      ["late", -6, null],
      ["soon", 3, "Lab"],
    ],
  );
  assert.equal(data.overdue, 1);
  assert.equal(data.undated, 1);
  assert.equal(planWidgetData([item("x", { targetDate: "2026-10-01" }), item("y", { targetDate: "2026-10-02" })], { now, limit: 1 }).items.length, 1);
});
