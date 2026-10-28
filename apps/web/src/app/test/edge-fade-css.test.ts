/**
 * Sideways strips show there is more past the edge (DA-93): the edge that hides
 * items fades out, and a swipe stops on an item, not mid-word.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const base = read("../styles/base.css");
const papers = read("../styles/papers.css");

/** Every `selector { ... }` body in `css`, joined. */
function rule(css: string, selector: string): string {
  const bodies: string[] = [];
  for (let at = css.indexOf(`${selector} {`); at >= 0; at = css.indexOf(`${selector} {`, at + 1)) {
    bodies.push(css.slice(at, css.indexOf("}", at)));
  }
  assert.ok(bodies.length, `no ${selector} rule`);
  return bodies.join(" ");
}

test("the fade follows the scroll, so a strip that fits does not fade", () => {
  assert.match(base, /@property --fade-start\s*\{[^}]*initial-value:\s*0px/);
  assert.match(base, /@property --fade-end\s*\{[^}]*initial-value:\s*0px/);
  assert.match(base, /@keyframes edge-fade/);
});

test("the section sub-nav fades its hidden edges and snaps to tabs", () => {
  const css = base.slice(base.indexOf("/* Sideways strips"));
  const strip = rule(css, ".sub-nav");
  assert.match(strip, /mask-image:\s*linear-gradient\(to right/);
  assert.match(strip, /animation-timeline:\s*scroll\(self inline\)/);
  assert.match(strip, /scroll-snap-type:\s*x proximity/);
  assert.match(css, /\.sub-tab\s*\{[^}]*scroll-snap-align:\s*start/);
});

test("the phone filter row wraps instead of scrolling, so no filter is cut at the edge", () => {
  const phone = papers.slice(papers.indexOf("@media (max-width: 899px)"));
  const row = rule(phone, ".filter-row");
  assert.match(row, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(row, /overflow-x:\s*auto/);
  assert.doesNotMatch(row, /edge-fade/);
  // The facet selects share the line; the view switch takes the next one.
  // Each starts from its own label's width: an even 88px split cut "Status"
  // on a 320px phone while "Lists" and "Tags" had room to spare.
  assert.match(phone, /\.filter-row \.custom-select-container\.filter-select \{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/);
  assert.match(phone, /\.filter-row \.filter-select \.custom-select-button \{[^}]*min-width:\s*0/);
});
