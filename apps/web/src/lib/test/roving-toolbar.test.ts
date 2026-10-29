/**
 * A toolbar is one tab stop; the arrows walk its controls (design D18,
 * DA-120). The skip link is the first thing Tab reaches, ahead of the
 * desktop title bar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderHook } from "./react-harness";
import { rovingItems, rovingMove, syncTabStops, useRovingToolbar } from "../hooks/use-roving-toolbar";

interface Fake {
  tabIndex: number;
  focused: boolean;
  focus(): void;
  closest(): unknown;
  getClientRects(): { length: number };
}

/** A toolbar root holding `n` controls; `hidden` and `inPopup` mark some out. */
function toolbar(n: number, opts: { hidden?: number[]; inPopup?: number[] } = {}) {
  const root = {} as { querySelectorAll(): Fake[] };
  const items: Fake[] = Array.from({ length: n }, (_, i) => ({
    tabIndex: 0,
    focused: false,
    focus() {
      for (const it of items) it.focused = false;
      items[i]!.focused = true;
    },
    closest: () => (opts.inPopup?.includes(i) ? {} : root),
    getClientRects: () => ({ length: opts.hidden?.includes(i) ? 0 : 1 }),
  }));
  root.querySelectorAll = () => items;
  return { root: root as unknown as HTMLElement, items };
}

test("only the controls the toolbar itself shows are walked", () => {
  const { root, items } = toolbar(5, { hidden: [1], inPopup: [3] });
  assert.deepEqual(rovingItems(root), [items[0], items[2], items[4]]);
});

test("one control is the tab stop; the rest are reached by arrows", () => {
  const { root, items } = toolbar(4);
  syncTabStops(root, items[2] as unknown as HTMLElement);
  assert.deepEqual(items.map((it) => it.tabIndex), [-1, -1, 0, -1]);
});

test("the first control is the tab stop until another is used", () => {
  const { root, items } = toolbar(3);
  syncTabStops(root, null);
  assert.deepEqual(items.map((it) => it.tabIndex), [0, -1, -1]);
});

test("a tab stop that went away hands over to the first control", () => {
  const { root, items } = toolbar(3, { hidden: [0] });
  syncTabStops(root, items[0] as unknown as HTMLElement);
  assert.deepEqual(items.map((it) => it.tabIndex), [-1, 0, -1]);
});

test("arrows step and wrap; Home and End jump to the ends", () => {
  const { root, items } = toolbar(4);
  const at = (i: number) => items[i] as unknown as HTMLElement;
  assert.equal(rovingMove(root, at(0), "ArrowRight"), at(1));
  assert.equal(rovingMove(root, at(0), "ArrowDown"), at(1));
  assert.equal(rovingMove(root, at(3), "ArrowRight"), at(0));
  assert.equal(rovingMove(root, at(0), "ArrowLeft"), at(3));
  assert.equal(rovingMove(root, at(2), "ArrowUp"), at(1));
  assert.equal(rovingMove(root, at(2), "Home"), at(0));
  assert.equal(rovingMove(root, at(1), "End"), at(3));
});

test("other keys, and keys from inside an open menu, are left alone", () => {
  const { root, items } = toolbar(3, { inPopup: [2] });
  const at = (i: number) => items[i] as unknown as HTMLElement;
  assert.equal(rovingMove(root, at(0), "Enter"), null);
  assert.equal(rovingMove(root, at(2), "ArrowRight"), null);
});

test("an arrow a control already used, or a text field's arrow, does not move focus", async () => {
  const { root, items } = toolbar(3);
  const h = await renderHook(() => useRovingToolbar(), undefined);
  (h.current.ref as { current: unknown }).current = root;
  const press = (target: unknown, defaultPrevented = false) => {
    let prevented = defaultPrevented;
    h.current.onKeyDown({
      key: "ArrowRight", target, defaultPrevented,
      preventDefault: () => void (prevented = true),
    } as never);
    return prevented;
  };
  press(Object.assign(items[0]!, { tagName: "BUTTON" }), true);
  assert.equal(items[1]!.focused, false, "the dock button's own arrow moved focus");
  press(Object.assign(items[0]!, { tagName: "INPUT" }));
  assert.equal(items[1]!.focused, false, "a text field lost its caret arrow");
  assert.equal(press(Object.assign(items[0]!, { tagName: "BUTTON" })), true);
  assert.equal(items[1]!.focused, true);
  await h.unmount();
});

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the ink bar and the reader's annotate pill are roving toolbars", () => {
  assert.match(read("../../features/ink/ui/ink-bar.tsx"), /\{\.\.\.roving\}/);
  assert.match(read("../../features/reader/ui/pdf-reader/pdf-reader.tsx"), /role="toolbar" aria-label="Annotate" \{\.\.\.roving\}/);
});

test("the skip link comes before the desktop title bar", () => {
  const layout = read("../../app/layout.tsx");
  const skip = layout.indexOf('className="skip-link"');
  assert.ok(skip > 0, "layout has no skip link");
  assert.ok(skip < layout.indexOf("<DesktopTitleBar />"));
  assert.doesNotMatch(read("../../app/app-shell.tsx"), /skip-link/);
});
