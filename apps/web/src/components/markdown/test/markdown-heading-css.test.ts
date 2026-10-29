import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Markdown headings render as their own level (`#` is h1 … `######` is h6), so
 * every stylesheet that sizes rendered markdown must cover all six levels, or a
 * `#` heading falls back to the browser's 2em h1.
 */
type Rule = { selectors: string[]; body: string };

function rules(file: string): Rule[] {
  const css = readFileSync(fileURLToPath(new URL(`../../../app/styles/${file}`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  for (const block of css.split("}")) {
    const open = block.indexOf("{");
    if (open < 0) continue;
    const head = block.slice(0, open).trim();
    out.push({ selectors: head.split(",").map((s) => s.trim().replace(/\s+/g, " ")), body: block.slice(open + 1) });
  }
  return out;
}

function declares(file: string, selector: string, property: string): boolean {
  return rules(file).some((r) => r.selectors.includes(selector) && new RegExp(`(^|[;\\s])${property}\\s*:`).test(r.body));
}

const LEVELS = [1, 2, 3, 4, 5, 6];

test("markdown.css gives every heading level a size and a margin", () => {
  for (const level of LEVELS) {
    assert.ok(declares("markdown.css", `.markdown h${level}`, "font-size"), `.markdown h${level} sets no font-size`);
    assert.ok(declares("markdown.css", `.markdown h${level}`, "margin"), `.markdown h${level} sets no margin`);
  }
});

test("no heading level is larger than the level above it at a 14px base", () => {
  const BASE = 14;
  const px = (level: number) => {
    const value = rules("markdown.css")
      .filter((r) => r.selectors.includes(`.markdown h${level}`))
      .map((r) => /font-size:\s*([^;]+)/.exec(r.body)?.[1]?.trim())
      .find(Boolean);
    const m = /^([\d.]+)(em|px)$/.exec(value ?? "");
    assert.ok(m, `.markdown h${level} font-size ${value} is not an em or px size`);
    return m[2] === "em" ? Number(m[1]) * BASE : Number(m[1]);
  };
  for (const level of [2, 3, 4, 5, 6]) {
    assert.ok(px(level) <= px(level - 1), `h${level} (${px(level)}px) is larger than h${level - 1} (${px(level - 1)}px)`);
  }
  assert.ok(px(1) > px(6), "the levels do not step down at all");
});

test("the AI review screen's title rule does not reach a # heading in a proposal", () => {
  const css = rules("ai-review.css");
  assert.ok(css.every((r) => !r.selectors.includes(".ai-review-screen h1")), "an unscoped .ai-review-screen h1 rule remains");
  assert.ok(css.some((r) => r.selectors.includes(".ai-review-screen .screen-head h1")), "the title rule is not scoped to the screen head");
});

test("no stylesheet still styles the retired h6.md-hN classes", () => {
  for (const file of ["markdown.css", "sections.css", "editor-workspace.css"]) {
    assert.ok(rules(file).every((r) => r.selectors.every((s) => !/\.md-h[456]\b/.test(s))), `${file} styles .md-hN`);
  }
});

test("the section-note preview compacts all six levels", () => {
  for (const level of LEVELS) {
    assert.ok(declares("sections.css", `.section-note-md-preview .markdown h${level}`, "font-size"), `preview h${level}`);
  }
});

test("the ink sheet underlay sizes and zeroes the margins of all six levels", () => {
  const css = rules("editor-workspace.css");
  const zeroed = css.find((r) => r.selectors.some((s) => s.startsWith(".ink-sheet .ink-sheet-text-underlay :is(")));
  assert.ok(zeroed, "the underlay margin reset is missing");
  for (const level of LEVELS) {
    assert.match(zeroed.selectors.join(","), new RegExp(`\\bh${level}\\b`), `margin reset skips h${level}`);
    assert.ok(declares("editor-workspace.css", `.ink-sheet-text-underlay h${level}`, "font-size"), `underlay h${level}`);
  }
});

test("the ink text layer's own title rule does not reach a #### heading in its markdown", () => {
  const css = rules("editor-workspace.css");
  assert.ok(css.some((r) => r.selectors.includes(".ink-text > h4")), "title rule is not scoped to the direct child");
  assert.ok(css.every((r) => !r.selectors.includes(".ink-text h4")), "an unscoped .ink-text h4 rule remains");
});
