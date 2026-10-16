import assert from "node:assert/strict";
import { test } from "node:test";
import { appendInkStroke, draftInkAnnotation } from "../application/draft-local-annotation";
import {
  PDF_INK_MIN_POINT_DISTANCE,
  PdfInkSampler,
  coalescedSamples,
} from "../application/pdf-ink-sampler";

test("sampler damps hand jitter like the notes' pen", () => {
  const ink = new PdfInkSampler();
  ink.begin(100, 100, 0);
  // A slow horizontal line with ±0.4 pt alternating wobble.
  for (let i = 1; i <= 60; i += 1) ink.push(100 + i * 0.5, 100 + (i % 2 ? 0.4 : -0.4), i * 8);
  const ys = ink.path.filter((_, i) => i % 2 === 1);
  const spread = Math.max(...ys) - Math.min(...ys);
  assert.ok(spread < 0.8, `filtered spread ${spread} should be under raw 0.8`);
});

test("sampler keeps points closer than the old 0.75 pt gap", () => {
  const ink = new PdfInkSampler();
  ink.begin(0, 0, 0);
  for (let i = 1; i <= 20; i += 1) ink.push(i * 0.4, 0, i * 8);
  for (let i = 2; i < ink.path.length; i += 2) {
    const gap = Math.hypot(ink.path[i]! - ink.path[i - 2]!, ink.path[i + 1]! - ink.path[i - 1]!);
    assert.ok(gap >= PDF_INK_MIN_POINT_DISTANCE - 1e-9);
  }
  assert.ok(ink.path.length / 2 > 10, "dense enough to hold a curve");
});

test("non-finite timestamps do not poison the filter", () => {
  const ink = new PdfInkSampler();
  ink.begin(5, 5, Number.NaN);
  ink.push(6, 5, Number.NaN);
  assert.ok(ink.path.every(Number.isFinite));
});

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

function maxDrift(raw: number[], saved: number[]): number {
  let worst = 0;
  for (let i = 0; i < raw.length; i += 2) {
    let best = Infinity;
    for (let j = 2; j < saved.length; j += 2) {
      best = Math.min(best, segDist(raw[i]!, raw[i + 1]!, saved[j - 2]!, saved[j - 1]!, saved[j]!, saved[j + 1]!));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

const arc: number[] = [];
for (let i = 0; i <= 120; i += 1) {
  const a = (i / 120) * Math.PI;
  arc.push(200 + 50 * Math.cos(a), 300 + 50 * Math.sin(a));
}

test("saved stroke keeps its drawn shape within ~0.1 pt", () => {
  const draft = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: arc, width: 2 });
  const saved = draft?.anchor.zoteroPosition?.paths?.[0] ?? [];
  assert.ok(saved.length >= 4);
  const drift = maxDrift(arc, saved);
  assert.ok(drift <= 0.11, `drift ${drift} pt`);
  assert.equal(draft?.anchor.zoteroPosition?.width, 2, "width is the nib, unchanged");
});

test("appended strokes compact the same way", () => {
  const first = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: arc, width: 2 });
  const next = appendInkStroke(first!.anchor, arc);
  const saved = next?.zoteroPosition?.paths?.[1] ?? [];
  assert.ok(maxDrift(arc, saved) <= 0.11);
});

test("coalescedSamples falls back to the event itself", () => {
  const ev = { clientX: 1, clientY: 2 } as unknown as PointerEvent;
  assert.deepEqual(coalescedSamples(ev), [ev]);
  const throws = { getCoalescedEvents: () => { throw new Error("x"); } } as unknown as PointerEvent;
  assert.deepEqual(coalescedSamples(throws), [throws]);
});
