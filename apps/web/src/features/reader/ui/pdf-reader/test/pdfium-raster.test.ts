/**
 * PDFium raster behind `wf:pdfEngine`: flag parsing, rotation mapping, lazy WASM
 * load with retry, and real rendering of a tiny generated PDF.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  loadPdfium,
  openPdfiumDocument,
  pdfiumRotate,
  readPdfEngine,
} from "../pdfium-raster";

const wasmLoader = async () => {
  const b = readFileSync(createRequire(import.meta.url).resolve("@embedpdf/pdfium/pdfium.wasm"));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

test("readPdfEngine defaults to pdfjs", () => {
  assert.equal(readPdfEngine(undefined), "pdfjs");
  assert.equal(readPdfEngine({ getItem: () => null }), "pdfjs");
  assert.equal(readPdfEngine({ getItem: () => "pdfium" }), "pdfium");
  for (const v of ["PDFium", "pdfjs", ""]) {
    assert.equal(readPdfEngine({ getItem: () => v }), "pdfjs", v);
  }
  assert.equal(
    readPdfEngine({
      getItem: () => {
        throw new Error("denied");
      },
    }),
    "pdfjs",
  );
});

test("pdfiumRotate maps degrees to quarter turns", () => {
  assert.equal(pdfiumRotate(0), 0);
  assert.equal(pdfiumRotate(90), 1);
  assert.equal(pdfiumRotate(180), 2);
  assert.equal(pdfiumRotate(270), 3);
  assert.equal(pdfiumRotate(360), 0);
  assert.equal(pdfiumRotate(-90), 3);
  assert.equal(pdfiumRotate(450), 1);
});

// Must be the first test that touches loadPdfium: it checks the failed-load retry.
test("loadPdfium retries after a failed load", async () => {
  await assert.rejects(loadPdfium(() => Promise.reject(new Error("offline"))), /offline/);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const content = "0 0 0 rg 0 0 50 50 re f";
const pdf =
  `%PDF-1.4\n` +
  `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
  `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
  `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Contents 4 0 R>>endobj\n` +
  `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n` +
  `trailer<</Root 1 0 R/Size 5>>\n%%EOF\n`;
const pdfBytes = new TextEncoder().encode(pdf);

const px = (pixels: Uint8ClampedArray, x: number, y: number) =>
  Array.from(pixels.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4));

test("PDFium renders the page at rotation 0", async () => {
  const m = await loadPdfium(wasmLoader);
  const doc = openPdfiumDocument(m, pdfBytes);
  assert.ok(doc);
  try {
    const pixels = doc.renderPage(0, 100, 100, 0);
    assert.equal(pixels.length, 40000);
    assert.deepEqual(px(pixels, 10, 90), [0, 0, 0, 255]);
    assert.deepEqual(px(pixels, 90, 10), [255, 255, 255, 255]);
  } finally {
    doc.close();
  }
});

test("PDFium renders the page rotated 90 degrees", async () => {
  const m = await loadPdfium(wasmLoader);
  const doc = openPdfiumDocument(m, pdfBytes);
  assert.ok(doc);
  try {
    const pixels = doc.renderPage(0, 100, 100, 90);
    assert.deepEqual(px(pixels, 10, 10), [0, 0, 0, 255]);
    assert.deepEqual(px(pixels, 90, 90), [255, 255, 255, 255]);
  } finally {
    doc.close();
  }
});

test("openPdfiumDocument returns null for non-PDF bytes", async () => {
  const m = await loadPdfium(wasmLoader);
  assert.equal(openPdfiumDocument(m, new TextEncoder().encode("not a pdf")), null);
});

test("close is idempotent and renderPage after close throws", async () => {
  const m = await loadPdfium(wasmLoader);
  const doc = openPdfiumDocument(m, pdfBytes);
  assert.ok(doc);
  doc.close();
  assert.doesNotThrow(() => doc.close());
  assert.throws(() => doc.renderPage(0, 100, 100, 0), /closed/);
});
