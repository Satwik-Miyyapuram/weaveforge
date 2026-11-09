import assert from "node:assert/strict";
import { test } from "node:test";
import { rust } from "../../../src/shared/rust.js";



/**
 * A metric chip must never print `[object Object]`.
 *
 * The bug this pins, reported from the experiment page: a run whose metric value
 * is an **object** rather than a number rendered as the literal `[object
 * Object]` in its "Metrics" row. The old fallback was
 *
 *     if (!Number.isFinite(n)) return String(value ?? "—");
 *
 * and `String` on any object produces exactly that string. `Number(anObject)` is
 * always `NaN`, so every non-numeric value reached it — which is why the symptom
 * is this specific text and not a blank or a crash.
 *
 * The rule now: a numeric value is formatted, a string is shown, and anything
 * structured is shown as data. What is not allowed is a value that has been
 * through no decision at all.
 */

test("a number is formatted, and a numeric string is treated as one", () => {
  assert.equal(rust().formatMetricCell("mig", 0.22), "0.2200");
  assert.equal(rust().formatMetricCell("mig", "0.22"), "0.2200");
  assert.equal(rust().formatMetricCell("accuracy", 0.912), "0.9120");
  // The precision bands are `formatMetricValue`'s and unchanged: >= 0.01 takes
  // four decimals, >= 1 takes three, >= 100 takes one.
  assert.equal(rust().formatMetricCell("train/loss", 0.02), "0.0200");
  // 98.4 is >= 1 and < 100, so three decimals — not the "98.4" a person might
  // write by hand.
  assert.equal(rust().formatMetricCell("nll", 98.4), "98.400");
  assert.equal(rust().formatMetricCell("params", 1500), "1500.0");
});

test("an object is shown as JSON, never as [object Object]", () => {
  const rendered = rust().formatMetricCell("loss_by_step", { step: 10, value: 0.5 });
  assert.notEqual(rendered, "[object Object]");
  assert.equal(rendered, '{"step":10,"value":0.5}');
});

test("an array is shown as JSON rather than as a comma-mangled string", () => {
  const rendered = rust().formatMetricCell("confusion", [1, 2, 3]);
  assert.notEqual(rendered, "1,2,3");
  assert.equal(rendered, "[1,2,3]");
});

test("a boolean is spelled, not coerced to a bare zero", () => {
  // `Number(false)` is 0 — finite — so a boolean used to render as "0.0000",
  // which is a different claim from "false".
  assert.equal(rust().formatMetricCell("converged", true), "true");
  assert.equal(rust().formatMetricCell("converged", false), "false");
});

test("a non-numeric string is shown as itself", () => {
  assert.equal(rust().formatMetricCell("status", "diverged"), "diverged");
  // A string that merely looks numeric is treated as the number it spells, and
  // goes through the same bands as a real one.
  assert.equal(rust().formatMetricCell("note", "1e3"), "1000.0");
  assert.equal(rust().formatMetricCell("note", "0.5"), "0.5000");
});

test("nothing is an em dash, and a nested object still reads", () => {
  assert.equal(rust().formatMetricCell("mig", null), "—");
  assert.equal(rust().formatMetricCell("mig", undefined), "—");
  assert.equal(rust().formatMetricCell("mig", ""), "—");
  assert.equal(rust().formatMetricCell("nested", { a: { b: [1, 2] } }), '{"a":{"b":[1,2]}}');
});

/**
 * And a value that cannot be serialised degrades instead of throwing.
 *
 * This runs inside a React render, so an exception here is a blank page rather
 * than a bad cell. A cycle is the ordinary way `JSON.stringify` fails.
 */
test("a circular value degrades to an em dash rather than throwing", () => {
  const cyclic: Record<string, unknown> = { name: "self" };
  cyclic.self = cyclic;
  assert.equal(rust().formatMetricCell("broken", cyclic), "—");
});

test("edge values read as what they are (02-14)", () => {
  // Zero used to fall through every band to toExponential: "0.00e+0".
  assert.equal(rust().formatMetricCell("loss", 0), "0");
  assert.equal(rust().formatMetricCell("loss", -0), "0");
  assert.equal(rust().formatMetricCell("loss", "0"), "0");
  // A non-finite number used to reach JSON.stringify, which spells it "null".
  assert.equal(rust().formatMetricCell("loss", NaN), "—");
  assert.equal(rust().formatMetricCell("loss", Infinity), "—");
  assert.equal(rust().formatMetricCell("loss", -Infinity), "—");
  // A blank string is no value, not the number zero Number("  ") makes of it.
  assert.equal(rust().formatMetricCell("loss", "   "), "—");
  // A bigint cannot go through JSON; it is still a number to show.
  assert.equal(rust().formatMetricCell("steps", 12n), "12");
  // Negative numbers keep their sign in every band.
  assert.equal(rust().formatMetricCell("delta", -0.5), "-0.5000");
});
