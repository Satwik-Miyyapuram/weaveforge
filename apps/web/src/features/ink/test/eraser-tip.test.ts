import assert from "node:assert/strict";
import test from "node:test";

import {
  PEN_ERASER_BIT,
  PEN_ERASER_BUTTON,
  isPenEraserPointer,
} from "../application/eraser-tip";

test("the pen's fifth button is the eraser end, on down and while held", () => {
  // The down that begins the contact reports `button: 5`; every later event
  // reports `button: -1` and carries the bit in `buttons`.
  const down = { pointerType: "pen", button: PEN_ERASER_BUTTON, buttons: PEN_ERASER_BIT };
  const held = { pointerType: "pen", button: -1, buttons: PEN_ERASER_BIT };
  assert.equal(isPenEraserPointer(down), true);
  assert.equal(isPenEraserPointer(held), true);
});

test("each spelling alone is enough: a driver that sets only one still erases", () => {
  assert.equal(
    isPenEraserPointer({ pointerType: "pen", button: PEN_ERASER_BUTTON }),
    true,
  );
  assert.equal(
    isPenEraserPointer({ pointerType: "pen", buttons: PEN_ERASER_BIT }),
    true,
  );
});

test("a writing pen, a hover, a finger and a mouse never erase", () => {
  // The nib: button 0 on down, bit 1 held.
  assert.equal(isPenEraserPointer({ pointerType: "pen", button: 0, buttons: 1 }), false);
  // A hover reports no buttons at all — the back tip must not erase mid-air.
  assert.equal(isPenEraserPointer({ pointerType: "pen", button: -1, buttons: 0 }), false);
  // A finger and a mouse are never a pen's back tip, whatever their bits say.
  assert.equal(isPenEraserPointer({ pointerType: "touch", buttons: PEN_ERASER_BIT }), false);
  assert.equal(isPenEraserPointer({ pointerType: "mouse", buttons: PEN_ERASER_BIT }), false);
  // A barrel button (bit 2) is not the eraser either.
  assert.equal(isPenEraserPointer({ pointerType: "pen", button: 2, buttons: 4 }), false);
});
