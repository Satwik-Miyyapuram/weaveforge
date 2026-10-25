/** Two selector slips in the stylesheets (review 15-01, 17-02). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const annotations = read("../styles/annotations.css");
const papers = read("../styles/papers.css");

/** Declarations of the rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `missing rule ${selector}`);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

test("the jump-to Create row wins on specificity, not !important (15-01)", () => {
  // It sits inside `.jump-to-list`, whose `button` rule sets `--ink`; a
  // two-class selector outranks that without forcing every later override.
  const body = rule(annotations, ".jump-to-list .jump-to-create");
  assert.match(body, /color:\s*var\(--accent-ink\);/);
  assert.doesNotMatch(annotations, /\.jump-to-create\s*\{[^}]*!important/);
});

test("the short link arrow is hidden and no longer joins the detail-page rule (17-02)", () => {
  assert.match(rule(papers, ".papers-link-short"), /display:\s*none;/);
  // A dangling `.papers-link-short,` before the comment made the arrow take the
  // paper page's width, margin and overflow.
  assert.doesNotMatch(papers, /\.papers-link-short,\s*(\/\*[\s\S]*?\*\/\s*)?\.paper-note\s*\{/);
});
