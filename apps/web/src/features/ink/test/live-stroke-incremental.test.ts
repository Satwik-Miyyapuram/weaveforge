// The wet stroke handed to the renderer every frame (perf review I1/I2): one
// stable object per live stroke, buffers reused, and only the new raw samples
// copied, so per-frame work tracks the new points, not the stroke's length.
// Built by hand (no wasm): a fake packer stands in for the Rust one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { liveForRenderer, type LiveStroke } from "../worker/live-stroke";

const header = { strokeId: 7, width: 5, tool: "pen", colour: "black" } as unknown as LiveStroke["header"];

/** A points array that counts how many coordinates are read from it. */
function counted(): { values: number[]; reads: () => number; reset: () => void } {
  let reads = 0;
  const values = new Proxy<number[]>([], {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { values, reads: () => reads, reset: () => { reads = 0; } };
}

function rawStroke(points: number[], pressures: number[] = []): LiveStroke {
  return {
    header,
    points,
    pressures,
    realSamples: 0,
    changed: true,
    packer: { push() {}, points: () => new Float64Array(0), pressures: () => new Float64Array(0) },
    raw: true,
  };
}

function append(stroke: LiveStroke, from: number, n: number): void {
  for (let i = from; i < from + n; i += 1) {
    stroke.points.push(i, i * 2);
    stroke.pressures.push(i % 256);
  }
  stroke.realSamples += n;
}

test("the renderer gets the same live object every frame, so it packs incrementally", () => {
  const stroke = rawStroke([]);
  append(stroke, 0, 3);
  const first = liveForRenderer(stroke);
  append(stroke, 3, 2);
  const second = liveForRenderer(stroke);
  assert.equal(second, first, "one object per live stroke");
  assert.equal(second.realCount, 5);
  assert.deepEqual(Array.from(second.x), [0, 1, 2, 3, 4]);
  assert.deepEqual(Array.from(second.y), [0, 2, 4, 6, 8]);
  assert.deepEqual(Array.from(second.pressure), [0, 1, 2, 3, 4]);
});

test("a frame reads only the new raw samples and the predicted tail, never the whole stroke", () => {
  const { values, reads, reset } = counted();
  const stroke = rawStroke(values);
  append(stroke, 0, 2000);
  liveForRenderer(stroke);
  append(stroke, 2000, 3);
  stroke.points.push(9000, 9001); // predicted tail
  stroke.pressures.push(5);
  reset();
  const live = liveForRenderer(stroke);
  assert.ok(reads() <= (3 + 1) * 2, `read ${reads()} coordinates for 3 new samples + 1 predicted`);
  assert.equal(live.realCount, 2003);
  assert.equal(live.x.length, 2004);
  assert.equal(live.x[2003], 9000);
  assert.equal(live.x[1999], 1999, "the old prefix survives buffer growth");
});

test("a predicted tail replaced by real samples is overwritten, not kept", () => {
  const stroke = rawStroke([]);
  append(stroke, 0, 2);
  stroke.points.push(50, 50);
  stroke.pressures.push(9);
  assert.equal(liveForRenderer(stroke).x.length, 3);
  stroke.points.length = 4;
  stroke.pressures.length = 2;
  append(stroke, 2, 1);
  const live = liveForRenderer(stroke);
  assert.deepEqual(Array.from(live.x), [0, 1, 2]);
  assert.equal(live.realCount, 3);
});

test("a raw stroke cut back at the point cap still draws its kept samples", () => {
  const stroke = rawStroke([]);
  append(stroke, 0, 10);
  liveForRenderer(stroke);
  stroke.points.length = 12;
  stroke.pressures.length = 6;
  stroke.realSamples = 6;
  const live = liveForRenderer(stroke);
  assert.equal(live.realCount, 6);
  assert.deepEqual(Array.from(live.x), [0, 1, 2, 3, 4, 5]);
});

test("a classic stroke draws what the packer kept, then the tail, in the same object", () => {
  let kept = [0, 0, 10, 10];
  const stroke: LiveStroke = {
    ...rawStroke([0, 0, 5, 5, 10, 10]),
    raw: false,
    realSamples: 3,
    packer: {
      push() {},
      points: () => Float64Array.from(kept),
      pressures: () => Float64Array.from({ length: kept.length / 2 }, () => 128),
    },
  };
  const first = liveForRenderer(stroke);
  assert.deepEqual(Array.from(first.x), [0, 10]);
  kept = [0, 0, 10, 10, 20, 0];
  stroke.points.push(30, 0);
  stroke.pressures.push(128);
  const second = liveForRenderer(stroke);
  assert.equal(second, first);
  assert.equal(second.realCount, 3);
  assert.deepEqual(Array.from(second.x), [0, 10, 20, 30]);
});
