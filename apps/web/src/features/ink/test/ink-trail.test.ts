/**
 * The Delegated Ink Trail's contract (§6.2.6, §7 step 9): an absent API is a
 * `null` presenter and never a throw; the diameter follows the filtered width,
 * which follows pressure; a refusing presenter is dropped, not fatal; and the
 * session hands the presenter only the dispatched event, never a coalesced one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { INK_A4_WIDTH, nibWidth } from "@weaveforge/core";

import {
  requestInkPresenter,
  trailColour,
  trailDiameterPx,
  trailStyle,
  updateTrail,
  type InkPresenterLike,
} from "../application/ink-trail";
import {
  INK_PEN_ONLY_STORAGE_KEY,
  PenCaptureSession,
  readStoredPenOnly,
  writeStoredPenOnly,
  type PenPointerEvent,
} from "../application/use-pen-capture";
import { InkPenGate } from "../application/pen-gate";
import { NibFilter } from "../application/one-euro-filter";
import { InkSamplePool, InkSampleWriter } from "../application/capture-protocol";

const area = {} as Element;

test("no navigator.ink means no presenter, and no throw", async () => {
  assert.equal(await requestInkPresenter(area, null), null);
  assert.equal(await requestInkPresenter(area, {}), null);
  assert.equal(
    await requestInkPresenter(area, {
      ink: {
        requestPresenter: async () => {
          throw new Error("not allowed");
        },
      },
    }),
    null,
  );
  // A presenter without the method this code calls is as good as none.
  assert.equal(
    await requestInkPresenter(area, {
      ink: { requestPresenter: async () => ({}) as InkPresenterLike },
    }),
    null,
  );
});

test("a granted presenter is returned and asked for over the canvas", async () => {
  let asked: Element | undefined;
  const presenter: InkPresenterLike = { updateInkTrailStartPoint() {} };
  const got = await requestInkPresenter(area, {
    ink: {
      requestPresenter: async (param) => {
        asked = param?.presentationArea;
        return presenter;
      },
    },
  });
  assert.equal(got, presenter);
  assert.equal(asked, area);
});

test("the diameter is the nib's width on the page, and follows pressure", () => {
  // A 2100-unit page drawn 420 px wide: 0.1 mm is 0.2 px.
  assert.equal(trailDiameterPx(INK_A4_WIDTH, 420), 420);
  assert.equal(trailDiameterPx(10, 420), 2);
  assert.equal(trailDiameterPx(0, 420), 1, "never thinner than a pixel");
  assert.equal(trailDiameterPx(10, 0), 1, "a page with no width still draws");

  const light = trailStyle({ colour: "text", tool: "pen", width: nibWidth(6, 0.2), pageWidthPx: 800 });
  const firm = trailStyle({ colour: "text", tool: "pen", width: nibWidth(6, 0.9), pageWidthPx: 800 });
  assert.ok(firm.diameter > light.diameter, "pressing harder widens the trail");
  assert.equal(light.color, trailColour("text"));
  assert.match(trailStyle({ colour: "warn", tool: "highlighter", width: 60, pageWidthPx: 800 }).color, /^rgba\(/);
});

test("a presenter that refuses an event is reported, not thrown", () => {
  const refusing: InkPresenterLike = {
    updateInkTrailStartPoint() {
      throw new TypeError("untrusted event");
    },
  };
  assert.equal(updateTrail(refusing, {} as PointerEvent, { color: "red", diameter: 2 }), false);
  const calls: number[] = [];
  const willing: InkPresenterLike = {
    updateInkTrailStartPoint(_event, style) {
      calls.push(style.diameter);
    },
  };
  assert.equal(updateTrail(willing, {} as PointerEvent, { color: "red", diameter: 3 }), true);
  assert.deepEqual(calls, [3]);
});

test("the session marks the dispatched sample and not the coalesced ones", () => {
  const seen: (PenPointerEvent | undefined)[] = [];
  const session = new PenCaptureSession({
    gate: new InkPenGate(),
    filter: new NibFilter(),
    writer: new InkSampleWriter({ pool: new InkSamplePool({ capacity: 4 }), mode: "clone", post: () => {} }),
    project: (x, y) => ({ x, y }),
    onLive: (_sample, _width, event) => seen.push(event),
    predict: () => false,
  });
  session.setTool({ width: 6, tool: "pen", colour: "text", pageIndex: 0 });
  const base = { pointerType: "pen", pointerId: 1, pressure: 0.5, width: 1, height: 1 };
  const down: PenPointerEvent = { ...base, clientX: 10, clientY: 10, t: 0 };
  session.pointerDown(down);
  const coalesced: PenPointerEvent[] = [
    { ...base, clientX: 12, clientY: 10, t: 4 },
    { ...base, clientX: 14, clientY: 10, t: 8 },
  ];
  const move: PenPointerEvent = {
    ...base,
    clientX: 16,
    clientY: 10,
    t: 12,
    getCoalescedEvents: () => coalesced,
  };
  session.pointerRawUpdate(move);
  assert.deepEqual(
    seen.map((event) => event?.t),
    [0, undefined, undefined, 12],
    "the trail moves for the down and the dispatched move only",
  );
});

test("the wrist guard's choice round-trips through storage and survives a broken one", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  assert.equal(readStoredPenOnly(storage), null);
  writeStoredPenOnly(storage, true);
  assert.equal(store.get(INK_PEN_ONLY_STORAGE_KEY), "1");
  assert.equal(readStoredPenOnly(storage), true);
  writeStoredPenOnly(storage, false);
  assert.equal(readStoredPenOnly(storage), false);

  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(readStoredPenOnly(broken), null);
  assert.doesNotThrow(() => writeStoredPenOnly(broken, true));
  assert.equal(readStoredPenOnly(null), null);
});
