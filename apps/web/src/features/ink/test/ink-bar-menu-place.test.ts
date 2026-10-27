/**
 * Every bar drop-down opens the same way: under its button. The palette's dock
 * only moves a list beside the button in focus mode, where the CSS really
 * docks the palette to an edge; elsewhere the bar is a plain row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { barMenuDock, placeBarMenu } from "../ui/ink-bar-menus";

function fakeMenu(dock: string | null, focus: boolean) {
  const palette = { getAttribute: (n: string) => (n === "data-dock" ? dock : null) };
  return {
    closest: (sel: string) => (sel === ".ink-palette" ? palette : sel === ".is-focus" && focus ? {} : null),
  } as unknown as Element;
}

test("a palette docked left counts only in focus mode", () => {
  assert.equal(barMenuDock(fakeMenu("left", false)), "");
  assert.equal(barMenuDock(fakeMenu("left", true)), "left");
  assert.equal(barMenuDock(fakeMenu(null, true)), "");
});

const button = { top: 100, bottom: 130, left: 40, right: 70 };
const view = { lw: 200, lh: 150, vw: 1600, vh: 900 };

test("without a dock the list drops under the button, right-aligned", () => {
  assert.deepEqual(placeBarMenu(button, "", view), { top: 136, left: 8 });
  const far = { top: 100, bottom: 130, left: 800, right: 830 };
  assert.deepEqual(placeBarMenu(far, "", view), { top: 136, left: 630 });
});

test("a left-docked focus palette opens its list beside the button", () => {
  assert.deepEqual(placeBarMenu(button, "left", view), { top: 100, left: 76 });
});
