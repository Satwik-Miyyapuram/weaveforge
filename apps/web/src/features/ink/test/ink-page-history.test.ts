/**
 * One undo order for a page's strokes and its figures (design D18, DA-113).
 * Strokes are undone by the worker; figures by the host. This log says whose
 * turn each Ctrl+Z is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureGeometry } from "@weaveforge/core";

import {
  EMPTY_PAGE_HISTORY,
  pushFigureStep,
  syncStrokeSteps,
  takePageStep,
  type PageHistory,
} from "../application/ink-page-history";

const fig = (x: number): FigureGeometry => ({ path: "a.png", x, y: 0, w: 10, h: 10 });

test("strokes the worker reports become steps, in order with figure steps", () => {
  let h: PageHistory = syncStrokeSteps(EMPTY_PAGE_HISTORY, 1);
  h = pushFigureStep(h, [fig(0)], [fig(5)], null);
  h = syncStrokeSteps(h, 2);
  assert.deepEqual(h.undo.map((s) => (s === "stroke" ? s : "figure")), ["stroke", "figure", "stroke"]);
});

test("undo walks back through strokes and figures alike, and redo walks forward", () => {
  let h = pushFigureStep(syncStrokeSteps(EMPTY_PAGE_HISTORY, 1), [], [fig(0)], null);
  const first = takePageStep(h, "undo")!;
  assert.deepEqual(first.step, { before: [], after: [fig(0)], key: null });
  h = first.history;
  const second = takePageStep(h, "undo")!;
  assert.equal(second.step, "stroke");
  h = second.history;
  // The worker answers the stroke undo with its new depth: nothing new to record.
  h = syncStrokeSteps(h, 0);
  assert.equal(takePageStep(h, "undo"), null);
  const redo = takePageStep(h, "redo")!;
  assert.equal(redo.step, "stroke");
  assert.equal(syncStrokeSteps(redo.history, 1), redo.history, "the redo's own report is not a new stroke");
});

test("a new edit of either kind drops what was redoable", () => {
  const undone = takePageStep(pushFigureStep(EMPTY_PAGE_HISTORY, [], [fig(0)], null), "undo")!.history;
  assert.equal(undone.redo.length, 1);
  assert.equal(syncStrokeSteps(undone, 1).redo.length, 0);
  assert.equal(pushFigureStep(undone, [], [fig(1)], null).redo.length, 0);
});

test("one drag is one step: changes in the same press merge, keeping the first before", () => {
  let h = pushFigureStep(EMPTY_PAGE_HISTORY, [fig(0)], [fig(1)], 7);
  h = pushFigureStep(h, [fig(1)], [fig(2)], 7);
  h = pushFigureStep(h, [fig(2)], [fig(3)], 7);
  assert.equal(h.undo.length, 1);
  assert.deepEqual(h.undo[0], { before: [fig(0)], after: [fig(3)], key: 7 });
  // A new press, or a key press (no press), is a new step.
  assert.equal(pushFigureStep(h, [fig(3)], [fig(4)], 8).undo.length, 2);
  assert.equal(pushFigureStep(h, [fig(3)], [fig(4)], null).undo.length, 2);
});

test("a stroke between two changes of one press keeps them apart", () => {
  let h = pushFigureStep(EMPTY_PAGE_HISTORY, [fig(0)], [fig(1)], 7);
  h = syncStrokeSteps(h, 1);
  h = pushFigureStep(h, [fig(1)], [fig(2)], 7);
  assert.equal(h.undo.length, 3);
});

test("a change that changes nothing is no step", () => {
  assert.equal(pushFigureStep(EMPTY_PAGE_HISTORY, [fig(0)], [fig(0)], null), EMPTY_PAGE_HISTORY);
});

test("a worker that forgot strokes (a page load) drops them from the log", () => {
  let h = syncStrokeSteps(EMPTY_PAGE_HISTORY, 2);
  h = pushFigureStep(h, [], [fig(0)], null);
  h = syncStrokeSteps(h, 0);
  assert.deepEqual(h.undo, [{ before: [], after: [fig(0)], key: null }]);
});
