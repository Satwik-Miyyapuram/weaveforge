/**
 * The reader's toolbar is one lane when it fits and wraps into a second when
 * it does not. It used to scroll sideways, which hid the Focus button off the
 * right edge. Selected tools and the bar's buttons carry no shadow, the pages
 * none either, and the reader draws the note's own page and zoom pills.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const reader = read("../../../app/styles/reader.css");
const workspace = read("../../../app/styles/editor-workspace.css");
const states = read("../../../app/styles/states.css");

/** Every `selector { body }` pair, including the ones inside @media and @container. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1]!.trim(), body: m[2]! });
  }
  return out;
}

test("the reader's bars wrap into lanes and never scroll sideways", () => {
  const bars = rules(reader).filter((r) => /\.pdf-reader-(tools|chrome)/.test(r.selector));
  assert.ok(bars.length > 0);
  for (const r of bars) {
    assert.doesNotMatch(r.body, /overflow-x:\s*(auto|scroll)/, r.selector);
    assert.doesNotMatch(r.body, /flex-wrap:\s*nowrap/, r.selector);
  }
  const chrome = rules(reader).find((r) => r.selector === ".pdf-reader-chrome")!;
  assert.match(chrome.body, /flex-wrap:\s*wrap/);
  for (const selector of [".pdf-reader-tools", ".pdf-reader-chrome .ink-bar"]) {
    const own = rules(reader).filter((r) => r.selector === selector);
    assert.ok(own.length > 0, selector);
    for (const r of own) assert.doesNotMatch(r.body, /overflow-x|flex-wrap:\s*nowrap/, selector);
  }
});

test("Focus is always the last control, at the right end", () => {
  const focus = rules(reader).find((r) => r.selector === ".pdf-reader-focus-btn")!;
  assert.match(focus.body, /margin-left:\s*auto/);
  const tools = rules(reader).find((r) => r.selector === ".pdf-reader-tools")!;
  // The tools row follows the ink bar and takes the rest of its lane, so the
  // button's auto margin pins it to the right edge.
  assert.match(tools.body, /flex:\s*1 1 auto/);
  assert.match(tools.body, /order:\s*2/);
});

test("a selected tool and the bar's controls carry no shadow", () => {
  // A pressed tool is the catalogue's wf-tool, which never draws a shadow.
  assert.doesNotMatch(workspace, /\.ink-tool\[aria-pressed/);
  for (const r of rules(states).filter((x) => x.selector.includes(".wf-tool"))) assert.doesNotMatch(r.body, /box-shadow:\s*var/, r.selector);
  const flat = rules(reader).find((r) => r.selector.startsWith(":root:root:root") && r.selector.includes(".pdf-reader-chrome"));
  assert.ok(flat, "a rule that flattens the reader's bar");
  assert.match(flat.body, /box-shadow:\s*none/);
});

test("the pages and their writing strip carry no shadow", () => {
  for (const selector of [".pdf-reader-page", ".pdf-reader-page-margin"]) {
    const own = rules(reader).filter((r) => r.selector === selector);
    assert.ok(own.length > 0, selector);
    for (const r of own) assert.doesNotMatch(r.body, /box-shadow/, selector);
  }
});

test("the reader's pages are the note's page pill, in the one bar, not its own copy", () => {
  const pdf = read("../ui/pdf-reader/pdf-reader.tsx");
  const bar = read("../../ink/ui/ink-bar.tsx");
  assert.match(pdf, /<InkBar\b[\s\S]*?\bpages=/);
  assert.doesNotMatch(pdf, /<PagePill\b/);
  assert.match(bar, /<PagePill\b/);
  assert.doesNotMatch(pdf, /className="ink-page-pill/);
  assert.doesNotMatch(bar, /className="ink-page-pill/);
});

test("outline entries read left to right and wrap rather than run off", () => {
  const entry = rules(reader).find((r) => r.selector === ".pdf-reader-outline .wf-link")!;
  assert.ok(entry);
  assert.match(entry.body, /text-align:\s*left/);
  assert.match(entry.body, /white-space:\s*normal/);
  assert.match(entry.body, /overflow-wrap:\s*anywhere/);
});
