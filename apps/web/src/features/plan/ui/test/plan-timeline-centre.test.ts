/**
 * Plan timeline marks sit centred on the track in every theme. Each mark is a
 * catalogue row button, whose padding would push the dot below the line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const base = read("../../../../app/styles/entity-detail.css");
const brutal = read("../../../../app/styles/brutal.css");
const px = (rule: string, prop: string) => {
  const v = Number(rule.match(new RegExp(String.raw`(?:^|[;{\s])${prop}:\s*(-?\d+)px`))?.[1]);
  assert.ok(Number.isFinite(v), `${prop} not found in: ${rule}`);
  return v;
};
const ruleOf = (css: string, selector: RegExp) => css.match(new RegExp(String.raw`${selector.source}\s*\{([^}]*)\}`))?.[1] ?? "";

test("the mark's row button drops its catalogue padding (outranks :root:root .wf-row)", () => {
  const rule = ruleOf(base, /:root:root \.plan-mark-slot > \.wf-row/);
  assert.match(rule, /padding:\s*0/);
  assert.match(rule, /min-height:\s*0/);
});

test("mark centre equals track centre, default and brutal/crt themes", () => {
  const slot = ruleOf(base, /\n\.plan-mark-slot/);
  const mark = ruleOf(base, /\n\.plan-mark/);
  const markCentre = px(slot, "top") + px(mark, "height") / 2;
  const tracks = [
    ruleOf(base, /\n\.plan-track/),
    ruleOf(brutal, /:root:is\(\[data-theme="brutal"\], \[data-theme="brutal-dark"\], \[data-theme="crt"\]\) \.plan-track/),
  ];
  for (const t of tracks) assert.equal(px(t, "top") + px(t, "height") / 2, markCentre);
});
