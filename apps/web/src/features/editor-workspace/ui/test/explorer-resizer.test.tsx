/**
 * The explorer's right edge drags, steps by keyboard and resets on double-click;
 * the width it lands on survives a reload on this device.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { EXPLORER_WIDTH_STEP, ExplorerResizer } from "../explorer-resizer";
import {
  EXPLORER_WIDTH_DEFAULT,
  EXPLORER_WIDTH_MAX,
  EXPLORER_WIDTH_MIN,
  clampExplorerWidth,
  readExplorerWidth,
  writeExplorerWidth,
} from "../../application/parts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(width: number) {
  const seen: number[] = [];
  const saved: number[] = [];
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(
      createElement(ExplorerResizer, {
        width,
        onWidth: (w: number) => seen.push(w),
        onCommit: (w: number) => saved.push(w),
      }),
    );
  });
  const handle = root.root.findByProps({ role: "separator" }) as ReactTestInstance;
  return { seen, saved, handle };
}

function pointer(type: string, clientX: number): Event {
  return Object.assign(new Event(type), { clientX, pointerId: 1 });
}

test("the edge is an accessible vertical separator carrying its width", () => {
  const { handle } = mount(300);
  assert.equal(handle.props["aria-orientation"], "vertical");
  assert.equal(handle.props["aria-valuenow"], 300);
  assert.equal(handle.props["aria-valuemin"], EXPLORER_WIDTH_MIN);
  assert.equal(handle.props["aria-valuemax"], EXPLORER_WIDTH_MAX);
  assert.equal(handle.props.tabIndex, 0);
});

test("dragging the edge follows the pointer from where it was grabbed", () => {
  const win = new EventTarget();
  (globalThis as { window?: unknown }).window = win;
  try {
    const { seen, saved, handle } = mount(300);
    act(() => {
      handle.props.onPointerDown({
        clientX: 500,
        pointerId: 1,
        preventDefault() {},
        currentTarget: { setPointerCapture() {} },
      });
    });
    win.dispatchEvent(pointer("pointermove", 540));
    win.dispatchEvent(pointer("pointermove", 400));
    assert.deepEqual(saved, [], "nothing is saved while the pointer moves");
    win.dispatchEvent(pointer("pointerup", 400));
    win.dispatchEvent(pointer("pointermove", 9999));
    win.dispatchEvent(pointer("pointerup", 9999));
    assert.deepEqual(seen, [340, 200]);
    assert.deepEqual(saved, [200], "saved once, on release, with the last width");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("dragging past either bound clamps", () => {
  const win = new EventTarget();
  (globalThis as { window?: unknown }).window = win;
  try {
    const { seen, saved, handle } = mount(300);
    act(() => {
      handle.props.onPointerDown({
        clientX: 300,
        pointerId: 1,
        preventDefault() {},
        currentTarget: { setPointerCapture() {} },
      });
    });
    win.dispatchEvent(pointer("pointermove", 0));
    win.dispatchEvent(pointer("pointermove", 5000));
    win.dispatchEvent(pointer("pointercancel", 0));
    assert.deepEqual(seen, [EXPLORER_WIDTH_MIN, EXPLORER_WIDTH_MAX]);
    assert.deepEqual(saved, [EXPLORER_WIDTH_MAX], "a cancelled drag saves where it ended");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("arrow keys step the width, Home and End go to the bounds; other keys do nothing", () => {
  const { seen, saved, handle } = mount(300);
  const key = (k: string) => {
    let prevented = false;
    handle.props.onKeyDown({ key: k, preventDefault: () => (prevented = true) });
    return prevented;
  };
  assert.equal(key("ArrowRight"), true);
  assert.equal(key("ArrowLeft"), true);
  assert.equal(key("Home"), true);
  assert.equal(key("End"), true);
  assert.equal(key("a"), false);
  assert.deepEqual(seen, [
    300 + EXPLORER_WIDTH_STEP,
    300 - EXPLORER_WIDTH_STEP,
    EXPLORER_WIDTH_MIN,
    EXPLORER_WIDTH_MAX,
  ]);
  assert.deepEqual(saved, seen, "each key press saves at once");
});

test("a click without a move saves nothing", () => {
  const win = new EventTarget();
  (globalThis as { window?: unknown }).window = win;
  try {
    const { saved, handle } = mount(300);
    act(() => {
      handle.props.onPointerDown({
        clientX: 300,
        pointerId: 1,
        preventDefault() {},
        currentTarget: { setPointerCapture() {} },
      });
    });
    win.dispatchEvent(pointer("pointerup", 300));
    assert.deepEqual(saved, []);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("double-click resets to the default width", () => {
  const { seen, saved, handle } = mount(512);
  handle.props.onDoubleClick();
  assert.deepEqual(seen, [EXPLORER_WIDTH_DEFAULT]);
  assert.deepEqual(saved, [EXPLORER_WIDTH_DEFAULT]);
});

test("clamp keeps whole pixels inside the bounds", () => {
  assert.equal(clampExplorerWidth(10), EXPLORER_WIDTH_MIN);
  assert.equal(clampExplorerWidth(10_000), EXPLORER_WIDTH_MAX);
  assert.equal(clampExplorerWidth(300.6), 301);
  assert.equal(clampExplorerWidth(Number.NaN), EXPLORER_WIDTH_DEFAULT);
});

function memoryStore(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

test("the width persists per device and a bad record falls back to the default", () => {
  const store = memoryStore();
  assert.equal(readExplorerWidth(store), EXPLORER_WIDTH_DEFAULT, "nothing saved yet");
  writeExplorerWidth(store, 420);
  assert.equal(readExplorerWidth(store), 420);
  store.setItem("weaveforge.explorer.width", "garbage");
  assert.equal(readExplorerWidth(store), EXPLORER_WIDTH_DEFAULT);
  store.setItem("weaveforge.explorer.width", "99999");
  assert.equal(readExplorerWidth(store), EXPLORER_WIDTH_MAX, "an old out-of-range record is clamped");
  assert.equal(readExplorerWidth(undefined), EXPLORER_WIDTH_DEFAULT);
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as unknown as Storage;
  assert.equal(readExplorerWidth(throwing), EXPLORER_WIDTH_DEFAULT);
  writeExplorerWidth(throwing, 300); // must not throw
});
