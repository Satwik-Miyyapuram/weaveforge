/**
 * The text layer sits over the reader's scroller, so it must not blend
 * (.agents/ui-layers.md): `mix-blend-mode` gave every page's text layer its
 * own composited layer (about 14 MB of GPU memory on an 11-page paper). The
 * paper is always white, where 25% normal blending reads the same as 25%
 * multiply, so the selection swatch keeps its colour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/reader.css", import.meta.url)), "utf8");

function rule(selector: string): string {
  for (const block of css.split("}")) {
    const open = block.indexOf("{");
    if (open < 0) continue;
    const head = block.slice(0, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (head === selector) return block.slice(open + 1).replace(/\/\*[\s\S]*?\*\//g, "");
  }
  assert.fail(`no rule for ${selector}`);
}

test("the text layer does not blend over the scroller", () => {
  const body = rule(".pdf-reader-textlayer");
  assert.doesNotMatch(body, /mix-blend-mode/);
  assert.match(body, /opacity:\s*0\.25/);
});

test("the paper the layer sits on is white", () => {
  assert.match(css, /--pdf-paper:\s*var\(--white\)/);
});
