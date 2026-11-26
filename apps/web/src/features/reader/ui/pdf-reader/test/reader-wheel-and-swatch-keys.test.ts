import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const reader = readFileSync(fileURLToPath(new URL("../pdf-reader.tsx", import.meta.url)), "utf8");

/** The source of the effect that adds `listener`, from `useEffect(` to its dependency list. */
function effectAdding(listener: string): string {
  const at = reader.indexOf(`addEventListener("${listener}"`);
  assert.ok(at > 0, `an effect adds a ${listener} listener`);
  const start = reader.lastIndexOf("useEffect(", at);
  const end = reader.indexOf("}, [", at);
  assert.ok(start > 0 && end > at, `the ${listener} effect is a useEffect with deps`);
  return reader.slice(start, reader.indexOf("]);", end) + 3);
}

test("P2-27: the pinch-zoom wheel listener re-attaches when the scroll container mounts again", () => {
  const effect = effectAdding("wheel");
  // Keyed on the ref object alone, the effect never re-runs: a container that mounts
  // after the first render (the error screen cleared) gets no wheel listener at all.
  assert.doesNotMatch(effect, /\}, \[containerRef\]\);$/);
  assert.match(effect, /const scroller = scrollerEl;/);
  assert.match(effect, /\}, \[scrollerEl\]\);$/);
  // The element the effect keys on is the one the scroll div mounts.
  assert.match(reader, /ref=\{setScrollerRef\}/);
});

test("P2-28: the phone pill's colour swatches are keyed by slot, so two slots with one colour both render", () => {
  const pill = reader.slice(reader.indexOf('className="pdf-reader-pill-colours"'));
  const swatches = pill.slice(0, pill.indexOf("</div>"));
  assert.doesNotMatch(swatches, /key=\{colour\}/);
  assert.match(swatches, /quickColours\.slice\(0, 4\)\.map\(\(colour, i\) => \(\s*<Swatch\s+(?:\/\/[^\n]*\s+)?key=\{i\}/);
});
