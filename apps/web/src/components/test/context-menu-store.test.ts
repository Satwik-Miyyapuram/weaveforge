/** The shared right-click menu: open/close state and on-screen placement. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeContextMenu,
  contextMenuState,
  isEditableTarget,
  openContextMenu,
  placeContextMenu,
  subscribeContextMenu,
} from "../context-menu-store";

const item = { id: "a", label: "A" };

test("opening stores the point and items, stops the browser menu, and notifies", () => {
  let prevented = false;
  let calls = 0;
  const off = subscribeContextMenu(() => calls++);
  openContextMenu({ clientX: 5, clientY: 7, preventDefault: () => (prevented = true) }, [item]);
  assert.deepEqual(contextMenuState(), { x: 5, y: 7, items: [item] });
  assert.ok(prevented);
  closeContextMenu();
  assert.equal(contextMenuState(), null);
  assert.equal(calls, 2);
  off();
});

test("no items keeps the browser's own menu", () => {
  let prevented = false;
  openContextMenu({ clientX: 1, clientY: 1, preventDefault: () => (prevented = true) }, []);
  assert.equal(contextMenuState(), null);
  assert.equal(prevented, false);
});

test("closing when nothing is open does not notify", () => {
  let calls = 0;
  const off = subscribeContextMenu(() => calls++);
  closeContextMenu();
  assert.equal(calls, 0);
  off();
});

test("a menu that fits opens at the pointer", () => {
  assert.deepEqual(placeContextMenu(100, 100, 200, 300, 1000, 800), { left: 100, top: 100 });
});

test("a menu near the right or bottom edge flips to the other side", () => {
  assert.deepEqual(placeContextMenu(900, 700, 200, 300, 1000, 800), { left: 700, top: 400 });
});

test("a menu bigger than the room is clamped to the edge pad", () => {
  assert.deepEqual(placeContextMenu(50, 50, 200, 900, 1000, 800), { left: 50, top: 12 });
});

test("outside a DOM nothing counts as editable", () => {
  assert.equal(isEditableTarget(null), false);
});
