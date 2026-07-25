import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDashboardLayout } from "../src/features/dashboard/domain/parse-dashboard-layout.js";

test("parseDashboardLayout returns null for invalid payloads", () => {
  assert.equal(parseDashboardLayout(null), null);
  assert.equal(parseDashboardLayout({ lg: [] }), null);
  assert.equal(
    parseDashboardLayout({
      lg: [{ id: "x", type: "not-a-type", x: 0, y: 0, w: 1, h: 1 }],
      sm: [],
    }),
    null,
  );
});

test("parseDashboardLayout parses valid layout without compaction", () => {
  const parsed = parseDashboardLayout({
    lg: [{ id: "a", type: "reading-progress", x: 0, y: 0, w: 3, h: 2 }],
    sm: [{ id: "a", type: "reading-progress", x: 0, y: 0, w: 2, h: 2 }],
  });
  assert.ok(parsed);
  assert.equal(parsed!.lg[0]!.y, 0);
});

test("parseDashboardLayout accepts empty arrays", () => {
  const parsed = parseDashboardLayout({ lg: [], sm: [] });
  assert.deepEqual(parsed, { lg: [], sm: [] });
});
