/**
 * The paper page's preview leads to the reader whenever the reader has
 * something to open: a PDF with a web link, a PDF saved on this device (one
 * added from disk has no link), or a saved web page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewCache, previewReaderHref, siteOf } from "../application/paper-preview";

const local = "/workspace?locus=p1";

test("a paper with a PDF link keeps its link", () => {
  assert.equal(previewReaderHref("/remote", { kind: "none" }, local), "/remote");
});

test("a PDF saved on this device opens in the reader without a web link", () => {
  assert.equal(previewReaderHref(null, { kind: "pdf", imageUrl: "blob:x" }, local), local);
});

test("a saved web page opens in the reader", () => {
  assert.equal(previewReaderHref(null, { kind: "page", title: "T", site: "example.org" }, local), local);
});

test("with nothing to open there is no link", () => {
  assert.equal(previewReaderHref(null, { kind: "none" }, local), null);
  assert.equal(previewReaderHref(null, { kind: "loading" }, local), null);
});

test("the site is the host without www", () => {
  assert.equal(siteOf("https://www.example.org/post/1"), "example.org");
  assert.equal(siteOf("not a url"), "not a url");
});

test("the preview cache keeps the newest, revoking the picture it drops (25-16)", () => {
  const revoked: string[] = [];
  const cache = new PreviewCache(2, (url) => revoked.push(url));
  cache.remember("a", { kind: "pdf", imageUrl: "blob:a" });
  cache.remember("b", { kind: "page", title: "B", site: "b.org" });
  assert.equal(cache.get("a")?.kind, "pdf"); // a is now the most recent
  cache.remember("c", { kind: "pdf", imageUrl: "blob:c" });
  assert.equal(cache.get("b"), undefined);
  assert.deepEqual(revoked, []); // b had no picture
  cache.remember("d", { kind: "pdf", imageUrl: "blob:d" });
  assert.equal(cache.get("a"), undefined);
  assert.deepEqual(revoked, ["blob:a"]);
});

test("a second preview for the same paper is revoked and the first kept (25-16)", () => {
  const revoked: string[] = [];
  const cache = new PreviewCache(4, (url) => revoked.push(url));
  const first = cache.remember("a", { kind: "pdf", imageUrl: "blob:1" });
  const second = cache.remember("a", { kind: "pdf", imageUrl: "blob:2" });
  assert.deepEqual(first, second);
  assert.deepEqual(second, { kind: "pdf", imageUrl: "blob:1" });
  assert.deepEqual(revoked, ["blob:2"]);
});

test("nothing is remembered for a paper with no preview (25-16)", () => {
  const cache = new PreviewCache(4, () => {});
  assert.deepEqual(cache.remember("a", { kind: "none" }), { kind: "none" });
  assert.equal(cache.get("a"), undefined);
});
