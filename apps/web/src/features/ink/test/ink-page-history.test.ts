/**
 * One undo order for a page's strokes and its figures (design D18, DA-113).
 * Strokes are undone by the worker; figures by the host. This log says whose
 * turn each Ctrl+Z is.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { FigureGeometry } from "@weaveforge/core";

import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";
import type { PageHistory } from "@weaveforge/wasm";

before(loadTestCore);

const fig = (x: number): FigureGeometry => ({ path: "a.png", x, y: 0, w: 10, h: 10 });

test("strokes the worker reports become steps, in order with figure steps", () => {
  const core = readyCore();
  let h: PageHistory = core.syncStrokeSteps(core.emptyPageHistory(), 1);
  h = core.pushFigureStep(h, [fig(0)], [fig(5)], null);
  h = core.syncStrokeSteps(h, 2);
  assert.deepEqual(h.undo.map((s) => (s === "stroke" ? s : "figure")), ["stroke", "figure", "stroke"]);
});

test("undo walks back through strokes and figures alike, and redo walks forward", () => {
  const core = readyCore();
  let h = core.pushFigureStep(core.syncStrokeSteps(core.emptyPageHistory(), 1), [], [fig(0)], null);
  const first = core.takePageStep(h, "undo")!;
  assert.deepEqual(first.step, { before: [], after: [fig(0)], key: null });
  h = first.history;
  const second = core.takePageStep(h, "undo")!;
  assert.equal(second.step, "stroke");
  h = second.history;
  // The worker answers the stroke undo with its new depth: nothing new to record.
  h = core.syncStrokeSteps(h, 0);
  assert.equal(core.takePageStep(h, "undo"), null);
  const redo = core.takePageStep(h, "redo")!;
  assert.equal(redo.step, "stroke");
  assert.deepEqual(core.syncStrokeSteps(redo.history, 1), redo.history, "the redo's own report is not a new stroke");
});

test("a new edit of either kind drops what was redoable", () => {
  const core = readyCore();
  const undone = core.takePageStep(core.pushFigureStep(core.emptyPageHistory(), [], [fig(0)], null), "undo")!.history;
  assert.equal(undone.redo.length, 1);
  assert.equal(core.syncStrokeSteps(undone, 1).redo.length, 0);
  assert.equal(core.pushFigureStep(undone, [], [fig(1)], null).redo.length, 0);
});

test("one drag is one step: changes in the same press merge, keeping the first before", () => {
  const core = readyCore();
  let h = core.pushFigureStep(core.emptyPageHistory(), [fig(0)], [fig(1)], 7);
  h = core.pushFigureStep(h, [fig(1)], [fig(2)], 7);
  h = core.pushFigureStep(h, [fig(2)], [fig(3)], 7);
  assert.equal(h.undo.length, 1);
  assert.deepEqual(h.undo[0], { before: [fig(0)], after: [fig(3)], key: 7 });
  // A new press, or a key press (no press), is a new step.
  assert.equal(core.pushFigureStep(h, [fig(3)], [fig(4)], 8).undo.length, 2);
  assert.equal(core.pushFigureStep(h, [fig(3)], [fig(4)], null).undo.length, 2);
});

test("a stroke between two changes of one press keeps them apart", () => {
  const core = readyCore();
  let h = core.pushFigureStep(core.emptyPageHistory(), [fig(0)], [fig(1)], 7);
  h = core.syncStrokeSteps(h, 1);
  h = core.pushFigureStep(h, [fig(1)], [fig(2)], 7);
  assert.equal(h.undo.length, 3);
});

test("a change that changes nothing is no step", () => {
  const core = readyCore();
  const empty = core.emptyPageHistory();
  assert.deepEqual(core.pushFigureStep(empty, [fig(0)], [fig(0)], null), empty);
});

test("a worker that forgot strokes (a page load) drops them from the log", () => {
  const core = readyCore();
  let h = core.syncStrokeSteps(core.emptyPageHistory(), 2);
  h = core.pushFigureStep(h, [], [fig(0)], null);
  h = core.syncStrokeSteps(h, 0);
  assert.deepEqual(h.undo, [{ before: [], after: [fig(0)], key: null }]);
});
