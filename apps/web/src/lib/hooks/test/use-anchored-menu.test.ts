import { test } from "node:test";
import assert from "node:assert/strict";
import { restingBox } from "../use-anchored-menu.js";

const box = { left: 103, top: 53, bottom: 83, width: 120 };

test("restingBox removes a pressed trigger's translate (brutal: 3px 3px)", () => {
  assert.deepEqual(restingBox(box, "3px 3px"), { left: 100, top: 50, bottom: 80, width: 120 });
});

test("restingBox removes a lifted trigger's translate (crt: -2px -2px)", () => {
  assert.deepEqual(restingBox(box, "-2px -2px"), { left: 105, top: 55, bottom: 85, width: 120 });
});

test("restingBox treats a single translate value as x only", () => {
  assert.deepEqual(restingBox(box, "3px"), { left: 100, top: 53, bottom: 83, width: 120 });
});

test("restingBox leaves the box alone when there is no translate", () => {
  for (const t of ["none", "", "0px 0px", undefined]) {
    assert.deepEqual(restingBox(box, t), box, String(t));
  }
});

test("restingBox ignores non-pixel parts", () => {
  assert.deepEqual(restingBox(box, "10% 2px"), { left: 103, top: 51, bottom: 81, width: 120 });
});
