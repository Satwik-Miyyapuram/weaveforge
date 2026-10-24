import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDashboardLayout } from "../../../src/features/dashboard/domain/parse-dashboard-layout.js";
import { DASHBOARD_CARD_TYPES } from "../../../src/features/dashboard/domain/dashboard-layout.js";

test("parseDashboardLayout returns null only when the payload has no lg/sm arrays", () => {
  assert.equal(parseDashboardLayout(null), null);
  assert.equal(parseDashboardLayout("layout"), null);
  assert.equal(parseDashboardLayout({ lg: [] }), null);
  assert.equal(parseDashboardLayout({ lg: {}, sm: [] }), null);
});

test("one bad item is dropped, not the whole layout (35-11)", () => {
  const parsed = parseDashboardLayout({
    lg: [
      { id: "a", type: "reading-progress", x: 0, y: 0, w: 3, h: 2 },
      { id: "x", type: "card-from-a-newer-client", x: 3, y: 0, w: 1, h: 1 },
      { id: "b", type: "top-tags", x: 0, y: 2, w: "3", h: 2 },
      null,
      "junk",
    ],
    sm: [
      { id: "a", type: "reading-progress", x: 0, y: 0, w: 2, h: 2 },
      { type: "top-tags", x: 0, y: 2, w: 2, h: 2 },
    ],
  });
  assert.deepEqual(parsed, {
    lg: [{ id: "a", type: "reading-progress", x: 0, y: 0, w: 3, h: 2 }],
    sm: [{ id: "a", type: "reading-progress", x: 0, y: 0, w: 2, h: 2 }],
  });
});

test("a layout of only unknown cards parses to empty lists", () => {
  const parsed = parseDashboardLayout({
    lg: [{ id: "x", type: "not-a-type", x: 0, y: 0, w: 1, h: 1 }],
    sm: [],
  });
  assert.deepEqual(parsed, { lg: [], sm: [] });
});

test("an older stored layout parses, keeping config and ignoring extra keys", () => {
  const parsed = parseDashboardLayout({
    version: 1,
    lg: [{ id: "a", type: "recent-log", x: 0, y: 0, w: 4, h: 3, config: { limit: 5 } }],
    sm: [{ id: "a", type: "recent-log", x: 0, y: 0, w: 2, h: 3 }],
  });
  assert.deepEqual(parsed, {
    lg: [{ id: "a", type: "recent-log", x: 0, y: 0, w: 4, h: 3, config: { limit: 5 } }],
    sm: [{ id: "a", type: "recent-log", x: 0, y: 0, w: 2, h: 3 }],
  });
});

test("every card type the parser knows is accepted (02-18)", () => {
  for (const type of DASHBOARD_CARD_TYPES) {
    const item = { id: type, type, x: 0, y: 0, w: 1, h: 1 };
    assert.deepEqual(parseDashboardLayout({ lg: [item], sm: [] })?.lg, [item], type);
  }
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
