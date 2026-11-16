import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { PdfDocument } from "../types";
import { usePdfPageWindow } from "../use-pdf-page-window";

function fakePdf(cleanup: () => Promise<void>): PdfDocument {
  return { cleanup } as unknown as PdfDocument;
}

function Probe(props: { pdf: PdfDocument; numPages: number; evicted: number[] }) {
  usePdfPageWindow({
    rootRef: { current: {} as HTMLElement },
    pdf: props.pdf,
    numPages: props.numPages,
    released: true,
    renderPage: async () => {},
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
