/**
 * CRT with reactive motion: a hovered card moves like a button and its shadow
 * stays where it is.
 *
 * Cards used to rise 3px and tilt, carrying their shadow with them. Now a card
 * lifts up and left by the button lift while its shadow grows by the same
 * amount, with no tilt, so the shadow's footprint never moves on the page.
 * Lift and shadow share one fast timing, so they never drift apart mid-animation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f: string) => readFileSync(path.join(app, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const motion = read("styles/motion.css");
const states = read("styles/states.css");

function block(css: string, selector: RegExp): string {
  for (const [, sel = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector.test(sel.trim())) return body;
  }
  return "";
}
const decl = (body: string, prop: string) => body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim();
function hard(shadow: string | undefined) {
  const m = shadow?.match(/^(-?\d+)px (-?\d+)px 0 (.+)$/);
  assert.ok(m, `not a hard shadow: ${shadow}`);
  return { x: Number(m[1]), y: Number(m[2]), colour: m[3] };
}
const px = (v: string | undefined) => Number(v?.match(/^(-?\d+)px$/)?.[1]);

const CARDS = ":is(.entity-card, .paper-card, .dashboard-card, .artifact-card, [data-reactive])";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SEL = `:root[data-theme="crt"][data-motion="reactive"] ${CARDS}`;
// Motion only for people who did not ask the OS for less of it.
const calm = [...motion.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");

test("crt: a lifted card's shadow grows by exactly the button lift, in the same colour", () => {
  const root = block(read("themes/crt.css"), /^\[data-theme="crt"\]$/);
  const lift = block(states, /^:root:root\[data-theme="crt"\]$/);
  const rest = hard(decl(root, "--sh-card"));
  const up = hard(decl(root, "--sh-card-up"));
  assert.equal(up.x, rest.x - px(decl(lift, "--wf-lift-x")));
  assert.equal(up.y, rest.y - px(decl(lift, "--wf-lift")));
  assert.equal(up.colour, rest.colour);
});

test("crt + reactive: a hovered card lifts like a button, raises its shadow and does not tilt", () => {
  const hover = block(calm, new RegExp(`^${esc(SEL)}:hover$`));
  assert.equal(decl(hover, "translate"), "var(--wf-lift-x) var(--wf-lift)");
  assert.equal(decl(hover, "--sh-card"), "var(--sh-card-up)", "the card's own shadow token, so a flat card stays flat");
  assert.equal(decl(hover, "transform"), "none", "no tilt: tilting drags the shadow");
});

test("crt + reactive: a card snaps up fast, lift and shadow on one timing", () => {
  // A big card on the button's 160ms / 4 steps felt sluggish: 80ms in 2 steps.
  const t = decl(block(calm, new RegExp(`^${esc(SEL)}$`)), "transition") ?? "";
  assert.match(t, /translate var\(--dur-fast\) steps\(2, end\)/);
  assert.match(t, /box-shadow var\(--dur-fast\) steps\(2, end\)/);
});

test("crt + reactive: the scroll-in rise leaves translate free, so a half-visible card lifts too", () => {
  // An animation beats :hover. A rise on `translate` pinned the bottom cards
  // in place while their shadow still grew: the shadow jumped.
  const rule = block(motion, new RegExp(`^${esc(`:root[data-theme="crt"][data-motion="reactive"] :is(.entity-card, .paper-card, .dashboard-card, .artifact-card)`)}$`));
  const name = decl(rule, "animation-name");
  assert.ok(name, "crt cards need their own rise");
  const frames = motion.match(new RegExp(String.raw`@keyframes ${name}\s*\{([\s\S]*?)\n\s*\}`))?.[1] ?? "";
  assert.match(frames, /transform:\s*translateY\(10px\)/);
  assert.doesNotMatch(frames, /translate:/);
});
