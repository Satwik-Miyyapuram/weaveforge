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
