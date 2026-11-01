import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust and TS must agree exactly on line segmentation and the recognition
// helpers, so the TS copies can be deleted. Pages are seeded so a failure
// reproduces from the seed.

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOOLS: ts.InkTool[] = ["pen", "pen", "pen", "highlighter"];

/** A page of strokes on a few rows, with pauses, repeats, ties and odd values. */
function page(rand: () => number): ts.InkStroke[] {
  const strokes: ts.InkStroke[] = [];
  const count = Math.floor(rand() * 30);
  let t = 0;
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(rand() * 4) * 120 + rand() * 30;
    const points: number[] = [];
    const n = Math.floor(rand() * 6);
    for (let k = 0; k < n; k += 1) {
      const y = rand() < 0.05 ? NaN : row + rand() * 40;
      points.push(rand() * 1000, rand() < 0.03 ? -0 : y);
    }
    t += rand() < 0.2 ? 0 : rand() < 0.15 ? 3000 : rand() * 600;
    const t0 = rand() < 0.08 ? NaN : t;
    strokes.push(ts.makeInkStroke({ points, tool: TOOLS[Math.floor(rand() * TOOLS.length)]!, t0 }));
  }
  return strokes;
}

test("segmentInkLines and applyInkSegmentation match TS on seeded pages", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const strokes = page(rand);
    const options = rand() < 0.3 ? { windowMs: rand() * 4000, bandRatio: rand() * 2 } : {};
    const want = ts.segmentInkLines(strokes, options);
    const got = rs.segmentInkLines(strokes, options);
    assert.deepEqual(got, want, `segment seed ${seed}`);
    got.lines.forEach((line, i) => {
      line.strokes.forEach((stroke, k) => assert.equal(stroke, want.lines[i]!.strokes[k], `identity seed ${seed}`));
    });
    const recognised = want.lines.map((_, i) =>
      i % 3 === 2 ? undefined : { text: `line ${i}`, confidence: rand() },
    );
    assert.deepEqual(
      rs.applyInkSegmentation(strokes, got, recognised),
      ts.applyInkSegmentation(strokes, want, recognised),
      `apply seed ${seed}`,
    );
  }
});

test("applyInkSegmentation defaults and rounding match TS", () => {
  const strokes = [
    ts.makeInkStroke({ points: [0, 10.5, 1, 20.5], t0: 0 }),
    ts.makeInkStroke({ points: [0, -2.5, 1, -1.5], t0: 5000 }),
    ts.makeInkStroke({ points: [0, 1], t0: 1 }),
  ];
  const segmentation = ts.segmentInkLines(strokes);
  assert.deepEqual(rs.applyInkSegmentation(strokes, segmentation), ts.applyInkSegmentation(strokes, segmentation));
  assert.deepEqual(rs.applyInkSegmentation([], ts.segmentInkLines([])), { strokes: [], lines: [] });
});

test("confidence helpers match TS, NaN, infinities and -0 included", () => {
  const values = [0, -0, 0.5, 0.749, 0.75, 1, 1.5, 7, -1, NaN, Infinity, -Infinity, 90, 100];
  for (const conf of values) {
    assert.equal(rs.isUnsureLine({ conf }), ts.isUnsureLine({ text: "x", conf }), `unsure ${conf}`);
    for (const scale of [1, 100, 0, -0, -5, NaN, Infinity]) {
      assert.ok(Object.is(rs.mapInkConfidence(conf, scale), ts.mapInkConfidence(conf, scale)), `map ${conf}/${scale}`);
    }
    assert.ok(Object.is(rs.mapInkConfidence(conf), ts.mapInkConfidence(conf)), `map ${conf}`);
  }
  const lines = values.map((conf) => ({ text: "x", conf }));
  for (let i = 0; i <= lines.length; i += 1) {
    const slice = lines.slice(0, i);
    assert.ok(Object.is(rs.inkPageConfidence(slice), ts.inkPageConfidence(slice)), `page ${i}`);
  }
});

test("inkVocabularyHints matches TS on trim, case and limits", () => {
  const sources = [
    [" Alpha ", "", "﻿beta", "ALPHA", " gamma ", "ΣΟΦΟΣ", "σοφος", "σοφοσ"],
    ["İstanbul", "istanbul", "Straße", "STRASSE", "delta", "  ", "Delta"],
    [],
    ["epsilon"],
  ];
  for (const limit of [undefined, 500, 3, 1, 0, -1, 2.5, NaN, Infinity]) {
    assert.deepEqual(rs.inkVocabularyHints(sources, limit), ts.inkVocabularyHints(sources, limit), `limit ${limit}`);
  }
  assert.deepEqual(rs.inkVocabularyHints([]), ts.inkVocabularyHints([]));
});
