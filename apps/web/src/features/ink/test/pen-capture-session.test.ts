/**
 * Pen capture session: no render during a stroke.
 *
 * The test the plan calls "no-render-during-stroke": {@link PenCaptureSession}
 * is a plain object, so a 240 Hz stroke cannot re-render anything, and the only
 * callback a screen may re-render for fires once per stroke. Split from
 * use-pen-capture.test.ts, which keeps the palm rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  InkPenGate,
  PenCaptureSession,
  type InkStrokeHeader,
  type PenPointerEvent,
} from "../index";
import { NibFilter } from "../application/one-euro-filter";
import {
  InkSamplePool,
  InkSampleWriter,
  type InkWorkerMessage,
  readInkSamples,
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

/* -------------------------------------------------------------------------
 * The session: no render during a stroke
 * ------------------------------------------------------------------------- */

interface SessionHarness {
  session: PenCaptureSession;
  messages: InkWorkerMessage[];
  /** The real samples posted so far. */
  stroke: { points: number[]; pressures: number[] };
  trail: number;
  committed: InkStrokeHeader[];
  cancelled: number[];
  gate: InkPenGate;
}

/**
 * Copy the real samples of a posted message into `into`: what the stroke is
 * made of. Copied at post time, because a cloning writer refills its buffer.
 */
function keepRealSamples(message: InkWorkerMessage, into: { points: number[]; pressures: number[] }): void {
  if (message.type !== "stroke-begin" && message.type !== "samples" && message.type !== "stroke-end") return;
  if (message.type === "samples" && message.predicted) return;
  const read = readInkSamples(message.sample);
  for (let i = 0; i < read.count; i += 1) {
    into.points.push(read.x(i), read.y(i));
    into.pressures.push(read.pressure(i));
  }
}

function sessionHarness(
  options: {
    delegating?: boolean;
    project?: (x: number, y: number) => { x: number; y: number } | null;
  } = {},
): SessionHarness {
  const messages: InkWorkerMessage[] = [];
  const stroke = { points: [] as number[], pressures: [] as number[] };
  const committed: InkStrokeHeader[] = [];
  const cancelled: number[] = [];
  const writer = new InkSampleWriter({
    pool: new InkSamplePool({ capacity: 4 }),
    mode: "clone",
    post: (message) => {
      keepRealSamples(message, stroke);
      messages.push(message);
    },
  });
  const gate = new InkPenGate();
  const harness: SessionHarness = {
    session: null as unknown as PenCaptureSession,
    messages,
    stroke,
    trail: 0,
    committed,
    cancelled,
    gate,
  };
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
  // Down, two coalesced and the dispatched one: four, with the newest among
  // them. Consuming only the coalesced list would give three.
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
  assert.equal(counts, 4, "the newest sample is not dropped every frame");
});

test("the dispatched event is not counted twice when its coalesced list ends with it", () => {
  // Chromium's `getCoalescedEvents()` on a `pointermove` ends with the dispatched
  // event's own sample, and a `pointerup` repeats the last move. Each repeat
  // would be a zero-timestep sample: unfiltered, and a dip in the width.
  const harness = sessionHarness();
  harness.session.pointerDown(
    pointer({ pointerType: "pen", pointerId: 3, t: 0 }),
  );
  const same = { pointerType: "pen" as const, pointerId: 3, clientX: 300, clientY: 300, t: 20 };
  harness.session.pointerRawUpdate(
    pointer({
      ...same,
      getCoalescedEvents: () => [
        pointer({ pointerType: "pen", pointerId: 3, clientX: 200, clientY: 200, t: 8 }),
        pointer(same),
      ],
    }),
  );
  harness.session.pointerUp(pointer(same));
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
  // Down, the coalesced one, the dispatched one: three, not five.
  assert.equal(counts, 3);
});

test("lifting the pen adds no sample, so the stroke ends where it was drawn", () => {
  // A pointerup repeats the last move's position with a later time and, once
  // the nib is off the glass, zero pressure. Taken as a sample, the filter
  // would catch up to it and the taper would drop to nothing: the end of the
  // stroke would move as the pen lifts.
  const harness = sessionHarness();
  harness.session.pointerDown(pointer({ pointerType: "pen", pointerId: 5, t: 0 }));
  for (let i = 1; i <= 10; i += 1) {
    harness.session.pointerRawUpdate(
      pointer({ pointerType: "pen", pointerId: 5, clientX: 100 + i * 3, clientY: 100, pressure: 0.6, t: i * 4 }),
    );
    harness.session.flush();
  }
  const drawn = { points: [...harness.stroke.points], pressures: [...harness.stroke.pressures] };
  harness.session.pointerUp(
    pointer({ pointerType: "pen", pointerId: 5, clientX: 130, clientY: 100, pressure: 0, t: 500 }),
  );
  assert.equal(harness.messages.at(-1)?.type, "stroke-end");
  assert.deepEqual(harness.stroke, drawn, "the stroke the worker commits is the one already drawn");
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
    harness.stroke.pressures,
    [0.5, 0.5],
    "only the two real samples are part of the stroke",
  );
});

