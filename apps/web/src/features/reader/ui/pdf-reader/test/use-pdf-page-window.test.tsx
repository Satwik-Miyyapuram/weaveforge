import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useRef } from "react";
import { act, create } from "react-test-renderer";
import type { PdfDocument } from "../types";
import { usePdfPageWindow } from "../use-pdf-page-window";

function fakePdf(cleanup: () => Promise<void>): PdfDocument {
  return { cleanup } as unknown as PdfDocument;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Probe(props: {
  pdf: PdfDocument;
  numPages: number;
  evicted: number[];
  released?: boolean;
  renderCalls?: number[];
  root?: HTMLElement;
}) {
  const rootRef = useRef<HTMLElement>(props.root ?? ({} as HTMLElement));
  usePdfPageWindow({
    rootRef,
    pdf: props.pdf,
    numPages: props.numPages,
    released: props.released ?? true,
    renderPage: async (n) => {
      props.renderCalls?.push(n);
    },
    evictPage: (n) => props.evicted.push(n),
    onVisibleChange: () => {},
  });
  return null;
}

test("a released reader frees every page and PDF.js caches, observing nothing", async () => {
  const evicted: number[] = [];
  let cleanups = 0;
  const pdf = fakePdf(async () => {
    cleanups++;
  });
  // No IntersectionObserver in node: the released path must not construct one.
  await act(async () => {
    create(createElement(Probe, { pdf, numPages: 3, evicted }));
  });
  assert.deepEqual(evicted, [1, 2, 3]);
  assert.equal(cleanups, 1);
});

test("a cleanup refused mid-render is swallowed", async () => {
  const evicted: number[] = [];
  const pdf = fakePdf(() => Promise.reject(new Error("render in progress")));
  await act(async () => {
    create(createElement(Probe, { pdf, numPages: 1, evicted }));
  });
  assert.deepEqual(evicted, [1]);
});

test("a render requested while cleanup is still running waits for it to settle", async () => {
  const evicted: number[] = [];
  const renderCalls: number[] = [];
  const cleanup = deferred();
  const pdf = fakePdf(() => cleanup.promise);

  // Capture the window observer's callback (constructed first) to drive a page entering view.
  const observerCallbacks: Array<(entries: unknown[]) => void> = [];
  class FakeIntersectionObserver {
    constructor(cb: (entries: unknown[]) => void) {
      observerCallbacks.push(cb);
    }
    observe() {}
    disconnect() {}
  }
  const previous = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  try {
    let renderer!: ReturnType<typeof create>;
    const root = {
      querySelectorAll: () => [{ dataset: { page: "1" } }],
      getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    } as unknown as HTMLElement;
    const props = { pdf, numPages: 1, evicted, renderCalls, root };
    await act(async () => {
      renderer = create(createElement(Probe, { ...props, released: true }));
    });
    // Screen shown again while pdf.js is still cleaning up.
    await act(async () => {
      renderer.update(createElement(Probe, { ...props, released: false }));
    });
    await act(async () => {
      observerCallbacks[0]!([
        {
          target: { dataset: { page: "1" } },
          isIntersecting: true,
          boundingClientRect: { top: 0, bottom: 10 },
        },
      ]);
    });
    assert.deepEqual(renderCalls, []);

    await act(async () => {
      cleanup.resolve();
      await cleanup.promise;
    });
    assert.deepEqual(renderCalls, [1]);
  } finally {
    globalThis.IntersectionObserver = previous;
  }
});
