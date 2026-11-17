/**
 * The emblem's colours for the running window icon. Each CSS variable use in the
 * emblem's style block is replaced with the picked literal colour, so the raster
 * shows the chosen ink and dot and nothing depends on the page's theme.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { recolourEmblem, taskbarEmblem } from "../emblem-svg";

const svg = `<svg viewBox="0 0 512 512"><style>.ink-stroke { stroke: var(--logo-ink, #2B222B); }
.accent-fill { fill: var(--logo-accent, #1F6DAB); }</style><circle class="ink-stroke"/></svg>`;

test("recolourEmblem replaces the ink and accent variables with the picked colours", () => {
  const out = recolourEmblem(svg, { ink: "#ffe7c1", dot: "#5aa0d8" });
  assert.match(out, /stroke: #ffe7c1;/);
  assert.match(out, /fill: #5aa0d8;/);
});

test("recolourEmblem leaves no CSS variable behind", () => {
  const out = recolourEmblem(svg, { ink: "#2b222b", dot: "#1f6dab" });
  assert.doesNotMatch(out, /var\(/);
});

test("recolourEmblem keeps the geometry unchanged", () => {
  const out = recolourEmblem(svg, { ink: "#2b222b", dot: "#1f6dab" });
  assert.equal(out.replace(/#[0-9a-f]{6}/gi, "X"), svg.replace(/var\(--logo-ink, [^)]*\)|var\(--logo-accent, [^)]*\)/g, "X").replace(/#[0-9a-f]{6}/gi, "X"));
});

const emblem = `<svg viewBox="0 0 512 512" width="100%" height="100%"><path stroke-width="22"/>
<line stroke-width="12"/><line stroke-width="12"/><circle r="22"/><circle r="22"/></svg>`;

test("taskbarEmblem crops to the emblem and thickens every stroke for a taskbar-sized icon", () => {
  const out = taskbarEmblem(emblem);
  assert.match(out, /viewBox="94 90 340 340"/);
  assert.match(out, /<path stroke-width="30"\/>/);
  assert.equal(out.match(/stroke-width="21"/g)?.length, 2);
  assert.equal(out.match(/ r="29"/g)?.length, 2);
  assert.doesNotMatch(out, /"22"|"12"/);
});

test("taskbarEmblem refuses a source whose viewBox changed, so a crop never cuts the emblem", () => {
  assert.throws(() => taskbarEmblem(emblem.replace("0 0 512 512", "0 0 600 600")), /viewBox/);
});
