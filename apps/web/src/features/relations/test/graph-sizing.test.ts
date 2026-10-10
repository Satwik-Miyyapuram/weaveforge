import { test } from "node:test";
import assert from "node:assert/strict";

import { labelSize, nodeSize } from "../ui/graph-sizing";

const ZOOMS = [0.25, 0.5, 1, 2, 4, 8];
const BASE = 6;

// The mock's formula, written out here so the module is not checked against itself.
function expected(base: number, kind: "paper" | "tag", z: number) {
  const zz = Math.max(0.01, z);
  const s = Math.min(3.2, Math.max(0.6, Math.pow(zz, 0.45)));
  const R = Math.max(5, base * s);
  const r = R / zz;
  const line = Math.max(1.2, R * 0.13) / zz;
  const drop = Math.max(1.5, R * 0.18) / zz;
  const hit = Math.max(r + line, 7 / zz);
  const screen = kind === "tag" ? 10 : 10.5;
  const font = (screen * Math.min(2.2, Math.max(0.85, Math.pow(zz, 0.35)))) / zz;
  const labelLine = Math.max(1, (font * zz * 0.09)) / zz;
  const gap = 2 / zz;
  return { r, line, drop, hit, font, labelLine, gap };
}

test("bounded node and label sizes follow the mock formula at each zoom", () => {
  for (const kind of ["paper", "tag"] as const) {
    for (const z of ZOOMS) {
      const want = expected(BASE, kind, z);
      const node = nodeSize(BASE, kind, z);
      const label = labelSize(kind, z);
      const at = `${kind} z=${z}`;
      assert.ok(Math.abs(node.r - want.r) < 1e-9, `${at}: r ${node.r} vs ${want.r}`);
      assert.ok(Math.abs(node.line - want.line) < 1e-9, `${at}: line ${node.line} vs ${want.line}`);
      assert.ok(Math.abs(node.drop - want.drop) < 1e-9, `${at}: drop ${node.drop} vs ${want.drop}`);
      assert.ok(Math.abs(node.hit - want.hit) < 1e-9, `${at}: hit ${node.hit} vs ${want.hit}`);
      assert.ok(Math.abs(label.font - want.font) < 1e-9, `${at}: font ${label.font} vs ${want.font}`);
      assert.ok(Math.abs(label.line - want.labelLine) < 1e-9, `${at}: label line ${label.line} vs ${want.labelLine}`);
      assert.ok(Math.abs(label.gap - want.gap) < 1e-9, `${at}: gap ${label.gap} vs ${want.gap}`);
    }
  }
});

test("bounded node radius never draws under 5px on screen", () => {
  const { r } = nodeSize(1, "paper", 0.1);
  assert.ok(Math.abs(r * 0.1 - 5) < 1e-9, `r*z = ${r * 0.1}`);
});

test("bounded node radius caps its growth at 3.2x base on screen", () => {
  const { r } = nodeSize(6, "paper", 100);
  assert.ok(Math.abs(r * 100 - 6 * 3.2) < 1e-9, `r*z = ${r * 100}`);
});

test("the hit area never shrinks under 7px on screen", () => {
  for (const z of ZOOMS) {
    const { r, line, hit } = nodeSize(3, "paper", z);
    assert.ok(hit >= r + line);
    assert.ok(hit * z >= 7 - 1e-9);
  }
});

test("unbounded zoom keeps the node's own size", () => {
  assert.equal(nodeSize(6, "paper", 20, false).r, 6);
});
