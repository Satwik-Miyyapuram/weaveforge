import { test } from "node:test";
import assert from "node:assert/strict";

import { labelSize, nodeSize } from "../ui/graph-sizing";

const ZOOMS = [0.5, 1, 4, 20];

test("a label's border stays a hair of its font at every zoom", () => {
  for (const z of ZOOMS) {
    const { font, line } = labelSize("paper", z);
    assert.ok(line / font < 0.12, `z=${z}: border ${line} on font ${font}`);
    assert.equal(font * z, 10.5, `z=${z}: font holds 10.5px on screen`);
  }
});

test("a node's outline and shadow are fractions of the node", () => {
  for (const z of ZOOMS) {
    const { r, line, drop } = nodeSize(9.6, "paper", z);
    assert.ok(line / r < 0.2, `z=${z}: outline ${line} on r ${r}`);
    assert.ok(drop / r < 0.3, `z=${z}: shadow ${drop} on r ${r}`);
  }
});

test("on screen a node stays between 4 and 18px and grows gently", () => {
  const screen = ZOOMS.map((z) => nodeSize(6, "paper", z).r * z);
  for (const px of screen) assert.ok(px >= 4 && px <= 18, `${px}px`);
  for (let i = 1; i < screen.length; i++) assert.ok(screen[i]! >= screen[i - 1]!);
  // The camera zooms 40x; the node grows well under 2x.
  assert.ok(screen[3]! / screen[0]! < 2, `${screen[0]} -> ${screen[3]}`);
  assert.ok(nodeSize(40, "tag", 20).r * 20 <= 16);
});

test("the hit area covers the outline and never shrinks under 7px", () => {
  for (const z of ZOOMS) {
    const { r, line, hit } = nodeSize(3, "paper", z);
    assert.ok(hit >= r + line);
    assert.ok(hit * z >= 7 - 1e-9);
  }
});

test("unbounded zoom keeps the node's own size", () => {
  assert.equal(nodeSize(6, "paper", 20, false).r, 6);
});
