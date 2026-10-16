/**
 * The shared half of the image-ref plumbing.
 *
 * Every surface — vault notes, paper notes, report sections — finds its own
 * refs through `imagePathsInBody` and differs only in the prefix. The pattern
 * is assembled at runtime, which is exactly the kind of code that fails
 * silently: a regex that matches nothing returns an empty list, and an empty
 * list of assets looks like a note with no images rather than a bug. So each
 * prefix is asserted here, and so is the escaping.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  imagePathsInBody,
  markdownImage,
  materializeBlobImages,
  normalizeMarkdownImageSyntax,
} from "../../src/index.js";

const body = (prefix: string) => `Body text.\n\n![](${prefix}user-1/p1/diagram.png)\n\n![a fig](${prefix}user-1/p1/fig.webp)`;

for (const prefix of ["vault:", "paperimg:", "reportimg:"]) {
  test(`imagePathsInBody finds ${prefix} refs, with and without alt text`, () => {
    assert.deepEqual(imagePathsInBody(body(prefix), prefix, normalizeMarkdownImageSyntax), [
      "user-1/p1/diagram.png",
      "user-1/p1/fig.webp",
    ]);
  });

  test(`imagePathsInBody ignores refs that are not ${prefix}`, () => {
    assert.deepEqual(imagePathsInBody("![](https://example.com/x.png)", prefix, normalizeMarkdownImageSyntax), []);
  });
}

test("a path is reported once however often it is referenced", () => {
  const twice = "![](vault:a/b.png) and again ![](vault:a/b.png)";
  assert.deepEqual(imagePathsInBody(twice, "vault:", normalizeMarkdownImageSyntax), ["a/b.png"]);
});

test("a ref wrapped across lines is still found", () => {
  const wrapped = "![]( vault:a/b.png )";
  assert.deepEqual(imagePathsInBody(wrapped, "vault:", normalizeMarkdownImageSyntax), ["a/b.png"]);
});

test("materializeBlobImages uploads each blob ref and rewrites it, keeping the alt text", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, blob: async () => new Blob(["x"], { type: "image/webp" }) })) as never;
  try {
    const out = await materializeBlobImages(
      "![a diagram](blob:http://x/1)",
      "p1",
      async (ownerId, _blob, ext) => `user-1/${ownerId}/new.${ext}`,
      "paperimg:",
      normalizeMarkdownImageSyntax,
    );
    assert.equal(out, markdownImage("paperimg:user-1/p1/new.webp", "a diagram"));
  } finally {
    globalThis.fetch = original;
  }
});

test("a stale blob URL keeps its original ref rather than vanishing from the body", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("stale");
  }) as never;
  try {
    const out = await materializeBlobImages(
      "![](blob:http://x/1)",
      "p1",
      async () => "unused",
      "paperimg:",
      normalizeMarkdownImageSyntax,
    );
    assert.equal(out, "![](blob:http://x/1)");
  } finally {
    globalThis.fetch = original;
  }
});

test("normalizeMarkdownImageSyntax stays linear on unclosed image syntax", () => {
  for (const unit of ["![\\", "![](blob:", "![](http://"]) {
    const started = performance.now();
    normalizeMarkdownImageSyntax(unit.repeat(50_000));
    assert.ok(performance.now() - started < 500, `slow on repeated ${unit}`);
  }
  assert.equal(normalizeMarkdownImageSyntax("![](foo![x]( vault:a.png )"), "![](foo![x](vault:a.png)");
});

test("image-ref scanning stays linear on unclosed refs", async () => {
  const { fromRelativeBlobLinks, relativeAssetPaths, toRelativeBlobLinks } = await import("../../src/workspace/blob-links.js");
  const resolver = { resolve: () => null };
  for (const s of ["![".repeat(50_000), "![](vault:!".repeat(50_000), `${"![](assets/notes/x".repeat(50_000)})`]) {
    const t = performance.now();
    toRelativeBlobLinks(s, "a.md");
    fromRelativeBlobLinks(s, resolver);
    relativeAssetPaths(s);
    imagePathsInBody(s, "vault:", (b) => b);
    assert.ok(performance.now() - t < 1000, `slow on ${s.slice(0, 20)}`);
  }
  assert.deepEqual(relativeAssetPaths("![](assets/notes/x![a](../assets/report/r.png)"), [{ scope: "notes", path: "x![a](../assets/report/r.png" }]);
});
