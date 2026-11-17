/**
 * The layout breakpoint has three steps: phone below 600px, mobile from 600px
 * to just under 900px, and desktop from 900px. The 900px step is the one every
 * existing caller relies on, so these cases pin both edges.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, create } from "react-test-renderer";

import { breakpointFor, useLayoutBreakpoint, type LayoutBreakpoint } from "../use-layout-breakpoint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A window whose width the test sets; its media queries answer from that width. */
function fakeWindow(startWidth: number) {
  let width = startWidth;
  const listeners = new Map<string, Set<() => void>>();
  const matchMedia = (query: string) => {
    const min = /\(min-width: (\d+)px\)/.exec(query);
    if (!min) throw new Error(`unexpected media query ${query}`);
    const threshold = Number(min[1]);
    return {
      get matches() {
        return width >= threshold;
      },
      addEventListener(_type: string, fn: () => void) {
        if (!listeners.has(query)) listeners.set(query, new Set());
        listeners.get(query)!.add(fn);
      },
      removeEventListener(_type: string, fn: () => void) {
        listeners.get(query)?.delete(fn);
      },
    };
  };
  return {
    matchMedia,
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    /** Resize, then tell every query whose answer may have changed. */
    resize(next: number) {
      width = next;
      for (const set of listeners.values()) for (const fn of set) fn();
    },
  };
}

function withWindow<T>(win: unknown, body: () => T): T {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  try {
    return body();
  } finally {
    if (had) (globalThis as { window?: unknown }).window = previous;
    else delete (globalThis as { window?: unknown }).window;
  }
}

type Seen = { breakpoint: LayoutBreakpoint; navEnter: string | null };

function Probe({ onRender }: { onRender: (seen: Seen) => void }) {
  const { breakpoint, navEnter } = useLayoutBreakpoint();
  onRender({ breakpoint, navEnter });
  return null;
}

test("the pure step rule: desktop at 900px, mobile below it, phone below 600px", () => {
  assert.equal(breakpointFor(true, true), "desktop");
  assert.equal(breakpointFor(false, true), "mobile");
  assert.equal(breakpointFor(false, false), "phone");
});

test("the queries sit exactly at 600px and 900px", async () => {
  const { DESKTOP_BREAKPOINT_PX, PHONE_BREAKPOINT_PX } = await import("../../parts");
  assert.equal(PHONE_BREAKPOINT_PX, 600);
  assert.equal(DESKTOP_BREAKPOINT_PX, 900);
});

for (const [width, expected] of [
  [599, "phone"],
  [600, "mobile"],
  [899, "mobile"],
  [900, "desktop"],
] as const) {
  test(`a ${width}px window reads as ${expected}`, () => {
    const win = fakeWindow(width);
    withWindow(win, () => {
      let seen!: Seen;
      act(() => {
        create(createElement(Probe, { onRender: (s) => (seen = s) }));
      });
      assert.equal(seen.breakpoint, expected);
    });
  });
}

test("crossing 600px from above changes the step without an entrance animation", () => {
  const win = fakeWindow(620);
  withWindow(win, () => {
    const renders: Seen[] = [];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(createElement(Probe, { onRender: (s) => renders.push(s) }));
    });
    act(() => win.resize(599));
    assert.equal(renders.at(-1)?.breakpoint, "phone");
    assert.equal(renders.at(-1)?.navEnter, null);
    act(() => win.resize(600));
    assert.equal(renders.at(-1)?.breakpoint, "mobile");
    assert.equal(renders.at(-1)?.navEnter, null);
    act(() => tree.unmount());
  });
});

test("crossing 900px still fires the entrance animation, in each direction", () => {
  const win = fakeWindow(800);
  withWindow(win, () => {
    const renders: Seen[] = [];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(createElement(Probe, { onRender: (s) => renders.push(s) }));
    });
    assert.equal(renders.at(-1)?.breakpoint, "mobile");
    act(() => win.resize(900));
    assert.deepEqual(renders.at(-1), { breakpoint: "desktop", navEnter: "slide" });
    act(() => win.resize(700));
    assert.deepEqual(renders.at(-1), { breakpoint: "mobile", navEnter: "rise" });
    act(() => tree.unmount());
  });
});

test("with no window (server render) the first paint reads as desktop", () => {
  withWindow(undefined, () => {
    let seen: Seen | undefined;
    renderToString(createElement(Probe, { onRender: (s) => (seen = s) }));
    assert.equal(seen?.breakpoint, "desktop" satisfies LayoutBreakpoint);
  });
});
