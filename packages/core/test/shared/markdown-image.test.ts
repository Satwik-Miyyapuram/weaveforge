import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeMarkdownAltText,
  imageAltFromFilename,
  imageExtensionForMime,
  markdownImage,
} from "../../src/shared/markdown-image.js";
import { vaultImageMarkdown } from "../../src/features/vault/domain/vault-page.js";

test("a bracket in the alt text cannot end the label early", () => {
  // A screenshot named "figure [2].png" used to produce ![figure [2].png](…),
  // and the link stopped being a link.
  assert.equal(markdownImage("vault:a/b.png", "figure [2]"), "![figure \\[2\\]](vault:a/b.png)");
  assert.equal(markdownImage("vault:a/b.png", "a\\b"), "![a\\\\b](vault:a/b.png)");
});

test("the vault builder escapes too, not only the other two", () => {
  assert.equal(vaultImageMarkdown("u/p/f.png", "figure [2]"), "![figure \\[2\\]](vault:u/p/f.png)");
});

test("a multiline or empty alt text becomes something usable", () => {
  assert.equal(escapeMarkdownAltText("two\nlines   here"), "two lines here");
  assert.equal(escapeMarkdownAltText("   "), "image");
  assert.equal(escapeMarkdownAltText(""), "image");
});

test("an alt text is derived from the file name, not copied from it", () => {
  assert.equal(imageAltFromFilename("loss-curve.png"), "loss curve");
  assert.equal(imageAltFromFilename("Screen_Shot_2026.jpeg"), "Screen Shot 2026");
  assert.equal(imageAltFromFilename("no-extension"), "no extension");
  // What a browser calls a clipboard bitmap is a placeholder, not a description.
  assert.equal(imageAltFromFilename("image.png"), "image");
  assert.equal(imageAltFromFilename(undefined), "image");
  assert.equal(imageAltFromFilename(""), "image");
});

test("extensions follow the blob, with png as the fallback", () => {
  assert.equal(imageExtensionForMime("image/jpeg"), "jpeg");
  assert.equal(imageExtensionForMime("image/webp"), "webp");
  assert.equal(imageExtensionForMime("image/gif"), "gif");
  assert.equal(imageExtensionForMime("image/avif"), "avif");
  assert.equal(imageExtensionForMime("application/octet-stream"), "png");
});
