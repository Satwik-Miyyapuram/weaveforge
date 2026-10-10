import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { focusFirstControl, focusFirstField } from "../modal";

(globalThis as { document?: unknown }).document ??= { activeElement: null };

/** A panel with one button and no fields; records what got focus. */
function panel() {
  const focused: string[] = [];
  const button = { focus: () => focused.push("button") };
  const root = {
    contains: () => false,
    querySelector: (sel: string) => (sel.includes("button") ? button : null),
    focus: () => focused.push("panel"),
  };
  return { root: root as unknown as HTMLElement, focused };
}

test("a click-opened menu focuses the panel, so no row wears the keyboard ring", () => {
  const { root, focused } = panel();
  focusFirstField(root, { buttons: false });
  assert.deepEqual(focused, ["panel"]);
});

test("a key-opened menu focuses its first row", () => {
  const { root, focused } = panel();
  focusFirstField(root);
  assert.deepEqual(focused, ["button"]);
});

test("an arrow from the panel enters the first row", () => {
  const { root, focused } = panel();
  focusFirstControl(root);
  assert.deepEqual(focused, ["button"]);
});

test("a menu row marked danger is painted in the danger colour", () => {
  const css = readFileSync(fileURLToPath(new URL("../../app/styles/states.css", import.meta.url)), "utf8");
  const rule = css.split("\n").find((l) => l.includes(".card-menu-item") && l.includes("{ color: var(--wf-danger); }"));
  assert.ok(rule, "danger row rule exists");
  assert.match(rule, /:is\([^)]*\.danger\)/);
});

test("drop-down triggers share the button motion, and the select menu has no second open animation", () => {
  const styles = (f: string) => readFileSync(fileURLToPath(new URL(`../../app/styles/${f}`, import.meta.url)), "utf8");
  const states = styles("states.css");
  assert.match(states, /\.custom-select-button:hover:not\(:disabled\) \{ translate: 0 var\(--wf-lift\)/);
  assert.match(states, /\.custom-select-button:is\(:active, \[aria-expanded="true"\]\):not\(:disabled\), [^{]*\.popover-trigger\[aria-expanded="true"\] \{ translate: var\(--wf-press\) var\(--wf-press\); box-shadow: none;/);
  assert.doesNotMatch(styles("forms.css"), /animation: menu-in/);
  assert.doesNotMatch(styles("brutal.css"), /\.filter-select \.custom-select-button\[aria-expanded="true"\] \{\s*transform: var\(--press-t\)/);
});

test("a segmented control is separate chips, with no second frame drawn around them", () => {
  const styles = (f: string) => readFileSync(fileURLToPath(new URL(`../../app/styles/${f}`, import.meta.url)), "utf8");
  assert.doesNotMatch(styles("brutal.css"), /\]\) \.seg \{/);
  assert.match(styles("git.css"), /^\.seg \{ display: inline-flex; gap: 2px; \}$/m);
});

test("the title-bar menu drops from its button at every width and is fitted to the window", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  const sheet = read("../../app/styles/overlays.css").split("\n").find((l) => l.includes("top: auto !important") || /:is\(\.popover-panel/.test(l));
  assert.match(sheet ?? "", /\.popover-panel:not\(\.title-bar-menu\)/);
  const bar = read("../desktop-title-bar.tsx");
  assert.match(bar, /panel\.style\.left = /);
  assert.match(bar, /panel\.style\.maxHeight = /);
});
