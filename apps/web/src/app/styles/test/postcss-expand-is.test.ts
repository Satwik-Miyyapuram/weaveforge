import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { expandSelector, specificity } = require("../postcss-expand-is.cjs") as {
  expandSelector: (s: string) => string;
  specificity: (s: string) => [number, number, number] | null;
};

const unchanged = (s: string) => assert.equal(expandSelector(s), s);

test("splits a rightmost :is() into keyed selectors", () => {
  assert.equal(expandSelector(":is(.a, .b)"), ".a,\n.b");
});

test("keeps pseudo-classes and puts a pseudo-element last", () => {
  assert.equal(expandSelector(":is(.a,.b):hover::before"), ".a:hover::before,\n.b:hover::before");
});

test("pads a weaker argument up to the :is() specificity", () => {
  assert.equal(expandSelector(".p :is(.a, .b.c)"), ".p .a:not(.wf-pad),\n.p .b.c");
  assert.deepEqual(specificity(".p .a:not(.wf-pad)"), specificity(".p :is(.a, .b.c)"));
});

test("splits complex arguments only under a bare :root", () => {
  assert.equal(expandSelector(":root :is(.seg > button,.x)"), ":root .seg > button,\n:root .x:not(wf-pad)");
  unchanged(".p :is(.seg > button,.x)");
  unchanged(':root[data-theme="brutal"] :is(.screen-head h1, .a.b)');
  unchanged(":root :is([x] .a,.b)");
});

test("an attribute is a key", () => {
  assert.equal(expandSelector(':is([data-s="x"],.st)'), '[data-s="x"],\n.st');
});

test("leaves selectors it cannot split exactly", () => {
  unchanged(":where(.a,.b)");
  unchanged(".k:is(.a,.b)");
  unchanged(":not(:is(.a,.b))");
  unchanged(":is(:is(.a,.b) .c, .d)");
  unchanged(":is(.a::before,.b)");
  // An argument past the max in some column could only be padded the wrong way.
  unchanged(":is(.a,button)");
  unchanged(":is(#a,.b)");
});

test("specificity counts :is() by its strongest argument", () => {
  assert.deepEqual(specificity(":is(.a,#b) c"), [1, 0, 1]);
  assert.deepEqual(specificity(":where(#a) .b"), [0, 1, 0]);
});
