import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { PlanWidgetTheme } from "../plan-widget-theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a theme frame still queued at unmount is cancelled, and bursts share one frame (13-13)", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  const frames = new Map<number, () => void>();
  let nextId = 0;
  const listeners: Record<string, () => void> = {};
  g.window = {
    weaveforge: { fetchTitle() {}, setPlanWidgetTheme() {} },
    addEventListener: (event: string, handler: () => void) => { listeners[event] = handler; },
    removeEventListener: (event: string) => { delete listeners[event]; },
  };
  g.requestAnimationFrame = (cb: () => void) => { frames.set(++nextId, cb); return nextId; };
  g.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  try {
    let tree: ReturnType<typeof create> | undefined;
    act(() => { tree = create(createElement(PlanWidgetTheme)); });
    assert.equal(frames.size, 1, "first paint queued");
    listeners[THEME_CHANGE_EVENT]!();
    listeners[THEME_CHANGE_EVENT]!();
    assert.equal(frames.size, 1, "a theme change replaces the queued frame");
    act(() => tree!.unmount());
    assert.equal(frames.size, 0, "nothing runs after unmount");
    assert.equal(listeners[THEME_CHANGE_EVENT], undefined);
  } finally {
    g.window = saved.window;
    g.requestAnimationFrame = saved.raf;
    g.cancelAnimationFrame = saved.caf;
  }
});
