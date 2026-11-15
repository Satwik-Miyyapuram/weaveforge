/**
 * Two bars that grew: the reader's own bar wrapped into three lanes in a
 * narrow window instead of folding into More like the Editor's, and the phone
 * dock stood 87px tall.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (file: string) => readFileSync(path.join(src, file), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(css: string, selector: string): string {
  for (const [, sel = "", body = ""] of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel.trim() === selector) return body;
  }
  return "";
}

test("the reader screen puts its bar in the folding document toolbar", () => {
  const screen = read("features/reader/ui/reader-screen.tsx");
  assert.match(screen, /<DocumentToolbar[\s\S]*<PaperPdfPane[\s\S]*<\/DocumentToolbar>/);
});

test("the reader's Focus stays in the document toolbar, at its right end", () => {
  const css = read("app/styles/editor-workspace.css");
  assert.match(rule(css, ".document-toolbar .workspace-toolbar-doc .pdf-reader-focus-btn"), /display: inline-flex/);
});

test("the phone dock is compact", () => {
  const css = read("app/styles/nav.css");
  assert.match(rule(css, ":root:root .nav .wf-nav"), /padding: 4px 2px/);
  assert.match(rule(css, ".nav"), /padding: 4px/);
});
