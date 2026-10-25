import { test } from "node:test";
import assert from "node:assert/strict";
import { supportsWebglInk } from "../render/webgl-support";

/** A canvas whose context counts how often it was lost. */
function fakeCanvas(context: "webgl2" | null) {
  const counts = { lost: 0, asked: 0 };
  const canvas = {
    getContext(kind: string) {
      counts.asked++;
      if (kind !== "webgl2" || context === null) return null;
      return {
        getExtension: (name: string) =>
          name === "WEBGL_lose_context" ? { loseContext: () => counts.lost++ } : null,
      };
    },
  };
  return { canvas, counts };
}

function withOffscreen<T>(ctor: unknown, run: () => T): T {
  const g = globalThis as { OffscreenCanvas?: unknown };
  const had = "OffscreenCanvas" in g;
  const previous = g.OffscreenCanvas;
  g.OffscreenCanvas = ctor;
  try {
    return run();
  } finally {
    if (had) g.OffscreenCanvas = previous;
    else delete g.OffscreenCanvas;
  }
}

test("the scratch probe context is lost before returning (19-18)", () => {
  const scratch = fakeCanvas("webgl2");
  const real = fakeCanvas("webgl2");
  const ok = withOffscreen(
    function OffscreenCanvas() {
      return scratch.canvas;
    },
    () => supportsWebglInk(real.canvas as never),
  );
  assert.equal(ok, true);
  assert.equal(scratch.counts.lost, 1);
  assert.equal(real.counts.asked, 0, "the real canvas is never probed");
});

test("the real canvas is not lost when it is the probe target", () => {
  const real = fakeCanvas("webgl2");
  // No OffscreenCanvas constructor and not a DOM canvas: the probe falls back to it.
  const g = globalThis as { HTMLCanvasElement?: unknown };
  const had = "HTMLCanvasElement" in g;
  g.HTMLCanvasElement = class {};
  let ok: boolean;
  try {
    ok = withOffscreen(undefined, () => supportsWebglInk(real.canvas as never));
  } finally {
    if (!had) delete g.HTMLCanvasElement;
  }
  assert.equal(ok, true);
  assert.equal(real.counts.lost, 0);
});

test("no WebGL2 is false, and a throw is false", () => {
  const none = fakeCanvas(null);
  assert.equal(withOffscreen(function OffscreenCanvas() { return none.canvas; }, () => supportsWebglInk(none.canvas as never)), false);
  assert.equal(withOffscreen(function OffscreenCanvas() { throw new Error("no"); }, () => supportsWebglInk({} as never)), false);
});
