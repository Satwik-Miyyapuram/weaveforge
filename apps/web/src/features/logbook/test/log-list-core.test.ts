/**
 * The logbook list helpers run in Rust. These tests pin the shape the screen relies on:
 * indexes map back to the caller's rows, and "today" comes from the caller.
 */
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

test("entry dates group newest day first, with indexes into the input", () => {
  const groups = readyCore().groupByDay(["2026-11-09", "2026-11-10", "2026-11-09"]);
  assert.deepEqual(groups, [
    { day: "2026-11-10", indexes: [1] },
    { day: "2026-11-09", indexes: [0, 2] },
  ]);
});

test("the eyebrow counts entries and a streak back from the given today", () => {
  const dates = ["2026-11-10", "2026-11-09", "2026-11-08"];
  assert.equal(readyCore().logEyebrow(dates, "2026-11-10"), "3 entries · 3-day streak");
  // Option::None crosses the wasm boundary as null; the screen maps it to undefined.
  assert.equal(readyCore().logEyebrow([], "2026-11-10"), null);
});

test("a headline drops heading and emphasis marks and falls back when blank", () => {
  assert.deepEqual(readyCore().splitHeadline("# *Plan* ok\nmore"), { headline: "Plan ok", rest: "more" });
  assert.equal(readyCore().splitHeadline("  ").headline, "Untitled entry");
});
