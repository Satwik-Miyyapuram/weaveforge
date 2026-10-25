/**
 * The vault's pasted-image upload goes through core's one materialise path
 * (01-14, xhelp-15). These pin what the vault writes, so a second copy that
 * drifts from core cannot come back unnoticed.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { markdownImage } from "@weaveforge/core";

import { materializeBlobImagesInBody } from "../lib/materialize-blob-images";

const original = globalThis.fetch;
const upload = async (pageId: string, _blob: Blob, ext: string) => `user-1/${pageId}/new.${ext}`;

beforeEach(() => {
  globalThis.fetch = (async () => ({ ok: true, blob: async () => new Blob(["x"], { type: "image/png" }) })) as never;
});

afterEach(() => {
  globalThis.fetch = original;
});

test("a pasted blob ref becomes a vault: ref, keeping its alt text", async () => {
  const { body, uploadError } = await materializeBlobImagesInBody("see ![a fig](blob:http://x/1) here", "p1", upload);
  assert.equal(body, `see ${markdownImage("vault:user-1/p1/new.png", "a fig")} here`);
  assert.equal(uploadError, undefined);
});

test("an empty alt is written as core writes it everywhere else", async () => {
  const { body } = await materializeBlobImagesInBody("![](blob:http://x/1)", "p1", upload);
  assert.equal(body, markdownImage("vault:user-1/p1/new.png", "image"));
});

test("replacement patterns in the alt text are written literally", async () => {
  for (const alt of ["cost $& $$", "before $` after $'"]) {
    const { body } = await materializeBlobImagesInBody(`![${alt}](blob:http://x/1)`, "p1", upload);
    assert.equal(body, markdownImage("vault:user-1/p1/new.png", alt), alt);
  }
});

test("LaTeX beside the image is left as written", async () => {
  const text = "$$\\frac{a}{b}$$ and $x^2$ ![f](blob:http://x/1)";
  const { body } = await materializeBlobImagesInBody(text, "p1", upload);
  assert.equal(body, `$$\\frac{a}{b}$$ and $x^2$ ${markdownImage("vault:user-1/p1/new.png", "f")}`);
});

test("a failed upload is reported, not swallowed (34-16)", async () => {
  const { body, uploadError } = await materializeBlobImagesInBody("![](blob:http://x/1)", "p1", async () => {
    throw new Error("quota exceeded");
  });
  assert.equal(body, "![](blob:http://x/1)");
  assert.match(String(uploadError?.message), /quota exceeded/);
});

// xlog-13: a partial failure saves what uploaded, keeps the rest, and counts them.
test("some uploads failing: the rest are rewritten and the failures counted", async () => {
  let n = 0;
  const { body, uploadError } = await materializeBlobImagesInBody(
    "![a](blob:http://x/1) ![b](blob:http://x/2) ![c](blob:http://x/3)",
    "p1",
    async (pageId, _blob, ext) => {
      n += 1;
      if (n !== 2) throw new Error(`quota exceeded ${n}`);
      return `user-1/${pageId}/new.${ext}`;
    },
  );
  assert.equal(body, `![a](blob:http://x/1) ${markdownImage("vault:user-1/p1/new.png", "b")} ![c](blob:http://x/3)`);
  assert.equal(uploadError?.message, "2 images could not be uploaded: quota exceeded 1");
});

test("a stale blob URL is kept quietly, not reported as an upload failure", async () => {
  globalThis.fetch = (async () => ({ ok: false })) as never;
  const { body, uploadError } = await materializeBlobImagesInBody("![](blob:http://x/gone)", "p1", upload);
  assert.equal(body, "![](blob:http://x/gone)");
  assert.equal(uploadError, undefined);
});
