/**
 * One look and one motion for every button kind (the unified-buttons proposal).
 *
 * The button moves, its shadow never does. Hover lifts the button by
 * (--wf-lift-x, --wf-lift) and grows the shadow by the same amount, so the
 * shadow's spot on the page stays put; press moves the button by the rest
 * offset, exactly onto the shadow. The shadow keeps one colour in every state.
 *
 * Quiet buttons (ghost, icon, red-tint) pop out on hover in every theme, with
 * the same frame and shadow as a normal button. Every control shares one focus
 * ring, the chip's × is red like every close, and the switch's track darkens
 * on press like any pressed button.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const styles = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => readFileSync(path.join(styles, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const states = read("states.css");

/** The declaration block of the first rule whose selector matches. */
function block(css: string, selector: RegExp): string {
  for (const [, sel = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector.test(sel.trim())) return body;
  }
  return "";
}
const decl = (body: string, prop: string) => body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim();
const px = (v: string | undefined) => Number(v?.match(/^(-?\d*\.?\d+)px$/)?.[1] ?? NaN);
/** "3px 3px 0 #2b222b" -> { x: 3, y: 3, colour: "#2b222b" } */
function hard(shadow: string | undefined) {
  const m = shadow?.match(/^(-?\d+)px (-?\d+)px 0 (.+)$/);
  assert.ok(m, `not a hard shadow: ${shadow}`);
  return { x: Number(m[1]), y: Number(m[2]), colour: m[3] };
}
/** CRT's rest shadow reads `var(--sh-sm, <fallback>)`; the fallback matches crt.css. */
const unwrap = (v: string | undefined) => v?.replace(/^var\(--sh-sm, (.+)\)$/, "$1");

test("the sideways lift is a token, zero by default and under reduced motion", () => {
  assert.equal(decl(block(states, /^:root$/), "--wf-lift-x"), "0px");
  const reduced = states.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(reduced, /--wf-lift-x: 0px/);
  assert.match(reduced, /--wf-lift: 0px/);
});

for (const [name, sel, lift, press] of [
  ["CRT", /^:root:root\[data-theme="crt"\]$/, -2, 3],
  ["Brutal", /^:root:root:is\(\[data-theme="brutal"\], \[data-theme="brutal-dark"\]\)$/, -1, 3],
] as const) {
  test(`${name}: hover lifts ${-lift}px off a shadow that stays put; press lands on it`, () => {
    const anchored = block(states, sel);
    assert.equal(px(decl(anchored, "--wf-lift-x")), lift, "sideways lift");
    assert.equal(px(decl(anchored, "--wf-lift")), lift, "upward lift");
    const base = block(states, name === "CRT" ? /^:root\[data-theme="crt"\]$/ : /^:root:is\(\[data-theme="brutal"\], \[data-theme="brutal-dark"\]\)$/);
    const rest = hard(unwrap(decl(base, "--wf-sh-rest")));
    const up = hard(decl(base, "--wf-sh-up"));
    assert.equal(up.x, rest.x - lift, "shadow grows by the lift, sideways");
    assert.equal(up.y, rest.y - lift, "shadow grows by the lift, down");
    assert.equal(up.colour, rest.colour, "one shadow colour in every state");
    assert.equal(px(decl(base, "--wf-press")), press);
    assert.equal(press, rest.x, "press moves the button exactly onto its shadow");
  });
}

test("the anchored lift beats reactive motion, which comes later and sets its own lift", () => {
  const reactive = states.indexOf(':root[data-motion="reactive"] {');
  assert.ok(reactive > 0);
  // Two :root's outrank reactive's one, wherever the block sits.
  assert.match(states, /:root:root\[data-theme="crt"\] \{[^}]*--wf-lift: -2px/);
});

test("CRT's shadow is the ink colour, not the old blue", () => {
  const crt = block(states, /^:root\[data-theme="crt"\]$/);
  assert.equal(decl(crt, "--wf-sh-up"), "5px 5px 0 #2b222b");
  assert.doesNotMatch(states, /#12466e/);
});

test("every hover moves the button sideways too, and every press goes the full way", () => {
  // Cards are not buttons: they keep their own small motion.
  const buttons = states.split("\n").filter((l) => !l.includes(".wf-card")).join("\n");
  assert.doesNotMatch(buttons, /translate: 0 var\(--wf-lift\)/);
  assert.doesNotMatch(buttons, /translate: calc\(var\(--wf-press\) \* \.67\)/);
  assert.ok((states.match(/translate: var\(--wf-lift-x\) var\(--wf-lift\)/g) ?? []).length >= 3);
});

test("quiet buttons pop out on hover with the raised shadow, like every button", () => {
  for (const [, sel = "", body = ""] of states.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/:hover/.test(sel)) assert.doesNotMatch(body, /box-shadow: var\(--wf-sh-rest\)/, sel.slice(0, 120));
  }
});

test("tabs share the focus ring: 3px, 2px outside", () => {
  const tabFocus = block(states, /\.wf-tab:is\(:focus-visible/);
  assert.equal(decl(tabFocus, "outline-offset"), "2px");
});

test("the chip's × is red, and its focus ring goes round the whole chip", () => {
  assert.equal(decl(block(states, /^:root:root \.wf-chip-x$/), "color"), "var(--wf-danger)");
  assert.match(states, /\.wf-chip:has\(> \.wf-chip-x:is\(:focus-visible[^{]*\{[^}]*outline: 3px solid var\(--wf-focus\); outline-offset: 2px/);
  assert.match(states, /\.wf-chip-x:is\(:focus-visible[^{]*\{[^}]*outline: none/);
});

test("the switch is a bare track (no input padding) and its track darkens on press", () => {
  const base = block(states, /^:root:root \.wf-toggle$/);
  assert.equal(decl(base, "padding"), "0");
  assert.equal(decl(base, "width"), "36px");
  assert.match(states, /\.wf-toggle:is\(:active[^{]*\):not\(:disabled\) \{[^}]*background-color: var\(--wf-press-bg\)/);
  assert.match(states, /\.wf-toggle:checked:is\(:active[^{]*\):not\(:disabled\) \{[^}]*background-color: color-mix\(in srgb, var\(--text\) 25%, var\(--accent\)\)/);
});

test("rows and folds have one look", () => {
  assert.match(states, /\.wf-row\[aria-current="true"\] \{[^}]*background-color: var\(--accent-soft\)/);
  assert.match(states, /\.wf-fold svg \{[^}]*rotate: -90deg/);
  assert.match(states, /\.wf-fold\[aria-expanded="true"\] svg \{[^}]*rotate: 0deg/);
  assert.match(states, /\.wf-fold-count \{[^}]*margin-left: auto/);
});

test("CRT's Normal button, back box and filter are cream with the ink shadow, not orange", () => {
  for (const f of ["brutal.css", "record.css"]) {
    const css = read(f);
    for (const [, sel = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/btn|custom-select-button/.test(sel)) assert.doesNotMatch(body, /#f29731/, `${f}: ${sel.trim().slice(0, 100)}`);
    }
    assert.doesNotMatch(css, /--sh-btn-2|--btn-2\b/, f);
  }
  assert.doesNotMatch(read("../themes/crt.css"), /--sh-btn-2|--btn-2\b/, "the orange tokens are gone");
});
