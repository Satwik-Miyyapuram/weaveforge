/**
 * The supervisee snapshot card opens the student's supervision page from
 * anywhere on the card, like the stat cards, not from a "View full" link.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const tsx = read("../ui/cards/card-renderers.tsx");
const css = read("../../../app/styles/dashboard.css");

test("no View full link; the body is one link to the student", () => {
  assert.doesNotMatch(tsx, /View full/);
  assert.match(tsx, /<Link href=\{`\/supervision\?member=\$\{member\.id\}`\} className="dashboard-stat-link dashboard-supervisee-link">/);
});

test("the link's hit area stretches over the whole card; the student picker stays on top", () => {
  assert.match(css, /\.dashboard-supervisee-link::after \{[^}]*position: absolute;[^}]*inset: 0;/);
  assert.match(css, /\.dashboard-supervisee-select-wrap \{[^}]*position: relative;[^}]*z-index: 1;/);
});
