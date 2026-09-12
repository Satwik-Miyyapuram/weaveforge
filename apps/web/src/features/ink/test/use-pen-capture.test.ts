/**
 * Pen capture: the palm rules, and the property that keeps the pen fast.
 *
 * The three layers of §3 are asserted one rule at a time, with synthetic
 * `PointerEvent`-shaped objects, because every rule is a comparison and none of
 * them needs a device. The last test is the one the plan calls
 * "no-render-during-stroke": {@link PenCaptureSession} is a plain object, so a
 * 240 Hz stroke cannot re-render anything, and the only callback a screen may
 * re-render for fires once per stroke.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CSS_PX_PER_MM,
  InkPenGate,
  PALM_CONTACT_AREA_MM2,
  PALM_SECOND_TOUCH_MS,
  PenCaptureSession,
  contactAreaMm2,
  type InkStrokeHeader,
  type PenPointerEvent,
} from "../index";
import { NibFilter } from "../application/one-euro-filter";
import {
  InkSamplePool,
  InkSampleWriter,
  type InkWorkerMessage,
} from "../application/capture-protocol";

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

/* -------------------------------------------------------------------------
 * The session: no render during a stroke
 * ------------------------------------------------------------------------- */

interface SessionHarness {
  session: PenCaptureSession;
  messages: InkWorkerMessage[];
  trail: number;
  committed: InkStrokeHeader[];
  cancelled: number[];
}

function sessionHarness(
  options: {
    delegating?: boolean;
    project?: (x: number, y: number) => { x: number; y: number } | null;
  } = {},
): SessionHarness {
  const messages: InkWorkerMessage[] = [];
  const committed: InkStrokeHeader[] = [];
  const cancelled: number[] = [];
  const writer = new InkSampleWriter({
    pool: new InkSamplePool({ capacity: 4 }),
    mode: "clone",
    post: (message) => messages.push(message),
  });
  const harness: SessionHarness = {
    session: null as unknown as PenCaptureSession,
    messages,
    trail: 0,
    committed,
    cancelled,
  };
  const gate = new InkPenGate();
  harness.session = new PenCaptureSession({
    gate,
    filter: new NibFilter(),
    writer,
    project: options.project ?? ((x, y) => ({ x: x * 10, y: y * 10 })),
    onLive: () => {
      harness.trail += 1;
    },
    onStrokeEnd: (header) => committed.push(header),
    predict: () => !(options.delegating ?? false),
    onCancelled: (pointerId) => cancelled.push(pointerId),
  });
  harness.session.setTool({
    width: 6,
    tool: "pen",
    colour: "text",
    pageIndex: 0,
  });
  return harness;
}

test("a 240 Hz stroke through the session touches the screen once, at the end", () => {
  const harness = sessionHarness();
  const down = pointer({ pointerType: "pen", pointerId: 7, t: 0 });
  harness.session.pointerDown(down);
  assert.equal(harness.session.active, true);

  // 120 samples over half a second: a real 240 Hz pen, one dispatch per 4 ms.
  for (let i = 1; i <= 120; i += 1) {
    const at = i * 4;
    harness.session.pointerRawUpdate(
      pointer({
        pointerType: "pen",
        pointerId: 7,
        clientX: 100 + i,
        clientY: 100 + i,
        t: at,
      }),
    );
    harness.session.flush();
  }
  assert.equal(
    harness.committed.length,
    0,
    "nothing has asked the screen to render yet",
  );
  assert.ok(harness.trail > 100, "the trail followed every sample, in a ref");

  const up = pointer({
    pointerType: "pen",
    pointerId: 7,
    clientX: 220,
    clientY: 220,
    t: 484,
  });
  harness.session.pointerUp(up);
  assert.equal(harness.session.active, false);
  assert.equal(
    harness.committed.length,
    0,
    "and still nothing until the worker answers",
  );
  harness.session.committed(
    { strokeId: 1, pageIndex: 0, width: 6, tool: "pen", colour: "text" },
    new Float32Array([0, 0, 10, 10]),
    new Uint8Array([128, 128]),
  );
  assert.equal(harness.committed.length, 1, "one acknowledgement, one render");
});

