/**
 * Menus close when the pointer goes down outside them, even on a surface that
 * cancels the pointer's default (the ink and PDF pen canvases do, and that
 * suppresses the `mousedown` these hooks used to wait for).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, useRef } from "react";
import { act, create } from "react-test-renderer";

import { useDismissOnOutside } from "../use-dismiss-on-outside";
import { useBarMenu } from "../../../features/ink/ui/ink-bar-menus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (event: unknown) => void;
type Entry = { type: string; fn: Listener; capture: boolean };
const listeners: Entry[] = [];
const isCapture = (options: unknown) =>
  options === true || (typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true);
(globalThis as { document?: unknown }).document = {
  addEventListener(type: string, fn: Listener, options?: unknown) {
    listeners.push({ type, fn, capture: isCapture(options) });
  },
  removeEventListener(type: string, fn: Listener, options?: unknown) {
    const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === isCapture(options));
    if (i >= 0) listeners.splice(i, 1);
  },
};

const insideNode = {};
const outsideNode = {};
const inside = { contains: (node: unknown) => node === insideNode } as unknown as HTMLElement;

function fire(type: string, target: unknown) {
  for (const l of listeners.filter((entry) => entry.type === type)) l.fn({ target, key: "", stopPropagation() {} });
}

test("useDismissOnOutside listens for pointerdown in the capture phase", () => {
  listeners.length = 0;
  let dismissed = 0;
  function Probe() {
    const ref = useRef<HTMLElement | null>(inside);
    useDismissOnOutside(true, () => void dismissed++, ref);
    return null;
  }
  let r!: ReturnType<typeof create>;
  act(() => {
    r = create(createElement(Probe));
  });
  const down = listeners.find((l) => l.type === "pointerdown");
  assert.ok(down, "pointerdown listener installed");
  assert.equal(down.capture, true);
  assert.equal(listeners.some((l) => l.type === "mousedown"), false);

  fire("pointerdown", insideNode);
  assert.equal(dismissed, 0, "a press inside keeps it open");
  fire("pointerdown", outsideNode);
  assert.equal(dismissed, 1, "a press outside closes it");

  act(() => r.unmount());
  assert.equal(listeners.some((l) => l.type === "pointerdown"), false, "listener removed on unmount");
});

test("useDismissOnOutside installs nothing while closed", () => {
  listeners.length = 0;
  function Probe() {
    const ref = useRef<HTMLElement | null>(inside);
    useDismissOnOutside(false, () => {}, ref);
    return null;
  }
  act(() => {
    create(createElement(Probe));
  });
  assert.equal(listeners.length, 0);
});

test("useBarMenu closes on a capture-phase pointerdown outside", () => {
  listeners.length = 0;
  let menu!: ReturnType<typeof useBarMenu>;
  function Probe() {
    menu = useBarMenu();
    return null;
  }
  let r!: ReturnType<typeof create>;
  act(() => {
    r = create(createElement(Probe));
  });
  act(() => menu.setOpen(true));
  const down = listeners.find((l) => l.type === "pointerdown");
  assert.ok(down, "pointerdown listener installed");
  assert.equal(down.capture, true);
  act(() => fire("pointerdown", outsideNode));
  assert.equal(menu.open, false);
  assert.equal(listeners.some((l) => l.type === "pointerdown"), false, "removed once closed");
  act(() => r.unmount());
});
