/** A thumbnail tile says whether it is loading or has no image, never a blank box (DA-33). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { CardThumbs } from "../card-thumbs";

test("a tile still loading shows the skeleton", () => {
  const html = renderToStaticMarkup(<CardThumbs urls={[null]} loading />);
  assert.match(html, /card-thumb-loading/);
  assert.doesNotMatch(html, /card-thumb-missing/);
});

test("a tile that resolved to nothing shows an image glyph, not a blank box", () => {
  const html = renderToStaticMarkup(<CardThumbs urls={[null, "blob:x"]} />);
  assert.equal(html.match(/card-thumb-missing/g)?.length, 1);
  assert.match(html, /<svg/);
  assert.match(html, /<img src="blob:x"/);
});

test("the skeleton pulses, and stops under reduced motion", () => {
  const css = readFileSync(fileURLToPath(new URL("../../app/styles/entity-detail.css", import.meta.url)), "utf8");
  assert.match(css, /\.card-thumb-loading \{[^}]*animation:/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.card-thumb-loading \{ animation: none; \}/);
});