test("coalesced events are consumed with the dispatched one, not instead of it", () => {
  const harness = sessionHarness();
  harness.session.pointerDown(
    pointer({ pointerType: "pen", pointerId: 3, t: 0 }),
  );
  const dispatched = pointer({
    pointerType: "pen",
    pointerId: 3,
    clientX: 300,
    clientY: 300,
    t: 20,
    getCoalescedEvents: () => [
      pointer({
        pointerType: "pen",
        pointerId: 3,
        clientX: 200,
        clientY: 200,
        t: 8,
      }),
      pointer({
        pointerType: "pen",
        pointerId: 3,
        clientX: 250,
        clientY: 250,
        t: 14,
      }),
    ],
  });
  harness.session.pointerRawUpdate(dispatched);
  harness.session.pointerUp(
    pointer({
      pointerType: "pen",
      pointerId: 3,
      clientX: 300,
      clientY: 300,
      t: 24,
    }),
  );
  // Down, two coalesced, the dispatched one, and the up sample: five, with the
  // newest among them. Consuming only the coalesced list would give four.
  assert.equal(harness.session.sampleCount, 0, "the stroke is over");
  const counts = harness.messages
    .filter(
      (message) =>
        message.type === "stroke-begin" ||
        message.type === "samples" ||
        message.type === "stroke-end",
    )
    .reduce(
      (sum, message) => sum + ("sample" in message ? message.sample.count : 0),
      0,
    );
  assert.equal(counts, 5, "the newest sample is not dropped every frame");
});

test("predicted samples ride the live tail and are never part of the stroke", () => {
  const harness = sessionHarness({ delegating: false });
  harness.session.pointerDown(
    pointer({ pointerType: "pen", pointerId: 4, t: 0 }),
  );
  harness.session.pointerRawUpdate(
    pointer({
      pointerType: "pen",
      pointerId: 4,
      clientX: 120,
      clientY: 120,
      t: 8,
      getPredictedEvents: () => [
        pointer({
          pointerType: "pen",
          pointerId: 4,
          clientX: 160,
          clientY: 160,
          t: 16,
        }),
      ],
    }),
  );
  const predicted = harness.messages.filter(
    (message) => message.type === "samples" && message.predicted,
  );
  assert.equal(predicted.length, 1, "the tail was posted as a prediction");
  assert.deepEqual(
    harness.session.takeStroke().pressures,
    [0.5, 0.5],
    "only the two real samples are part of the stroke",
  );
});

test("while delegating, prediction is not used at all", () => {
  const harness = sessionHarness({ delegating: true });
  harness.session.pointerDown(
    pointer({ pointerType: "pen", pointerId: 5, t: 0 }),
  );
  harness.session.pointerRawUpdate(
    pointer({
      pointerType: "pen",
      pointerId: 5,
      clientX: 120,
      clientY: 120,
      t: 8,
      getPredictedEvents: () => [
        pointer({
          pointerType: "pen",
          pointerId: 5,
          clientX: 160,
          clientY: 160,
          t: 16,
        }),
      ],
    }),
  );
  const predicted = harness.messages.filter(
    (message) => message.type === "samples" && message.predicted,
  );
  assert.equal(
    predicted.length,
    0,
    "the OS is drawing ahead; predicting too would fork the stroke",
  );
});

test("a late palm decision discards the stroke in progress", () => {
  const harness = sessionHarness();
  harness.session.pointerDown(
    pointer({ pointerType: "touch", pointerId: 9, t: 0 }),
  );
  // A deferred touch owns nothing yet, so nothing has been sent.
  assert.equal(harness.messages.length, 0, "a deferred touch sends no samples");
  harness.session.confirmTouch({ x: 100, y: 100 }, null);
  assert.equal(harness.session.active, false, "and a palm never starts one");
});

test("a second contact cancels a young touch stroke", () => {
  const harness = sessionHarness();
  harness.session.pointerDown(
    pointer({ pointerType: "touch", pointerId: 11, t: 0 }),
  );
  harness.session.confirmTouch(
    { x: 200, y: 200 },
    pointer({ pointerType: "touch", pointerId: 11, t: 4 }),
  );
  assert.equal(
    harness.session.active,
    true,
    "the touch earned its stroke by moving",
  );

  harness.session.pointerDown(
    pointer({ pointerType: "touch", pointerId: 12, t: 100 }),
  );
  assert.deepEqual(
    harness.cancelled,
    [11],
    "the screen was told to discard it",
  );
  assert.equal(harness.session.active, false);
});

test("a stroke that never leaves the page is never sent anywhere", () => {
  const harness = sessionHarness({ project: () => null });
  harness.session.pointerDown(
    pointer({ pointerType: "pen", pointerId: 13, t: 0 }),
  );
  harness.session.pointerRawUpdate(
    pointer({ pointerType: "pen", pointerId: 13, t: 8 }),
  );
  harness.session.flush();
  assert.equal(
    harness.messages.length,
    0,
    "an off-page sample projects to nothing",
  );
  harness.session.pointerUp(
    pointer({ pointerType: "pen", pointerId: 13, t: 16 }),
  );
});
