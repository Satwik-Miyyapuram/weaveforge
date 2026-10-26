/** Text tokens meet WCAG AA (4.5:1) on the surfaces they sit on (design D08). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string) => readFileSync(at(path), "utf8");

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string | undefined, b: string | undefined): number {
  assert.ok(a && b, "missing colour token");
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** First hex value of each custom property in a theme file. */
function tokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] ??= m[2]!;
  return out;
}
/** Declarations of the rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const i = css.indexOf(`\n${selector} {`);
  assert.ok(i >= 0, `missing rule ${selector}`);
  return css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
}

const themeFiles = readdirSync(at("../themes/")).filter((f) => !["common.css", "index.css"].includes(f));
// Brutal and CRT draw the active nav item with their own rule (styles/brutal.css).
const ownActive = new Set(["brutal.css", "brutal-dark.css", "crt.css"]);

test("muted text is AA on bg, surface and surface2 in every theme (DA-34)", () => {
  assert.ok(themeFiles.length >= 15);
  for (const file of themeFiles) {
    const t = tokens(read(`../themes/${file}`));
    for (const ground of ["bg", "surface", "surface2"]) {
      const ratio = contrast(t.muted, t[ground]);
      assert.ok(ratio >= 4.5, `${file} muted on ${ground} is ${ratio.toFixed(2)}`);
    }
  }
});

test("the active nav item is AA in every theme (DA-34)", () => {
  for (const file of themeFiles) {
    if (ownActive.has(file)) continue;
    const t = tokens(read(`../themes/${file}`));
    const ratio = contrast(t["active-fg"] ?? t.accent, t["active-bg"] ?? t["accent-soft"]);
    assert.ok(ratio >= 4.5, `${file} active nav is ${ratio.toFixed(2)}`);
  }
});

test("card snippets use muted, not faint (DA-30)", () => {
  assert.match(rule(read("../styles/papers.css"), ":is(.papers-screen, .vault-screen) .paper-card .entity-card-snippet"), /color:\s*var\(--muted\);/);
});

test("the share expiry hint reads as a hint, not a warning (DA-36)", () => {
  assert.match(rule(read("../styles/settings.css"), ".share-link-expiry-hint"), /color:\s*var\(--muted\);/);
});

test("explorer section count uses muted (DA-35)", () => {
  const css = read("../styles/editor-workspace.css");
  for (const sel of [".explorer-section-count"]) assert.match(rule(css, sel), /color:\s*var\(--muted\);/);
});

test("the graph settings badge uses the text-on-accent token (DA-35)", () => {
  assert.match(rule(read("../styles/graph.css"), ".graph-stage-settings .graph-settings-count,\n.graph-settings-count"), /color:\s*var\(--accent-fg\);/);
});

// Brutal and CRT set their own ink: plain text colour, underlined.
const ownInk = new Set(["brutal.css", "brutal-dark.css", "crt.css"]);

test("link ink is AA on bg, surface and surface2 in every theme (DA-31, D05)", () => {
  for (const file of themeFiles) {
    if (ownInk.has(file)) continue;
    const t = tokens(read(`../themes/${file}`));
    const ink = t["accent-ink"] ?? t.accent;
    for (const ground of ["bg", "surface", "surface2"]) {
      const ratio = contrast(ink, t[ground]);
      assert.ok(ratio >= 4.5, `${file} link on ${ground} is ${ratio.toFixed(2)}`);
    }
  }
});

test("every link reads one token, set once (D05)", () => {
  assert.match(read("../themes/common.css"), /--link:\s*var\(--accent-ink\);/);
  assert.match(rule(read("../styles/base.css"), "a"), /color:\s*var\(--link\);/);
  assert.match(rule(read("../styles/markdown.css"), ".markdown a"), /color:\s*var\(--link\);/);
});
