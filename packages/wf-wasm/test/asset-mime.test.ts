import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { assetExtension, assetMimeType } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);

before(() => {
  initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });
});

test("svg and unknown extensions are stored as bytes, not as a scripting context", () => {
  assert.equal(assetMimeType("svg"), "application/octet-stream");
  assert.equal(assetMimeType("html"), "application/octet-stream");
  assert.equal(assetMimeType("png"), "image/png");
  assert.equal(assetMimeType("jpeg"), "image/jpeg");
});

test("known image extensions map to their content types", () => {
  assert.equal(assetMimeType("jpg"), "image/jpeg");
  assert.equal(assetMimeType("gif"), "image/gif");
  assert.equal(assetMimeType("webp"), "image/webp");
  assert.equal(assetMimeType("avif"), "image/avif");
});

test("extensions come from the filename, not from a dot elsewhere in the path", () => {
  assert.equal(assetExtension("user-1/page-1/a.PNG"), "png");
  assert.equal(assetExtension("user.1/page-1/noext"), "png");
  assert.equal(assetExtension("a/b/.hidden"), "png");
});
