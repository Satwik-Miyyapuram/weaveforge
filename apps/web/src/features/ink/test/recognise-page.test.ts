/**
 * A page through recognition with a scripted engine: lines come back in reading
 * order, the post-match runs, progress is per line, and a correction survives
 * the next run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  blankInkPage,
  makeInkStroke,
  type InkPage,
  type InkRecogniser,
  type RecognisedLine,
} from "@weaveforge/core";

import { acceptLine, recognisePage } from "../application/recognise-page";

/** A short stroke at (x, y) starting at time t. */
const at = (x: number, y: number, t: number) =>
  makeInkStroke({ points: [x, y, x + 40, y + 2, x + 80, y + 30], pressures: [128, 128, 128], t0: t });

function page(): InkPage {
  const model = blankInkPage("blank");
  model.strokes = [
    at(100, 100, 0),
    at(200, 102, 300),
    // A second line well below, a second later.
    at(100, 400, 1500),
    at(200, 405, 1800),
  ];
  return model;
}

function engine(answers: string[], calls: number[][] = []): InkRecogniser {
  let call = 0;
  return {
    id: "test@1",
    offline: true,
    online: true,
    available: async () => true,
    recognise: async (lines): Promise<RecognisedLine[]> => {
      calls.push(lines.map((line) => line.strokes.length));
      const text = answers[call] ?? "";
      call += 1;
      return [{ text, conf: text ? 0.9 : 0.2 }];
    },
  };
}

test("lines are recognised one at a time, in reading order, with progress", async () => {
  const calls: number[][] = [];
  const progress: [number, number][] = [];
  const result = await recognisePage({
    page: page(),
    recogniser: engine(["see [[Graph-prior modlue]]", "next line"], calls),
    hints: { vocabulary: ["Graph-prior module"], lang: "en" },
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.deepEqual(calls, [[2], [2]]);
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);
  assert.equal(result.text, "see [[Graph-prior module]]\nnext line");
  assert.equal(result.engine, "test@1");
  assert.equal(result.page.lines.length, 2);
  assert.equal(result.page.strokes[0]!.lineIndex, 0);
  assert.equal(result.page.strokes[2]!.lineIndex, 1);
  assert.ok(result.confidence > 0.8);
  assert.equal(result.unsure, 0);
});

test("an engine that throws leaves an empty, unsure line rather than failing the page", async () => {
  const broken: InkRecogniser = {
    ...engine([]),
    recognise: async () => {
      throw new Error("no helper");
    },
  };
  const result = await recognisePage({
    page: page(),
    recogniser: broken,
    hints: { vocabulary: [], lang: "en" },
  });
  assert.equal(result.text, "");
  assert.equal(result.lines.length, 2);
  assert.equal(result.confidence, 0);
});

test("a manual correction survives re-recognition", async () => {
  const first = await recognisePage({
    page: page(),
    recogniser: engine(["frist", "second"]),
    hints: { vocabulary: [], lang: "en" },
  });
  const corrected = acceptLine(first, 0, "first");
  assert.equal(corrected.text, "first\nsecond");
  assert.equal(corrected.page.lines[0]!.confidence, 1);
  assert.equal(corrected.lines[0]!.conf, 1);

  const calls: number[][] = [];
  const again = await recognisePage({
    page: corrected.page,
    recogniser: engine(["second again"], calls),
    hints: { vocabulary: [], lang: "en" },
  });
  assert.deepEqual(calls, [[2]], "only the uncorrected line went to the engine");
  assert.equal(again.text, "first\nsecond again");
  assert.equal(again.lines[0]!.conf, 1);
});
