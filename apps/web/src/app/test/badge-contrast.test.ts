/**
 * The count badges in the sidebar and the account menu sit on the accent. The
 * sidebar's used `--on-accent`, a token no theme defines, so its digits fell
 * back to body ink: dark on crt's blue at about 2.8:1. The account icon's
 * count was in crt's pixel face at weight 600, which that face only has as a
 * smeared faux bold. Both now use the accent's own text colour and, in the
 * brutal themes, the reading face.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(dir(rel), "utf8");
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at));
};

test("both badges draw their digits in the accent's own text colour", () => {
  assert.match(rule(read("../styles/nav.css"), ".nav-badge"), /color:\s*var\(--accent-fg\)/);
  assert.match(rule(read("../styles/overlays.css"), ".popover-badge"), /color:\s*var\(--accent-fg\)/);
});

test("no style reads the undefined --on-accent token", () => {
  for (const f of readdirSync(dir("../styles")).filter((n) => n.endsWith(".css"))) {
    assert.doesNotMatch(read(`../styles/${f}`), /var\(--on-accent\)/, f);
  }
});

test("in the brutal themes the badges use the reading face, not the pixel face", () => {
  const css = read("../styles/brutal.css");
  assert.match(
    css,
    /:root:is\(\[data-theme="brutal"\], \[data-theme="brutal-dark"\], \[data-theme="crt"\]\) :is\(\.nav-badge, \.popover-badge\) \{[^}]*font-family:\s*var\(--font\)/,
  );
});
