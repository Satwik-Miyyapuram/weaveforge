import { test } from "node:test";
import assert from "node:assert/strict";
import { WebDavPdfResolver } from "../../src/reader/webdav-pdf-resolver.js";
import {
  buildHtmlSnapshotLocus,
  DEFAULT_PAPER_PDF_BUCKET_POLICY,
  isEpubCfiLocus,
  paperPdfBucketAllowsUpload,
  parseEpubCfi,
  R6_DEFERRALS,
} from "../../src/reader/format-reach.js";

test("WebDavPdfResolver supports metadata path and builds proxy URL", async () => {
  const resolver = new WebDavPdfResolver({
    buildProxiedUrl: (path) => `/api/webdav-proxy?path=${encodeURIComponent(path)}`,
  });
  assert.equal(resolver.supports({ id: "p", metadata: {} }), false);
  assert.equal(resolver.supports({ id: "p", metadata: { webdavPath: "/lib/a.pdf" } }), true);
  const hit = await resolver.resolve({ id: "p", metadata: { webdavPath: "/lib/a.pdf" } });
  assert.equal(hit?.url, "/api/webdav-proxy?path=%2Flib%2Fa.pdf");
});

test("parseEpubCfi and isEpubCfiLocus", () => {
  assert.equal(parseEpubCfi("bad"), null);
  const locus = parseEpubCfi("epubcfi(/6/4[chap01ref]!/4/2/2[intro]/1:0)");
  assert.ok(locus);
  assert.equal(isEpubCfiLocus(locus), true);
  assert.equal(isEpubCfiLocus({ type: "EpubCfiSelector", cfi: "" }), false);
});

test("buildHtmlSnapshotLocus requires https", () => {
  assert.equal(buildHtmlSnapshotLocus({ url: "http://example.com" }), null);
  assert.equal(buildHtmlSnapshotLocus({ url: "https://example.com/a", exact: "hi" })?.exact, "hi");
});

test("paperPdfBucketAllowsUpload respects opt-in quota", () => {
  assert.equal(paperPdfBucketAllowsUpload(DEFAULT_PAPER_PDF_BUCKET_POLICY, 0, 1), false);
  assert.equal(
    paperPdfBucketAllowsUpload({ enabled: true, quotaBytes: 100, tierEviction: true }, 40, 50),
    true,
  );
  assert.equal(
    paperPdfBucketAllowsUpload({ enabled: true, quotaBytes: 100, tierEviction: true }, 60, 50),
    false,
  );
});

test("R6_DEFERRALS lists known unfinished surfaces", () => {
  assert.ok(R6_DEFERRALS.some((d) => d.id === "mobile-reader"));
});
