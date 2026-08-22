import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { appHeaders, contentTypeFor, resolveAppFile } from "../src/app-protocol";

/**
 * The rules for turning an `app://` request into a file in the bundle.
 *
 * A made-up bundle rather than a real one: what is being checked is which
 * candidates are tried and which requests are refused, and both are decisions
 * this module makes on its own.
 */
const ROOT = path.join(path.sep, "bundle");

/** A bundle holding the files an export of a few pages would produce. */
const FILES = new Set(
  [
    "index.html",
    "settings/index.html",
    "_next/static/chunk.js",
    "icons/icon-512.png",
  ].map((file) => path.join(ROOT, ...file.split("/"))),
);

const exists = (file: string) => FILES.has(file);
const resolve = (url: string) => resolveAppFile(ROOT, url, exists);

test("the root is the export's index", () => {
  assert.equal(resolve("app://weaveforge/"), path.join(ROOT, "index.html"));
});

test("a directory request lands on its index", () => {
  assert.equal(resolve("app://weaveforge/settings/"), path.join(ROOT, "settings", "index.html"));
});

test("the same page without the trailing slash still lands", () => {
  assert.equal(resolve("app://weaveforge/settings"), path.join(ROOT, "settings", "index.html"));
});

test("an asset is served as itself", () => {
  assert.equal(resolve("app://weaveforge/_next/static/chunk.js"), path.join(ROOT, "_next", "static", "chunk.js"));
});

test("an escaped path is decoded before it is looked up", () => {
  assert.equal(resolve("app://weaveforge/icons%2Ficon-512.png"), path.join(ROOT, "icons", "icon-512.png"));
});

test("a page the bundle does not have is a miss, not a guess", () => {
  assert.equal(resolve("app://weaveforge/nowhere"), null);
});

test("traversal out of the bundle is refused", () => {
  // Refused because it leaves the root, not because of how it is spelled: the
  // check is on where the path ends up.
  assert.equal(resolve("app://weaveforge/../../etc/passwd"), null);
  assert.equal(resolve("app://weaveforge/settings/../../../secrets"), null);
});

test("a malformed escape is a miss rather than a throw", () => {
  assert.equal(resolve("app://weaveforge/%E0%A4%A"), null);
});

test("content types cover the export's own files, and unknown means bytes", () => {
  assert.equal(contentTypeFor("/bundle/index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("/bundle/app.CSS"), "text/css; charset=utf-8");
  assert.equal(contentTypeFor("/bundle/pglite.wasm"), "application/wasm");
  assert.equal(contentTypeFor("/bundle/whatever.zzz"), "application/octet-stream");
});

test("every response carries the headers the server used to send", () => {
  const headers = appHeaders("text/html; charset=utf-8");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["content-type"], "text/html; charset=utf-8");
});
