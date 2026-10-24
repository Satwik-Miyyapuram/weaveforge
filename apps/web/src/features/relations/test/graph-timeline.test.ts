import assert from "node:assert/strict";
import { test } from "node:test";

import type { GLink, GNode } from "../application/build-graph-data";
import { graphTopologyKey, timelineLaneX, YEAR_SPACING } from "../application/graph-timeline";

/** The canvas's layout maths, out of the component (26-18). */

const node = (id: string, year?: number) => ({ id, year }) as unknown as GNode;
const link = (id: string) => ({ id }) as unknown as GLink;

test("the force layout has no lanes", () => {
  assert.equal(timelineLaneX("force", [node("a", 2020)]), null);
});

test("a timeline with no years has no lanes", () => {
  assert.equal(timelineLaneX("timeline", [node("a"), node("b")]), null);
  assert.equal(timelineLaneX("timeline", []), null);
});

test("lanes centre on the rounded mean year, one spacing per year", () => {
  const lane = timelineLaneX("timeline", [node("a", 2019), node("b", 2020), node("c", 2022)])!;
  // mean 2020.33 rounds to 2020
  assert.equal(lane(node("x", 2020)), 0);
  assert.equal(lane(node("x", 2022)), 2 * YEAR_SPACING);
  assert.equal(lane(node("x", 2018)), -2 * YEAR_SPACING);
});

test("a node without a year is left to the forces", () => {
  const lane = timelineLaneX("timeline", [node("a", 2020)])!;
  assert.equal(lane(node("tag")), null);
});

test("the topology key ignores order and includes the local view", () => {
  const a = graphTopologyKey({ nodes: [node("b"), node("a")], links: [link("y"), link("x")] }, "a", 2);
  const b = graphTopologyKey({ nodes: [node("a"), node("b")], links: [link("x"), link("y")] }, "a", 2);
  assert.equal(a, b);
  assert.equal(a, "a,b|x,y|a|2");
  assert.equal(graphTopologyKey({ nodes: [], links: [] }, null, 1), "|||1");
});
