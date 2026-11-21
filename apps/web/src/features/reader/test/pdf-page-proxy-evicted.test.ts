/**
 * A page fetched for a render that went stale is not kept (P2-201).
 *
 * `renderPage` put the page from `await pdf.getPage` into the proxy cache even
 * when `evictPage` removed the page during the wait, so a page off screen kept
 * its pdf.js resources until the document closed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { holdPageProxy } from "../ui/pdf-reader/page-proxy";

function page() {
  const p = { cleaned: 0, cleanup: () => { p.cleaned += 1; } };
  return p;
}

test("a page evicted while it loaded is not cached, and is cleaned up", async () => {
  const proxies = new Map<number, ReturnType<typeof page>>();
  const fresh = page();
  let stale = false;
  let resolve!: (p: typeof fresh) => void;
  const held = holdPageProxy(proxies, 3, () => new Promise((r) => { resolve = r; }), () => stale);

  stale = true; // evictPage ran during the wait
  resolve(fresh);

  assert.equal(await held, null);
  assert.equal(proxies.has(3), false, "the evicted page was cached");
  assert.equal(fresh.cleaned, 1, "the evicted page kept its resources");
});

test("a page still wanted is cached and returned", async () => {
  const proxies = new Map<number, ReturnType<typeof page>>();
  const fresh = page();
  assert.equal(await holdPageProxy(proxies, 3, async () => fresh, () => false), fresh);
  assert.equal(proxies.get(3), fresh);
  assert.equal(fresh.cleaned, 0);
});

test("a cached page is reused without a fetch, and not cleaned when the render is stale", async () => {
  const cached = page();
  const proxies = new Map([[3, cached]]);
  let fetched = 0;
  const fetch = async () => { fetched += 1; return page(); };
  assert.equal(await holdPageProxy(proxies, 3, fetch, () => false), cached);
  assert.equal(await holdPageProxy(proxies, 3, fetch, () => true), null);
  assert.equal(fetched, 0);
  assert.equal(proxies.get(3), cached, "a newer render may be using the cached page");
  assert.equal(cached.cleaned, 0);
});
