import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { appHeaders, contentTypeFor, isPageRequest, resolveAppFile } from "../src/app-protocol";

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
  assert.match(headers["content-security-policy"] ?? "", /frame-ancestors 'none'/);
  // Only a document has a policy to carry; a script or image does not.
  assert.equal(appHeaders("text/javascript; charset=utf-8")["content-security-policy"], undefined);
});

/**
 * `connect-src` must allow the Cache API.
 *
 * Pinned because its absence produced a symptom that pointed nowhere near the
 * cause. The reader saw `e.replace is not a function`; the console showed a CSP
 * refusal of `cache://<uuid>`. Transformers.js stores model files in Electron's
 * Cache API, a Cache API lookup is subject to `connect-src`, and a refused one
 * **rejects instead of returning a miss** — so the library's cache layer got a
 * rejection where it expected a `Response` and threw somewhere unrelated. The
 * semantic-search encoder could therefore never load its model.
 */
test("connect-src allows cache:, which the model cache needs", () => {
  const policy = appHeaders("text/html; charset=utf-8")["content-security-policy"] ?? "";
  const connectSrc = /connect-src ([^;]+)/.exec(policy)?.[1] ?? "";
  assert.match(connectSrc, /(^|\s)cache:(\s|$)/, "the Cache API scheme is allowed");
  // The schemes that were already there, so this cannot be a swap.
  for (const scheme of ["'self'", "https:", "wss:"]) {
    assert.match(connectSrc, new RegExp(scheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // And nothing opened up that should not be. The two loopback entries carry a
  // wildcard for the *port* — the local model server and the local API bind an
  // ephemeral one — so a blanket "no wildcard" assertion is wrong; what must not
  // appear is a wildcard standing for a host or a scheme.
  assert.doesNotMatch(connectSrc, /(^|\s)\*(\s|$)/, "no bare wildcard source");
  assert.doesNotMatch(connectSrc, /:\/\*/, "no wildcard host");
  assert.doesNotMatch(connectSrc, /cache:\*/, "the allowed cache scheme is not wildcarded");
});

/**
 * `connect-src` must allow the weights host, which is a different origin.
 *
 * `'self'` is `app://weaveforge`; the encoder's weights come from `app://models`.
 * Without `app:` the page cannot fetch a single model file, and what the reader
 * sees is transformers.js's `Bad gateway error occurred while trying to load
 * file: "app://models/…/config.json"` — which names this app's own proxy, so it
 * sends you to the handler rather than to the policy. This is the second time
 * this exact scheme was forgotten: `apps/web/next.config.mjs` already carries it
 * with a comment saying so.
 */
test("connect-src allows app:, because the weights live on their own host", () => {
  const policy = appHeaders("text/html; charset=utf-8")["content-security-policy"] ?? "";
  const connectSrc = /connect-src ([^;]+)/.exec(policy)?.[1] ?? "";
  assert.match(connectSrc, /(^|\s)app:(\s|$)/, "the app protocol is allowed, not only 'self'");
});

test("a missed page is told apart from a missed asset", () => {
  assert.equal(isPageRequest("app://weaveforge/org/"), true);
  assert.equal(isPageRequest("app://weaveforge/supervision"), true);
  assert.equal(isPageRequest("app://weaveforge/old.html"), true);
  assert.equal(isPageRequest("app://weaveforge/_next/static/gone.js"), false);
  assert.equal(isPageRequest("app://weaveforge/icons/missing.png"), false);
  assert.equal(isPageRequest("not a url"), false);
});
