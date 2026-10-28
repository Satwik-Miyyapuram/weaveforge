/**
 * Zero raw buttons (design D02, G1). Only the primitives in
 * components/button.tsx and components/controls.tsx may write <button>; every
 * screen uses them, and a hand-written button class is a raw button in disguise.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../", import.meta.url));
const PRIMITIVES = ["components/button.tsx", "components/controls.tsx"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(src).map((path) => ({
  rel: relative(src, path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

function hits(pattern: RegExp, allow: string[] = []): string[] {
  return files
    .filter((f) => !allow.includes(f.rel))
    .flatMap((f) => [...f.text.matchAll(pattern)].map((m) => `${f.rel}:${f.text.slice(0, m.index).split("\n").length}`));
}

test("no raw <button> outside the button primitives", () => {
  assert.deepEqual(hits(/<button\b/g, PRIMITIVES), []);
});

test("no hand-written Button classes: btn-primary, btn-secondary, btn-ghost, btn-danger, btn-sm, link-btn, icon-btn", () => {
  // A class string, in quotes or a template, naming one of the Button classes.
  const pattern = /className=(?:"[^"]*|\{`[^`]*|\{[^}]*"[^"]*)(?<![\w-])(?:btn-(?:primary|secondary|ghost|danger|sm)|link-btn|icon-btn)(?![\w-])/g;
  // The pitch site is a separate page with its own CSS module, whose classes share names only.
  const pitch = files.filter((f) => f.rel.startsWith("app/pitch/")).map((f) => f.rel);
  assert.deepEqual(hits(pattern, [...PRIMITIVES, ...pitch]), []);
});

test("no hand-rolled segmented choice: SegmentedControl and ViewSwitch own seg-on", () => {
  // `x ? "seg-on" : ...` is a pick-one group written by hand.
  assert.deepEqual(hits(/\?\s*"seg-on"/g, ["components/segmented-control.tsx", "components/view-switch.tsx"]), []);
});

test("the CI gate bans raw buttons outright, with no ceiling", () => {
  const gate = readFileSync(fileURLToPath(new URL("../../../../../scripts/check-ui-consistency.mjs", import.meta.url)), "utf8");
  const rule = gate.slice(gate.indexOf('name: "raw <button> (G1)"'), gate.indexOf("},", gate.indexOf('name: "raw <button> (G1)"')));
  assert.ok(rule.length > 0, "the G1 rule exists");
  assert.doesNotMatch(rule, /ceiling/);
  assert.match(rule, /components\/controls\.tsx/);
});
