import assert from "node:assert/strict";
import { test } from "node:test";
import { createPdfObjectUrl, pdfObjectUrlBytes, revokePdfObjectUrl } from "../application/parts";

test("a registered object URL answers its bytes until revoked", async () => {
  const revoked: string[] = [];
  const url = createPdfObjectUrl(new Blob([new Uint8Array([37, 80, 68, 70])]), () => "blob:x/1");
  assert.equal(url, "blob:x/1");
  assert.deepEqual([...(await pdfObjectUrlBytes(url))!], [37, 80, 68, 70]);
  revokePdfObjectUrl(url, (u) => revoked.push(u));
  assert.deepEqual(revoked, ["blob:x/1"]);
  assert.equal(await pdfObjectUrlBytes(url), null);
});

test("an object URL made elsewhere has no bytes here", async () => {
  assert.equal(await pdfObjectUrlBytes("blob:x/other"), null);
});
