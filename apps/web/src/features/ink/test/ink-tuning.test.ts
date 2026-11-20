// The ink tuning knobs (`ink.tuning` in the workspace settings file): one typed
// object, defaults in code, every value clamped, applied on the next read.
import assert from "node:assert/strict";
import test from "node:test";

import { workspaceSettings } from "@/features/settings/application/workspace-settings";

import {
  DEFAULT_INK_TUNING,
  INK_TUNING_KEY,
  parseInkTuning,
  readInkTuning,
  resetInkTuning,
  setInkTuning,
  subscribeInkTuning,
} from "../application/ink-tuning";

test("nothing stored gives the defaults", () => {
  assert.deepEqual(parseInkTuning(undefined), DEFAULT_INK_TUNING);
  assert.deepEqual(parseInkTuning("junk"), DEFAULT_INK_TUNING);
  assert.deepEqual(parseInkTuning([1, 2]), DEFAULT_INK_TUNING);
});

test("the shipped defaults keep today's behaviour, with the wet layer raised", () => {
  assert.equal(DEFAULT_INK_TUNING.wetDesynchronized, true);
  assert.equal(DEFAULT_INK_TUNING.wetLayerAboveSvg, true);
  assert.equal(DEFAULT_INK_TUNING.forceBackend, "auto");
  assert.equal(DEFAULT_INK_TUNING.presenterTimeoutMs, 500);
  assert.equal(DEFAULT_INK_TUNING.delegateNavigatorInk, true);
  assert.equal(DEFAULT_INK_TUNING.prediction, true);
  assert.equal(DEFAULT_INK_TUNING.holdToShapeMs, 0);
});

test("numbers are clamped to their range and non-numbers fall back", () => {
  const t = parseInkTuning({
    presenterTimeoutMs: 99_999,
    thinning: -3,
    streamline: 7,
    pressureGamma: "fast",
    predictionMs: Number.NaN,
    wetDpr: 0.1,
  });
  assert.equal(t.presenterTimeoutMs, 2000);
  assert.equal(t.thinning, 0);
  assert.equal(t.streamline, 1);
  assert.equal(t.pressureGamma, DEFAULT_INK_TUNING.pressureGamma);
  assert.equal(t.predictionMs, DEFAULT_INK_TUNING.predictionMs);
  assert.equal(t.wetDpr, 0.5, "below the floor clamps up; 0 alone means the device's");
  assert.equal(parseInkTuning({ wetDpr: 0 }).wetDpr, 0);
});

test("flags and choices accept only their own values", () => {
  const t = parseInkTuning({ wetDesynchronized: "no", forceBackend: "vulkan", renderer: "freehand" });
  assert.equal(t.wetDesynchronized, true);
  assert.equal(t.forceBackend, "auto");
  assert.equal(t.renderer, "freehand");
  assert.equal(parseInkTuning({ forceBackend: "2d", wetLayerAboveSvg: false }).forceBackend, "2d");
  assert.equal(parseInkTuning({ wetLayerAboveSvg: false }).wetLayerAboveSvg, false);
});

test("a change is read back at once and tells subscribers (hot apply)", () => {
  let told = 0;
  const off = subscribeInkTuning(() => {
    told += 1;
  });
  setInkTuning({ presenterTimeoutMs: 120, wetLayerAboveSvg: false });
  assert.equal(readInkTuning().presenterTimeoutMs, 120);
  assert.equal(readInkTuning().wetLayerAboveSvg, false);
  assert.deepEqual(workspaceSettings.get(INK_TUNING_KEY), { ...DEFAULT_INK_TUNING, presenterTimeoutMs: 120, wetLayerAboveSvg: false });
  assert.ok(told >= 1);
  setInkTuning({ thinning: 5 });
  assert.equal(readInkTuning().thinning, 1, "a set is clamped too");
  resetInkTuning();
  assert.deepEqual(readInkTuning(), DEFAULT_INK_TUNING);
  off();
});

test("an edit to the settings file by hand is picked up", () => {
  workspaceSettings.set(INK_TUNING_KEY, { presenterTimeoutMs: 42 });
  assert.equal(readInkTuning().presenterTimeoutMs, 42);
  resetInkTuning();
});
