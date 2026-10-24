import { test } from "node:test";
import assert from "node:assert/strict";
import type { IBlobFetcher, ICurrentUserProvider } from "@weaveforge/core";
import { PaperImageStore } from "../infrastructure/paper-image-store";

/** Browser bits `makeThumbnail` needs, so a thumbnail is actually made. */
function stubCanvas() {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, createImageBitmap: g.createImageBitmap };
  g.window = {};
  g.createImageBitmap = async () => ({ width: 1280, height: 640, close: () => undefined });
  g.document = {
    createElement: () => ({
      getContext: () => ({ drawImage: () => undefined }),
      toBlob: (cb: (b: Blob) => void) => cb(new Blob(["thumb"], { type: "image/webp" })),
    }),
  };
  return () => Object.assign(g, saved);
}

const session = { requireUserId: async () => "u1", getCurrentUserId: async () => "u1" } as unknown as ICurrentUserProvider;

function blobs(failThumb: boolean) {
  const uploaded: string[] = [];
  const fetcher = {
    upload: async (_bucket: string, path: string) => {
      if (failThumb && path.endsWith(".thumb.webp")) throw new Error("quota");
      uploaded.push(path);
    },
  } as unknown as IBlobFetcher;
  return { fetcher, uploaded };
}

test("a thumbnail is stored beside the full image", async () => {
  const restore = stubCanvas();
  try {
    const { fetcher, uploaded } = blobs(false);
    const path = await new PaperImageStore(fetcher, session).upload("p1", new Blob(["img"], { type: "image/png" }), "png");
    assert.match(path, /^u1\/p1\/.+\.full\.png$/);
    assert.equal(uploaded.length, 2);
    assert.ok(uploaded[1]!.endsWith(".thumb.webp"));
  } finally {
    restore();
  }
});

test("a failed thumbnail upload still returns the full image (25-11)", async () => {
  const restore = stubCanvas();
  try {
    const { fetcher, uploaded } = blobs(true);
    const path = await new PaperImageStore(fetcher, session).upload("p1", new Blob(["img"], { type: "image/png" }), "png");
    assert.deepEqual(uploaded, [path]);
  } finally {
    restore();
  }
});
