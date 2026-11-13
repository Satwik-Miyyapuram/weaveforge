import assert from "node:assert/strict";
import { before, test } from "node:test";

import {
  PEN_ERASER_BIT,
  PEN_ERASER_BUTTON,
  EraserSweep,
} from "../application/parts-1";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

test("the pen's fifth button is the eraser end, on down and while held", () => {
  // The down that begins the contact reports `button: 5`; every later event
  // reports `button: -1` and carries the bit in `buttons`.
  const down = { pointerType: "pen", button: PEN_ERASER_BUTTON, buttons: PEN_ERASER_BIT };
  const held = { pointerType: "pen", button: -1, buttons: PEN_ERASER_BIT };
  assert.equal(readyCore().isPenEraserPointer(down.pointerType, down.button, down.buttons), true);
  assert.equal(readyCore().isPenEraserPointer(held.pointerType, held.button, held.buttons), true);
});

test("each spelling alone is enough: a driver that sets only one still erases", () => {
  assert.equal(
    readyCore().isPenEraserPointer("pen", PEN_ERASER_BUTTON, undefined),
    true,
  );
  assert.equal(
    readyCore().isPenEraserPointer("pen", undefined, PEN_ERASER_BIT),
    true,
  );
});

test("a writing pen, a hover, a finger and a mouse never erase", () => {
  // The nib: button 0 on down, bit 1 held.
  assert.equal(readyCore().isPenEraserPointer("pen", 0, 1), false);
  // A hover reports no buttons at all — the back tip must not erase mid-air.
  assert.equal(readyCore().isPenEraserPointer("pen", -1, 0), false);
  // A finger and a mouse are never a pen's back tip, whatever their bits say.
  assert.equal(readyCore().isPenEraserPointer("touch", undefined, PEN_ERASER_BIT), false);
  assert.equal(readyCore().isPenEraserPointer("mouse", undefined, PEN_ERASER_BIT), false);
  // A barrel button (bit 2) is not the eraser either.
  assert.equal(readyCore().isPenEraserPointer("pen", 2, 4), false);
});

test("eraser sweep: the back tip erases under any tool and shows the eraser until it leaves", () => {
  const sweep = new EraserSweep("eraser");
  const page = { style: { cursor: "crosshair" } };
  const tip = { pointerType: "pen", button: PEN_ERASER_BUTTON, buttons: PEN_ERASER_BIT, pointerId: 7, currentTarget: page };
  const nib = { pointerType: "pen", button: 0, buttons: 1, pointerId: 8, currentTarget: page };

  assert.equal(sweep.begin(nib, false, true), false, "the writing end draws");
  assert.equal(page.style.cursor, "crosshair");
  assert.equal(sweep.begin(tip, false, false), false, "a tool that forbids the tip (lasso) keeps it");
  assert.equal(sweep.begin(tip, false, true), true);
  assert.equal(page.style.cursor, "eraser");
  assert.equal(sweep.owns(7), true);
  assert.equal(sweep.owns(8), false);
  assert.equal(sweep.end(8), false, "another pointer does not end it");
  assert.equal(sweep.end(7), true);
  assert.equal(page.style.cursor, "eraser", "the lifted back tip still hovers as the eraser");
  assert.equal(sweep.owns(7), false);
  sweep.leave(7);
  assert.equal(page.style.cursor, "crosshair", "the tool's cursor comes back");
});

test("eraser sweep: the eraser tool sweeps with any pointer", () => {
  const sweep = new EraserSweep("eraser");
  const finger = { pointerType: "touch", button: 0, buttons: 1, pointerId: 3, currentTarget: null };
  assert.equal(sweep.begin(finger, true, false), true);
  assert.equal(sweep.owns(3), true);
  assert.equal(sweep.end(3), true);
});
