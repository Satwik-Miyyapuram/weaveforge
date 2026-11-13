import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { GNode } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

/** The canvas's layout maths, out of the component (26-18). */

const node = (id: string, year?: number) => ({ id, year }) as unknown as GNode;

test("the force layout has no lanes", () => {
  assert.equal(readyCore().timelineLaneX("force", [node("a", 2020)]), null);
});

test("a timeline with no years has no lanes", () => {
  assert.equal(readyCore().timelineLaneX("timeline", [node("a"), node("b")]), null);
  assert.equal(readyCore().timelineLaneX("timeline", []), null);
});

test("lanes centre on the rounded mean year, one spacing per year", () => {
  const lane = readyCore().timelineLaneX("timeline", [node("a", 2019), node("b", 2020), node("c", 2022)])!;
  const spacing = readyCore().yearSpacing();
  // mean 2020.33 rounds to 2020
  assert.equal(lane(node("x", 2020)), 0);
  assert.equal(lane(node("x", 2022)), 2 * spacing);
  assert.equal(lane(node("x", 2018)), -2 * spacing);
});

test("a node without a year is left to the forces", () => {
  const lane = readyCore().timelineLaneX("timeline", [node("a", 2020)])!;
  assert.equal(lane(node("tag")), null);
});
