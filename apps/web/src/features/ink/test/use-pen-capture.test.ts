/**
 * Pen capture: the palm rules.
 *
 * The three layers of §3 are asserted one rule at a time, with synthetic
 * `PointerEvent`-shaped objects, because every rule is a comparison and none of
 * them needs a device. The session's "no-render-during-stroke" tests live in
 * pen-capture-session.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CSS_PX_PER_MM,
  InkPenGate,
  PALM_CONTACT_AREA_MM2,
  PALM_SECOND_TOUCH_MS,
  contactAreaMm2,
  type PenPointerEvent,
} from "../index";

/** A pointer event with sane defaults, so each test states only what it means. */
function pointer(
  overrides: Partial<PenPointerEvent> & { pointerType: string },
): PenPointerEvent {
  return {
    pointerId: 1,
    pressure: 0.5,
    width: 1,
    height: 1,
    clientX: 100,
    clientY: 100,
    t: 1_000,
    ...overrides,
  };
}

/** A surface 1000×800 at the origin, for the quadrant rule. */
const bounds = { left: 0, top: 0, width: 1_000, height: 800 };

test("contact area is converted from the CSS pixels a pointer reports", () => {
  assert.equal(
    contactAreaMm2({ width: 1, height: 1 }),
    (1 / CSS_PX_PER_MM) ** 2,
  );
  assert.equal(
    contactAreaMm2({ width: 0, height: 10 }),
    0,
    "a device with no contact box has none",
  );
  // 19 CSS px square is right at the 25 mm² threshold; 40 px square is a hand.
  assert.ok(contactAreaMm2({ width: 40, height: 40 }) > PALM_CONTACT_AREA_MM2);
  assert.ok(contactAreaMm2({ width: 5, height: 5 }) < PALM_CONTACT_AREA_MM2);
});

test("a pen draws immediately, and after it a touch only scrolls", () => {
  const gate = new InkPenGate();
  assert.equal(gate.decide(pointer({ pointerType: "pen" })), "draw");
  assert.equal(gate.hasSeenPen, true);
  // The reader's layer one, exactly: once a pen has been seen, touch never draws.
  assert.equal(gate.decide(pointer({ pointerType: "touch" })), "ignore");
  gate.reset();
  assert.equal(
    gate.decide(pointer({ pointerType: "mouse" })),
    "draw",
    "a mouse is not a palm",
  );
});

test("before any pen, a touch is deferred rather than refused", () => {
  const gate = new InkPenGate();
  assert.equal(gate.decide(pointer({ pointerType: "touch" })), "defer");
  const claim = gate.begin(pointer({ pointerType: "touch", t: 0 }));
  assert.equal(claim.decision, "defer");
  assert.equal(gate.activePointerId, 1);

  // The timer reports movement: this is a finger, and it draws.
  assert.equal(gate.confirm(1, { x: 140, y: 130 }), "draw");
  gate.end(1);
  assert.equal(gate.activePointerId, null);
});

test("a touch that has not moved is a palm", () => {
  const gate = new InkPenGate();
  gate.begin(pointer({ pointerType: "touch", t: 0 }));
  assert.equal(gate.confirm(1, { x: 100.5, y: 100 }), "ignore");
  assert.equal(gate.activePointerId, null, "and it never owned a stroke");
  // A timer with no movement at all is the same answer.
  gate.begin(pointer({ pointerType: "touch", t: 10 }));
  assert.equal(gate.confirm(1, null), "ignore");
});

test("a wide contact is a palm before any of the other rules run", () => {
  const gate = new InkPenGate();
  assert.equal(
    gate.decide(pointer({ pointerType: "touch", width: 60, height: 70 })),
    "ignore",
    "a 6 × 7 cm contact is a hand",
  );
});

test("a second touch while one is drawing cancels a young first stroke", () => {
  const gate = new InkPenGate();
  const first = gate.begin(
    pointer({ pointerType: "touch", pointerId: 1, t: 0 }),
  );
  assert.equal(first.decision, "defer");
  // A second contact 100 ms later: neither was writing.
  const second = gate.begin(
    pointer({ pointerType: "touch", pointerId: 2, t: 100 }),
  );
  assert.equal(second.decision, "ignore");
  assert.deepEqual(
    second.cancelled,
    [1],
    "the young first stroke is thrown away",
  );
  assert.equal(gate.activePointerId, null);
});

