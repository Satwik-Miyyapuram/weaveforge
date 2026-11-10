import test, { before } from "node:test";
import assert from "node:assert/strict";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { PDF_MAGIC_WINDOW } from "../application/pdf-response-rules";

before(loadTestCore);

/** What both PDF proxies, the hosted one and the shell's, take for a PDF. */

test("a PDF or an unlabelled binary is a PDF content type, parameters and case aside", () => {
  for (const type of ["application/pdf", "Application/PDF", "application/pdf; charset=binary", " application/octet-stream "]) {
    assert.equal(typedCore().isPdfContentType(type), true, type);
  }
});

test("anything else, or no type at all, is not", () => {
  for (const type of [null, "", "text/html", "application/pdfx", "application/x-pdf-landing"]) {
    assert.equal(typedCore().isPdfContentType(type), false, String(type));
  }
});

test("the PDF magic counts anywhere inside the window, and not past it", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const hasPdfMagic = (bytes: Uint8Array) => typedCore().hasPdfMagic(bytes);
  assert.equal(hasPdfMagic(enc("%PDF-1.7")), true);
  assert.equal(hasPdfMagic(enc(`${" ".repeat(100)}%PDF-1.4`)), true);
  assert.equal(hasPdfMagic(enc(`${" ".repeat(PDF_MAGIC_WINDOW)}%PDF-1.4`)), false);
  assert.equal(hasPdfMagic(enc("<!doctype html>")), false);
  assert.equal(hasPdfMagic(new Uint8Array()), false);
});
