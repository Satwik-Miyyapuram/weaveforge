import { test } from "node:test";
import assert from "node:assert/strict";
import { act, create } from "react-test-renderer";

import { Popover } from "../popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("an open popover keeps its observer and listeners across parent renders (13-09)", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, ResizeObserver: g.ResizeObserver };
  let observers = 0;
  let listens = 0;
  const target = { addEventListener: () => { listens += 1; }, removeEventListener() {} };
  g.window = { ...target, innerWidth: 1000, innerHeight: 800 };
  g.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  g.ResizeObserver = class { constructor() { observers += 1; } observe() {} disconnect() {} };
  const node = {
    getBoundingClientRect: () => ({ left: 10, right: 60, top: 10, bottom: 40 }),
    offsetWidth: 100, offsetHeight: 50,
    focus() {}, contains: () => false, querySelector: () => null,
  };
  try {
    const view = (n: number) => <Popover label="Filter">{() => `rows ${n}`}</Popover>;
    let r: ReturnType<typeof create>;
    act(() => { r = create(view(0), { createNodeMock: () => node }); });
    act(() => { r!.root.findByType("button").props.onClick({ detail: 1 }); });
    const opened = { observers, listens };
    assert.equal(opened.observers, 1);
    act(() => { r!.update(view(1)); });
    act(() => { r!.update(view(2)); });
    assert.deepEqual({ observers, listens }, opened, "parent renders do not re-subscribe");
    act(() => { r!.unmount(); });
  } finally {
    Object.assign(g, saved);
  }
});
