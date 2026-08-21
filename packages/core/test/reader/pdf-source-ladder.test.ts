import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePdfSource,
  type IPdfSourceResolver,
  type PdfSourceHit,
  type PdfSourcePaper,
} from "../../src/reader/index.js";

const paper: PdfSourcePaper = { id: "p1", doi: "10.1000/example" };

function fake(
  id: string,
  opts: {
    supports?: boolean;
    hit?: PdfSourceHit | null;
    throw?: boolean;
  } = {},
): IPdfSourceResolver {
  return {
    id,
    supports: () => opts.supports !== false,
    resolve: async () => {
      if (opts.throw) throw new Error(`${id} failed`);
      return opts.hit ?? null;
    },
  };
}

test("resolvePdfSource: first supporting resolver wins", async () => {
  const result = await resolvePdfSource(paper, [
    fake("browser-cache", { hit: { url: "cache://a", contentHash: "h1" } }),
    fake("zotero", { hit: { url: "zotero://b" } }),
  ]);
  assert.deepEqual(result, {
    ok: true,
    hit: { url: "cache://a", contentHash: "h1" },
    resolverId: "browser-cache",
  });
});

test("resolvePdfSource: skips unsupported resolvers", async () => {
  const result = await resolvePdfSource(paper, [
    fake("browser-cache", { supports: false, hit: { url: "cache://a" } }),
    fake("zotero", { hit: { url: "zotero://b" } }),
  ]);
  assert.deepEqual(result, {
    ok: true,
    hit: { url: "zotero://b" },
    resolverId: "zotero",
  });
});

test("resolvePdfSource: throwing resolver does not abort the chain", async () => {
  const result = await resolvePdfSource(paper, [
    fake("zotero", { throw: true }),
    fake("open-access", { hit: { url: "https://oa.example/p.pdf" } }),
  ]);
  assert.deepEqual(result, {
    ok: true,
    hit: { url: "https://oa.example/p.pdf" },
    resolverId: "open-access",
  });
});

test("resolvePdfSource: all fail returns a clear miss", async () => {
  const result = await resolvePdfSource(paper, [
    fake("browser-cache", { hit: null }),
    fake("zotero", { throw: true }),
    fake("server-blob", { supports: false }),
  ]);
  assert.deepEqual(result, { ok: false, reason: "no_source" });
});

test("resolvePdfSource: empty url is treated as a miss", async () => {
  const result = await resolvePdfSource(paper, [
    fake("browser-cache", { hit: { url: "   " } }),
    fake("zotero", { hit: { url: "zotero://ok" } }),
  ]);
  assert.deepEqual(result, {
    ok: true,
    hit: { url: "zotero://ok" },
    resolverId: "zotero",
  });
});

test("resolvePdfSource: trims the winning URL", async () => {
  const result = await resolvePdfSource(paper, [
    fake("open-access", {
      hit: { url: "  https://oa.example/p.pdf  ", contentHash: "  abc  " },
    }),
  ]);
  assert.deepEqual(result, {
    ok: true,
    hit: { url: "https://oa.example/p.pdf", contentHash: "abc" },
    resolverId: "open-access",
  });
});

test("resolvePdfSource: empty resolver chain returns a clear miss", async () => {
  assert.deepEqual(await resolvePdfSource(paper, []), {
    ok: false,
    reason: "no_source",
  });
});

test("resolvePdfSource: reports winning resolver id and preserves caller order", async () => {
  const order: string[] = [];
  const tracking = (id: string, hit: PdfSourceHit | null): IPdfSourceResolver => ({
    id,
    supports: () => true,
    resolve: async () => {
      order.push(id);
      return hit;
    },
  });
  const result = await resolvePdfSource(paper, [
    tracking("browser-cache", null),
    tracking("zotero", null),
    tracking("webdav", null),
    tracking("open-access", null),
    tracking("user-url", { url: "https://user.example/p.pdf" }),
    tracking("server-blob", { url: "blob://paid" }),
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.resolverId, "user-url");
  assert.deepEqual(order, [
    "browser-cache",
    "zotero",
    "webdav",
    "open-access",
    "user-url",
  ]);
});
