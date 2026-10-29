/**
 * Every ink bar menu closes, then runs, the item chosen: one `choose` from
 * `useBarMenu` instead of a copy per menu (20-08).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { useBarMenu } from "../ui/ink-bar-menus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

function harness() {
  let menu!: ReturnType<typeof useBarMenu>;
  function Probe() {
    menu = useBarMenu();
    return null;
  }
  act(() => {
    create(createElement(Probe));
  });
  return () => menu;
}

test("choose closes the menu, then runs the item", () => {
  const menu = harness();
  act(() => menu().setOpen(true));
  assert.equal(menu().open, true);
  const order: string[] = [];
  const run = () => order.push(menu().open ? "ran-open" : "ran");
  act(() => menu().choose(run)());
  assert.equal(menu().open, false);
  assert.deepEqual(order, ["ran-open"]);
});

test("choose on a closed menu still runs the item once", () => {
  const menu = harness();
  let runs = 0;
  act(() => menu().choose(() => void runs++)());
  assert.equal(runs, 1);
  assert.equal(menu().open, false);
});
