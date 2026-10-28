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

test("a link is one colour in the source editor and in preview (D05)", () => {
  const markdown = read("../styles/markdown.css");
  assert.match(rule(markdown, ".wikilink"), /color:\s*var\(--link\);/);
  assert.match(rule(markdown, ".wikilink--unresolved:hover"), /color:\s*var\(--link\);/);
  assert.match(read("../../lib/markdown-cm-syntax.ts"), /tag: t\.link, color: "var\(--link\)"/);
});

/** Relative luminance of `oklch(L C h)`, through OKLab to linear sRGB. */
export function oklchLuminance(value: string): number {
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(value);
  assert.ok(m, `not an oklch colour: ${value}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  const h = (Number(m[4]) * Math.PI) / 180;
  const [a, b] = [Number(m[3]) * Math.cos(h), Number(m[3]) * Math.sin(h)];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

test("the oklch reader turns known colours into their sRGB luminance (D00)", () => {
  assert.ok(Math.abs(oklchLuminance("oklch(1 0 0)") - 1) < 1e-3, "white");
  assert.ok(Math.abs(oklchLuminance("oklch(0 0 0)")) < 1e-6, "black");
  // #ff0000 is oklch(62.8% 0.2577 29.23); its luminance is 0.2126.
  assert.ok(Math.abs(oklchLuminance("oklch(62.8% 0.2577 29.23)") - luminance("#ff0000")) < 2e-3, "red");
  assert.ok(Math.abs(oklchLuminance("oklch(0.5 0 0)") - luminance("#636363")) < 2e-3, "mid grey");
});

test("card text is AA on every Confetti card tint (D00, T6)", () => {
  for (const file of ["confetti-light.css", "confetti-dark.css"]) {
    const css = read(`../themes/${file}`);
    const t = tokens(css);
    const tints = [...css.matchAll(/--(confetti-\d-bg):\s*(oklch\([^)]*\))/g)];
    assert.equal(tints.length, 6, `${file} tints`);
    for (const [, name, value = ""] of tints) {
      const ground = oklchLuminance(value);
      // --ink is --text (common.css); a link without its own ink uses the accent.
      for (const [ink, hex] of [["text", t.text], ["muted", t.muted], ["link", t["accent-ink"] ?? t.accent]] as const) {
        assert.ok(hex, `${file} has no hex for ${ink}`);
        const fg = luminance(hex);
        const ratio = (Math.max(fg, ground) + 0.05) / (Math.min(fg, ground) + 0.05);
        assert.ok(ratio >= 4.5, `${file} ${ink} on ${name} is ${ratio.toFixed(2)}`);
      }
    }
  }
});
