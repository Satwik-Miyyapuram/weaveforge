import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { figureLabel } from "../src/figure-label.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("data URLs are numbered from the index", () => {
  assert.equal(figureLabel("data:image/png;base64,AAAA", 0), "figure 1");
  assert.equal(figureLabel("data:image/png;base64,AAAA", 4), "figure 5");
});

test("a storage path is read as a path", () => {
  assert.equal(figureLabel("runs/exp-1/plot.svg", 2), "plot.svg");
});

test("percent escapes are decoded; plus is not a space", () => {
  assert.equal(figureLabel("https://example.org/a%20b.png", 0), "a b.png");
  assert.equal(figureLabel("runs/%C3%BCber.png", 0), "über.png");
  assert.equal(figureLabel("runs/a+b.png", 0), "a+b.png");
});

test("a malformed or non-UTF-8 escape is shown raw", () => {
  assert.equal(figureLabel("runs/a%zz.png", 0), "a%zz.png");
  assert.equal(figureLabel("runs/%FF.png", 0), "%FF.png");
});

test("an empty last segment falls back to the number", () => {
  assert.equal(figureLabel("runs/", 1), "figure 2");
  assert.equal(figureLabel("runs/?x=1", 0), "figure 1");
});
