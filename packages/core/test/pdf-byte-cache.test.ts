import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPdfByteCache, PdfByteCacheResolver } from "../src/reader/pdf-byte-cache.js";
import { resolvePdfSource } from "../src/reader/pdf-source-ladder.js";

test("InMemoryPdfByteCache evicts least-recently-used entries", async () => {
  const cache = new InMemoryPdfByteCache(2);
  await cache.set("a", new ArrayBuffer(1));
  await cache.set("b", new ArrayBuffer(1));
  assert.equal(await cache.size(), 2);
  // Touch a so b is oldest
  assert.ok(await cache.get("a"));
  await cache.set("c", new ArrayBuffer(1));
  assert.equal(await cache.get("b"), null);
  assert.ok(await cache.get("a"));
  assert.ok(await cache.get("c"));
});

test("InMemoryPdfByteCache rejects invalid capacity", () => {
  assert.throws(() => new InMemoryPdfByteCache(0));
});

test("PdfByteCacheResolver returns cache:// hits for the ladder", async () => {
  const cache = new InMemoryPdfByteCache(4);
  await cache.set("paper-1", new ArrayBuffer(8));
  const resolver = new PdfByteCacheResolver(cache);
  const hit = await resolvePdfSource({ id: "paper-1" }, [resolver]);
  assert.equal(hit.ok, true);
  if (hit.ok) {
    assert.equal(hit.resolverId, "browser-cache");
    assert.equal(hit.hit.url, "cache://paper-1");
  }
  const miss = await resolvePdfSource({ id: "missing" }, [resolver]);
  assert.equal(miss.ok, false);
});