test("a real sample pending when a prediction arrives is posted on its own, not as part of the predicted tail", () => {
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
  const samples = harness.messages.filter(
    (message) => message.type === "samples",
  );
  // The worker throws a predicted tail away when the next samples land, so a
  // real sample that travelled under the predicted flag would be lost with it.
  assert.deepEqual(
    samples.map((message) => [Boolean(message.predicted), message.sample.count]),
    [
      [false, 1],
      [true, 1],
    ],
    "the real sample first, unflagged; then the predicted tail alone",
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

test("a pointer that never began a stroke still releases the gate on its way up", () => {
  const harness = sessionHarness();
  // Before any pen, a touch is deferred: the gate holds it, the session does
  // not start a stroke. Lifting before the timer answers must free the gate.
  const claim = harness.session.pointerDown(
    pointer({ pointerType: "touch", pointerId: 21, t: 0 }),
  );
  assert.equal(claim.decision, "defer");
  assert.equal(harness.session.active, false);
  harness.session.pointerUp(
    pointer({ pointerType: "touch", pointerId: 21, t: 16 }),
  );
  const next = harness.session.pointerDown(
    pointer({ pointerType: "touch", pointerId: 22, clientX: 400, t: 40 }),
  );
  assert.equal(next.decision, "defer", "the next touch is not locked out");
});

test("a coalesced event that carries timeStamp rather than t is not a NaN sample", () => {
  const harness = sessionHarness();
  harness.session.pointerDown(
    pointer({ pointerType: "pen", pointerId: 4, t: 0 }),
  );
  const native = {
    ...pointer({
      pointerType: "pen",
      pointerId: 4,
      clientX: 200,
      clientY: 200,
      t: 0,
    }),
  } as unknown as { t: number; timeStamp: number };
  native.t = Number.NaN;
  native.timeStamp = 8;
  harness.session.pointerRawUpdate(
    pointer({
      pointerType: "pen",
      pointerId: 4,
      clientX: 300,
      clientY: 300,
      t: 20,
      getCoalescedEvents: () => [
        native as unknown as ReturnType<typeof pointer>,
      ],
    }),
  );
  harness.session.pointerUp(
    pointer({
      pointerType: "pen",
      pointerId: 4,
      clientX: 300,
      clientY: 300,
      t: 24,
    }),
  );
  for (const message of harness.messages) {
    if (!("sample" in message)) continue;
    const view = new Float32Array(message.sample.buffer);
    for (const value of view.subarray(0, message.sample.count * 4))
      assert.ok(
        Number.isFinite(value),
        "every field of every sample is finite",
      );
  }
});

test("predicted samples do not bend the real stroke through the filter", () => {
  // A smooth arc at 240 Hz, one dispatch per 16 ms frame with 3 coalesced
  // samples, each frame carrying a prediction that overshoots off the arc.
  const at = (i: number) => ({
    clientX: 100 + 80 * Math.cos(i / 40),
    clientY: 100 + 80 * Math.sin(i / 40),
    t: i * 4,
  });
  const draw = (withPrediction: boolean) => {
    const harness = sessionHarness({ delegating: false });
    harness.session.pointerDown(
      pointer({ pointerType: "pen", pointerId: 6, ...at(0) }),
    );
    for (let frame = 1; frame <= 30; frame += 1) {
      const last = frame * 4;
      harness.session.pointerRawUpdate(
        pointer({
          pointerType: "pen",
          pointerId: 6,
          ...at(last),
          getCoalescedEvents: () =>
            [last - 3, last - 2, last - 1].map((i) =>
              pointer({ pointerType: "pen", pointerId: 6, ...at(i) }),
            ),
          getPredictedEvents: withPrediction
            ? () =>
                [1, 2].map((k) =>
                  pointer({
                    pointerType: "pen",
                    pointerId: 6,
                    clientX: at(last + k * 2).clientX + 6 * k,
                    clientY: at(last + k * 2).clientY - 6 * k,
                    t: (last + k * 2) * 4,
                  }),
                )
            : undefined,
        }),
      );
      harness.session.flush();
    }
    return harness.stroke.points;
  };
  const clean = draw(false);
  const predicted = draw(true);
  assert.equal(predicted.length, clean.length);
  const worst = Math.max(
    ...clean.map((value, index) => Math.abs(value - predicted[index]!)),
  );
  assert.ok(worst < 1e-9, `prediction moved a real point by ${worst}`);
});
