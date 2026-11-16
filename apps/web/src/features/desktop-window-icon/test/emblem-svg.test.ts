/**
 * The emblem's colours for the running window icon. Each CSS variable use in the
 * emblem's style block is replaced with the picked literal colour, so the raster
 * shows the chosen ink and dot and nothing depends on the page's theme.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { recolourEmblem } from "../emblem-svg";

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
