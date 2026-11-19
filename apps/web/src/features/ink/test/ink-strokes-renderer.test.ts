import assert from "node:assert/strict";
import { test } from "node:test";

import { paintFreehandStroke, type Context2dLike } from "../render/canvas-renderer";
import { readyCore } from "@/lib/rust-core";
import { settledStrokePath } from "../ui/ink-strokes";

const POINTS = [0, 0, 50, 0, 100, 20];
const WIDTH = 10;

/** The outline's numbers, in order, from `M x y L x y … Z` path data. */
function outlineNumbers(d: string): number[] {
  return [...d.matchAll(/-?[\d.]+(?:e-?\d+)?/g)].map((m) => Number(m[0]));
}

test("the settled stroke is the capsule path when the renderer is classic", () => {
  assert.equal(settledStrokePath(POINTS, WIDTH, "classic"), readyCore().strokePath(POINTS));
});

test("the settled stroke is a perfect-freehand outline when the renderer is freehand", () => {
  const d = settledStrokePath(POINTS, WIDTH, "freehand") ?? "";
  assert.match(d, /^M/);
  assert.ok(d.endsWith(" Z"));
  assert.notEqual(d, readyCore().strokePath(POINTS));
});

test("a settled freehand stroke is WIDTH across: its outline sits WIDTH / 2 either side of a straight run", () => {
  const flat = Array.from({ length: 21 }, (_, k) => [k * 10, 0]).flat();
  const numbers = outlineNumbers(settledStrokePath(flat, WIDTH, "freehand") ?? "");
  const ys = numbers.filter((_, i) => i % 2 === 1);
  const top = Math.max(...ys);
  const bottom = Math.min(...ys);
  assert.ok(Math.abs(top - WIDTH / 2) <= (WIDTH / 2) * 0.1, `upper edge ${top}`);
  assert.ok(Math.abs(bottom + WIDTH / 2) <= (WIDTH / 2) * 0.1, `lower edge ${bottom}`);
});

test("wet and settled freehand strokes trace the same outline", () => {
  const calls: string[] = [];
  const context = {
    fillStyle: "",
    beginPath() {},
    moveTo(x: number, y: number) {
      calls.push(`M${x} ${y}`);
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      calls.push(`Q${cx} ${cy} ${x} ${y}`);
    },
    closePath() {},
    fill() {},
    arc() {},
  };
  const x = Float32Array.from([0, 50, 100]);
  const y = Float32Array.from([0, 0, 20]);
  paintFreehandStroke(
    context as unknown as Context2dLike,
    x,
    y,
    new Uint8Array([255, 255, 255]),
    { width: WIDTH, tool: "pen", colour: "text" },
    false,
  );
  const wet = outlineNumbers(calls.join(" "));
  const settled = outlineNumbers(settledStrokePath(POINTS, WIDTH, "freehand") ?? "");
  assert.ok(wet.length > 0);
  assert.deepEqual(wet, settled);
});
