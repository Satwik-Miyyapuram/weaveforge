import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { OverlayScrollbar } from "../overlay-scrollbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock ResizeObserver and MutationObserver for Node test runner environment
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.MutationObserver === "undefined") {
  (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
    observe() {}
    disconnect() {}
  };
}

function createMockScrollElement(options: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}) {
  const listeners: Record<string, ((e?: unknown) => void)[]> = {};
  const el = {
    scrollTop: options.scrollTop ?? 0,
    scrollHeight: options.scrollHeight ?? 1000,
    clientHeight: options.clientHeight ?? 400,
    addEventListener(event: string, handler: (e?: unknown) => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    removeEventListener(event: string, handler: (e?: unknown) => void) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((h) => h !== handler);
    },
    dispatch(event: string) {
      listeners[event]?.forEach((h) => h());
    },
    scrollTo(options?: { top?: number; behavior?: string }) {
      if (options?.top !== undefined) {
        el.scrollTop = options.top;
      }
    },
  };
  return el as unknown as HTMLElement & { dispatch: (event: string) => void };
}

test("OverlayScrollbar renders null when content fits without overflow", () => {
  const mockEl = createMockScrollElement({
    scrollTop: 0,
    clientHeight: 500,
    scrollHeight: 500, // No overflow
  });
  const scrollRef = { current: mockEl };

  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(OverlayScrollbar, { scrollRef }));
  });

  assert.equal(renderer!.toJSON(), null);
});

test("OverlayScrollbar renders track and thumb when content overflows", () => {
  const mockEl = createMockScrollElement({
    scrollTop: 0,
    clientHeight: 400,
    scrollHeight: 1200, // Overflows
  });
  const scrollRef = { current: mockEl };

  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(OverlayScrollbar, { scrollRef }));
  });

  const json = renderer!.toJSON();
  assert.ok(json !== null);
  const jsonStr = JSON.stringify(json);
  assert.match(jsonStr, /overlay-scrollbar-track/);
  assert.match(jsonStr, /overlay-scrollbar-thumb/);
  assert.match(jsonStr, /"aria-hidden":"true"/);
});

test("OverlayScrollbar becomes visible on scroll event", () => {
  const mockEl = createMockScrollElement({
    scrollTop: 100,
    clientHeight: 400,
    scrollHeight: 1200,
  });
  const scrollRef = { current: mockEl };

  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(OverlayScrollbar, { scrollRef }));
  });

  // Trigger scroll
  act(() => {
    mockEl.dispatch("scroll");
  });

  const jsonStr = JSON.stringify(renderer!.toJSON());
  assert.match(jsonStr, /is-visible/);
});
