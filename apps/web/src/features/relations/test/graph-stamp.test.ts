import { test } from "node:test";
import assert from "node:assert/strict";
import { textWidth } from "../ui/graph-stamp";

test("label widths are measured once per font and text", () => {
  let calls = 0;
  const ctx = { font: "12px serif", measureText: (s: string) => { calls++; return { width: s.length * 6 }; } } as unknown as CanvasRenderingContext2D;
  for (let frame = 0; frame < 60; frame++) assert.equal(textWidth(ctx, "Attention"), 54);
  assert.equal(calls, 1);
  ctx.font = "700 12px serif";
  textWidth(ctx, "Attention");
  assert.equal(calls, 2, "a new font measures again");
});
