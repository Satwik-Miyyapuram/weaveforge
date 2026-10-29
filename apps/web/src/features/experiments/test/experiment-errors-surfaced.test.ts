import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The source of a UI module, to check no failure is swallowed silently. */
function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../ui/${name}`, import.meta.url)), "utf8");
}

/** The body of `async function <name>(` up to the next line that closes it at two spaces. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n  }\n", start);
  return src.slice(start, end);
}

const SWALLOWED = [/\.catch\(\(\) => \{\}\)/, /\.catch\(\(\) => undefined\)/];

test("a status change on the detail screen that fails is shown (35-01)", () => {
  const body = fnBody(source("experiment-detail-screen.tsx"), "setStatus");
  assert.match(body, /catch \(err\)/);
  assert.match(body, /setStatusError\(formatError\(err\)\)/);
  assert.match(source("experiment-detail-screen.tsx"), /<FormError>\{statusError\}<\/FormError>/);
});

test("the card's status failure is shown on the card (35-02)", () => {
  const src = source("experiment-card.tsx");
  assert.match(fnBody(src, "setStatus"), /catch \(err\)[\s\S]*setActionError\(formatError\(err\)\)/);
  assert.match(src, /<FormError>\{actionError\}<\/FormError>/);
});

test("the card's delete and unpin go through removeLater, whose toast says what failed (D-07)", () => {
  const src = source("experiment-card.tsx");
  assert.equal(src.match(/removeLater\(\{/g)?.length, 2);
});

test("no experiments screen swallows a failure without a log (35-03, 35-07)", () => {
  for (const name of ["experiments-screen.tsx", "experiment-panels.tsx"]) {
    const src = source(name);
    for (const re of SWALLOWED) assert.doesNotMatch(src, re, `${name} has ${re}`);
  }
  assert.match(source("experiments-screen.tsx"), /warnOnce\("experiments", "reconcile stale runs failed"/);
  assert.match(source("experiment-panels.tsx"), /warnOnce\("experiments", "linked paper title failed to load"/);
});
