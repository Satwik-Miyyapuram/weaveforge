import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DesktopInkHaptics } from "@/lib/desktop/desktop-bridge";

import { createPenHaptics } from "../application/pen-haptics";

function sink() {
  const sent: DesktopInkHaptics[] = [];
  return {
    sent,
    inkHaptics: (message: DesktopInkHaptics) => sent.push(message),
  };
}

const sample = (velocity: number, pressure = 0.5) => ({
  x: 0,
  y: 0,
  pressure,
  velocity,
  t: 0,
});

describe("createPenHaptics", () => {
  it("throttles updates to one per 8 ms and converts ink units to CSS px", () => {
    let now = 0;
    const out = sink();
    const haptics = createPenHaptics(out, () => now);
    haptics.update(sample(2.6458));
    now = 4;
    haptics.update(sample(10));
    now = 8;
    haptics.update(sample(5.2916, 1.5));
    assert.equal(out.sent.length, 2);
    const first = out.sent[0]!;
    assert.equal(first.type, "update");
    if (first.type === "update") {
      assert.ok(Math.abs(first.velocity - 1) < 1e-3);
      assert.equal(first.pressure, 0.5);
    }
    const second = out.sent[1]!;
    if (second.type === "update") {
      assert.ok(Math.abs(second.velocity - 2) < 1e-3);
      // Clamped: pressure is a fraction.
      assert.equal(second.pressure, 1);
    }
  });

  it("stops once per stroke, immediately, and not when nothing played", () => {
    let now = 0;
    const out = sink();
    const haptics = createPenHaptics(out, () => now);
    haptics.stop();
    assert.equal(out.sent.length, 0);
    haptics.update(sample(1));
    haptics.stop();
    haptics.stop();
    assert.deepEqual(
      out.sent.map((m) => m.type),
      ["update", "stop"],
    );
    // The throttle is reset by a stop: the next stroke's first sample goes at once.
    haptics.update(sample(1));
    assert.equal(out.sent.length, 3);
  });

  it("sends the tool by name", () => {
    const out = sink();
    createPenHaptics(out, () => 0).setTool("highlighter");
    assert.deepEqual(out.sent, [{ type: "tool", tool: "highlighter" }]);
  });
});
