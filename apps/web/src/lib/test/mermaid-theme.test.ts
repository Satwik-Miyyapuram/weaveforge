import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { themePeleSvg } from "../mermaid-render";

const webRoot = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(webRoot, relative), "utf8");

/** pele's SVG as it comes back from renderAsync: every colour is a var() with a hard-coded fallback. */
const PELE_SVG =
  '<svg style="--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#1f1f1f);--_s:var(--pele-surface,#f3f3f3);--_c:var(--pele-accent,#5b7bd5)">' +
  '<rect fill="var(--_bg)"/><rect fill="var(--_s)" stroke="var(--pele-border,#8a8a8a)"/></svg>';

test("pele's fallback colours become theme tokens, so no chart falls back to white", () => {
  const themed = themePeleSvg(PELE_SVG);

  assert.doesNotMatch(themed, /#fff\b|#ffffff\b|white/i, "no hard-coded white");
  assert.match(themed, /var\(--pele-bg,var\(--surface\)\)/);
  assert.match(themed, /var\(--pele-fg,var\(--ink\)\)/);
  assert.match(themed, /var\(--pele-surface,var\(--surface-alt\)\)/);
  assert.match(themed, /var\(--pele-border,var\(--line\)\)/);
});

test("the .md-mermaid colour block names theme tokens only", () => {
  const css = read("src/app/styles/markdown.css");
  const block = /^\.md-mermaid \{([^}]*)\}/m.exec(css);
  assert.ok(block, "the .md-mermaid rule exists");
  assert.match(block[1]!, /--pele-bg: var\(--surface\)/);
  assert.doesNotMatch(block[1]!, /#[0-9a-fA-F]{3,6}\b|rgba?\(|white/i);
});

test("light and dark themes both define the surface the chart background uses", () => {
  for (const theme of ["light", "dark", "brutal-dark", "crt"]) {
    assert.match(read(`src/app/themes/${theme}.css`), /--surface:/, `${theme} defines --surface`);
  }
});
