import assert from "node:assert/strict";
import test from "node:test";
import {
  hwndFromHandle,
  parseBounds,
  pinScript,
  placeWidget,
  PLAN_WIDGET_SIZE,
  widgetDataFromRows,
  type PlanWidgetRow,
} from "../src/plan-widget";

const now = new Date("2026-09-26T10:00:00Z");

function row(id: string, over: Partial<PlanWidgetRow> = {}): PlanWidgetRow {
  return {
    id,
    title: `Milestone ${id}`,
    description: null,
    status: "planned",
    target_date: null,
    dependencies: null,
    compute: null,
    created_at: "2026-01-01T00:00:00Z",
    project_name: null,
    ...over,
  };
}

test("widgetDataFromRows keeps dated open milestones, soonest first, with project names", () => {
  const data = widgetDataFromRows(
    [
      row("later", { target_date: "2026-10-10", project_name: "Thesis" }),
      row("late", { target_date: "2026-09-20" }),
      row("undated"),
      row("done", { target_date: "2026-09-28", status: "done" }),
    ],
    now,
  );
  assert.deepEqual(
    data.items.map((i) => [i.id, i.project, i.daysLeft]),
    [
      ["late", null, -6],
      ["later", "Thesis", 14],
    ],
  );
  assert.equal(data.undated, 1);
  assert.equal(data.overdue, 1);
});

test("widgetDataFromRows stops at what the widget has room for", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`m${i}`, { target_date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
  assert.equal(widgetDataFromRows(rows, now).items.length, 6);
});

test("parseBounds reads a saved position and refuses anything else", () => {
  assert.deepEqual(parseBounds('{"x":10.4,"y":-20}'), { x: 10, y: -20 });
  assert.equal(parseBounds(null), null);
  assert.equal(parseBounds(true), null);
  assert.equal(parseBounds("not json"), null);
  assert.equal(parseBounds('{"x":"1","y":2}'), null);
  assert.equal(parseBounds("[1,2]"), null);
});

test("placeWidget keeps a position that is on a screen and rescues one that is not", () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  assert.deepEqual(placeWidget({ x: 100, y: 100 }, areas), { x: 100, y: 100 });
  const rescued = placeWidget({ x: 3000, y: 100 }, areas);
  assert.equal(rescued.x, 1920 - PLAN_WIDGET_SIZE.width - 32);
  assert.equal(rescued.y, 32);
  // A second monitor to the left, at negative coordinates, is a real place.
  const two = [...areas, { x: -1280, y: 0, width: 1280, height: 1000 }];
  assert.deepEqual(placeWidget({ x: -1200, y: 50 }, two), { x: -1200, y: 50 });
  assert.deepEqual(placeWidget(null, areas), rescued);
});

test("hwndFromHandle reads a 64-bit and a 32-bit handle, little-endian", () => {
  const wide = new Uint8Array(8);
  new DataView(wide.buffer).setBigUint64(0, 0x1234_5678_9abcn, true);
  assert.equal(hwndFromHandle(wide), 0x1234_5678_9abcn);
  const narrow = new Uint8Array(4);
  new DataView(narrow.buffer).setUint32(0, 0x00aa_bbcc, true);
  assert.equal(hwndFromHandle(narrow), 0xaabbccn);
});

test("pinScript owns the window by the desktop and sends it to the bottom without activating it", () => {
  const script = pinScript(4_457_128n);
  assert.match(script, /\$window = \[IntPtr\]\[Int64\]4457128\n/);
  // A null name, not `$null`: PowerShell passes `$null` to a string parameter as "".
  assert.match(script, /FindWindow\('Progman', \[IntPtr\]::Zero\)/);
  assert.doesNotMatch(script, /\$null/);
  assert.match(script, /SetWindowLongPtr\(\$window, -8, \$desktop\)/);
  // HWND_BOTTOM, and SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE.
  assert.match(script, /SetWindowPos\(\$window, \[IntPtr\]1, 0, 0, 0, 0, 0x13\)/);
});