test("a second touch after a stroke is established leaves it alone", () => {
  const gate = new InkPenGate();
  gate.begin(pointer({ pointerType: "pen", pointerId: 1, t: 0 }));
  assert.equal(gate.activePointerId, 1);
  const second = gate.begin(
    pointer({ pointerType: "pen", pointerId: 2, t: PALM_SECOND_TOUCH_MS + 10 }),
  );
  assert.equal(second.decision, "ignore", "one stroke at a time");
  assert.deepEqual(second.cancelled, []);
  assert.equal(
    gate.activePointerId,
    1,
    "and the stroke in progress keeps the pointer",
  );
});

test("a touch in the writing hand's quadrant near a pen down is a palm", () => {
  const gate = new InkPenGate({ handedness: "right" });
  gate.notePenSeen(1_000);
  // Right-handed: the hand rests below and to the right.
  assert.equal(
    gate.palmReason(
      pointer({
        pointerType: "touch",
        clientX: 800,
        clientY: 700,
        bounds,
        t: 1_100,
      }),
    ),
    "quadrant",
  );
  // The other side of the page is not where a right hand rests.
  assert.equal(
    gate.palmReason(
      pointer({
        pointerType: "touch",
        clientX: 200,
        clientY: 200,
        bounds,
        t: 1_100,
      }),
    ),
    null,
  );
  // A pen only classifies a *touch*: a stylus is never a palm.
  assert.equal(
    gate.palmReason(
      pointer({ pointerType: "pen", clientX: 800, clientY: 700, bounds }),
    ),
    null,
  );
});

test("a left-handed writer's hand is on the other side", () => {
  const gate = new InkPenGate({ handedness: "left" });
  gate.notePenSeen(1_000);
  assert.equal(
    gate.palmReason(
      pointer({
        pointerType: "touch",
        clientX: 100,
        clientY: 700,
        bounds,
        t: 1_100,
      }),
    ),
    "quadrant",
  );
  assert.equal(
    gate.palmReason(
      pointer({
        pointerType: "touch",
        clientX: 900,
        clientY: 700,
        bounds,
        t: 1_100,
      }),
    ),
    null,
  );
});

test("the quadrant rule lapses outside the pen's window, and without a box", () => {
  const gate = new InkPenGate({ handedness: "right" });
  gate.notePenSeen(1_000);
  assert.equal(
    gate.palmReason(
      pointer({
        pointerType: "touch",
        clientX: 800,
        clientY: 700,
        bounds,
        t: 5_000,
      }),
    ),
    null,
    "ten seconds after the last pen down, a hand has moved on",
  );
  assert.equal(
    gate.palmReason(
      pointer({ pointerType: "touch", clientX: 800, clientY: 700, t: 1_100 }),
    ),
    null,
    "with no surface box the rule is skipped rather than guessed at",
  );
  const never = new InkPenGate({ handedness: "right" });
  assert.equal(
    never.palmReason(
      pointer({
        pointerType: "touch",
        clientX: 800,
        clientY: 700,
        bounds,
        t: 1_100,
      }),
    ),
    null,
    "and it never applies before a pen has been seen at all",
  );
});

test("a pen takes the surface from a touch, and the touch's stroke is discarded", () => {
  const gate = new InkPenGate({ handedness: "right" });
  // The hand lands first, in the corner the writing hand rests in, and the
  // deferral timer has not yet run — the palm is still "in progress".
  const palm = gate.begin(
    pointer({
      pointerType: "touch",
      pointerId: 21,
      clientX: 800,
      clientY: 700,
      bounds,
      t: 0,
    }),
  );
  assert.equal(
    palm.decision,
    "defer",
    "a touch with no pen yet is given its 120 ms",
  );
  // The pen arrives 80 ms later.
  const pen = gate.begin(
    pointer({
      pointerType: "pen",
      pointerId: 22,
      clientX: 100,
      clientY: 100,
      bounds,
      t: 80,
    }),
  );
  assert.equal(pen.decision, "draw", "a pen always draws");
  assert.deepEqual(pen.cancelled, [21], "and the hand's stroke goes with it");
  assert.equal(gate.activePointerId, 22);
});

test("the wrist guard overrides every touch rule", () => {
  const gate = new InkPenGate({ penOnly: true });
  assert.equal(gate.decide(pointer({ pointerType: "touch" })), "ignore");
  assert.equal(gate.decide(pointer({ pointerType: "pen" })), "draw");
  gate.penOnly = false;
  assert.equal(
    gate.decide(pointer({ pointerType: "touch" })),
    "ignore",
    "the pen has still been seen",
  );
  const fresh = new InkPenGate();
  assert.equal(fresh.decide(pointer({ pointerType: "touch" })), "defer");
});
