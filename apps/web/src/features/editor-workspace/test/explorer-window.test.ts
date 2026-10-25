import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPLORER_FIRST_PAINT_ROWS,
  EXPLORER_OVERSCAN_ROWS,
  EXPLORER_ROW_PX,
  rowSlots,
  type RowSlot,
} from "../application/explorer-window";

const H = EXPLORER_ROW_PX;

function painted(slots: RowSlot[]): number[] {
  return slots.flatMap((slot) => (slot.kind === "row" ? [slot.index] : []));
}

/** Every row is either painted or stands inside a gap, exactly once. */
function covered(slots: RowSlot[]): number {
  return slots.reduce((sum, slot) => sum + (slot.kind === "row" ? 1 : slot.rows), 0);
}

test("2,000 files paint only the rows in view, plus the overscan", () => {
  const slots = rowSlots(2_000, { scrollTop: 0, height: 784, rowsTop: 0 }, []);
  const rows = painted(slots);
  assert.equal(rows.length, Math.ceil(784 / H) + EXPLORER_OVERSCAN_ROWS);
  assert.equal(rows[0], 0);
  assert.deepEqual(slots.at(-1), { kind: "gap", rows: 2_000 - rows.length });
  assert.equal(covered(slots), 2_000);
});

test("scrolled to the middle, the window moves with the scroll", () => {
  const scrollTop = 1_000 * H;
  const slots = rowSlots(2_000, { scrollTop, height: 500, rowsTop: 0 }, []);
  const rows = painted(slots);
  assert.equal(rows[0], 1_000 - EXPLORER_OVERSCAN_ROWS);
  assert.equal(rows.at(-1), 1_000 + 500 / H + EXPLORER_OVERSCAN_ROWS - 1);
  assert.deepEqual(slots[0], { kind: "gap", rows: 1_000 - EXPLORER_OVERSCAN_ROWS });
  assert.equal(covered(slots), 2_000);
});

test("the rows' own offset in the scroller is taken into account", () => {
  // A section whose rows start 300px down: at scrollTop 0 only the first
  // (784 - 300) / 25 rows are on screen.
  const rows = painted(rowSlots(2_000, { scrollTop: 0, height: 784, rowsTop: 300 }, []));
  assert.equal(rows.length, Math.ceil((784 - 300) / H) + EXPLORER_OVERSCAN_ROWS);
});

test("a section entirely out of view paints nothing but one gap", () => {
  const below = rowSlots(50, { scrollTop: 0, height: 400, rowsTop: 5_000 }, []);
  assert.deepEqual(below, [{ kind: "gap", rows: 50 }]);
  const above = rowSlots(50, { scrollTop: 10_000, height: 400, rowsTop: 0 }, []);
  assert.deepEqual(above, [{ kind: "gap", rows: 50 }]);
});

test("before the panel is measured, the first rows are painted", () => {
  const slots = rowSlots(2_000, null, []);
  assert.deepEqual(painted(slots), Array.from({ length: EXPLORER_FIRST_PAINT_ROWS }, (_, i) => i));
  assert.equal(covered(slots), 2_000);
});

test("a short list paints every row and no gap", () => {
  assert.deepEqual(rowSlots(3, null, []), [
    { kind: "row", index: 0 },
    { kind: "row", index: 1 },
    { kind: "row", index: 2 },
  ]);
  assert.deepEqual(rowSlots(0, { scrollTop: 0, height: 500, rowsTop: 0 }, [0]), []);
});

test("pinned rows stay painted out of view, with gaps either side", () => {
  // The focused row, a rename or a draft in progress must not unmount when the
  // list scrolls away from it: the input would lose its text, the tree its focus.
  const slots = rowSlots(2_000, { scrollTop: 0, height: 250, rowsTop: 0 }, [1_500, 1_500, -1, 9_999]);
  const rows = painted(slots);
  assert.equal(rows.at(-1), 1_500, "pinned once, out-of-range pins ignored");
  assert.equal(rows.length, 250 / H + EXPLORER_OVERSCAN_ROWS + 1);
  const pin = slots.findIndex((slot) => slot.kind === "row" && slot.index === 1_500);
  assert.equal(slots[pin - 1]?.kind, "gap");
  assert.deepEqual(slots[pin + 1], { kind: "gap", rows: 499 });
  assert.equal(covered(slots), 2_000);
});
