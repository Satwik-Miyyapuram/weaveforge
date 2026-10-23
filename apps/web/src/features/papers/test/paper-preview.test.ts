/**
 * The paper page's preview leads to the reader whenever the reader has
 * something to open: a PDF with a web link, a PDF saved on this device (one
 * added from disk has no link), or a saved web page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewReaderHref, siteOf } from "../application/paper-preview";

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
