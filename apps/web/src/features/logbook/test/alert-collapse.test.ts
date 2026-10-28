/**
 * A citation alert lists up to 20 papers, and with long titles one entry
 * filled several screens of the log (design D19, DA-110). The card now shows
 * the top five and a button for the rest.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collapseAlert } from "../ui/collapse-alert";

const items = (n: number) => Array.from({ length: n }, (_, i) => `- [Paper ${i + 1}](https://x/${i + 1}) — 2025`);
const alertRest = (n: number, more = 0) =>
  [`${n + more} new papers cited this tracked paper:`, "", ...items(n), ...(more ? [`- …and ${more} more`] : [])].join("\n");

test("an alert with twenty papers shows the top five", () => {
  const out = collapseAlert("Citation alert: Attention", alertRest(20, 1919));
  assert.ok(out);
  assert.equal(out.hidden, 15);
  assert.match(out.shown, /Paper 5\]/);
  assert.doesNotMatch(out.shown, /Paper 6\]/);
  assert.doesNotMatch(out.shown, /…and 1919 more/, "the remainder line belongs with the hidden rows");
  assert.match(out.shown, /^1939 new papers cited/, "the count line stays");
});

test("five papers or fewer are left alone", () => {
  assert.equal(collapseAlert("Citation alert: Attention", alertRest(5)), null);
});

test("other entries are never collapsed, lists and all", () => {
  assert.equal(collapseAlert("Read three papers", items(12).join("\n")), null);
});

test("the log card offers Show n more and expands in place", () => {
  const screen = readFileSync(fileURLToPath(new URL("../ui/logbook-screen.tsx", import.meta.url)), "utf8");
  assert.match(screen, /collapseAlert\(headline, rest\)/);
  assert.match(screen, /Show \{collapsed\.hidden\} more/);
  assert.match(screen, /aria-expanded=\{false\}/);
});
