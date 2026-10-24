/**
 * A paper figure's bytes: the thumbnail variant first, the full image as the
 * fallback (21-08). One helper serves the ink sheet and the paper preview.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchPaperImageBlob, fetchPaperImageBlobs } from "../lib/image-variants";

const blob = (s: string) => new Blob([s]);

function store(have: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    fetchImageBlob: async (path: string) => {
      asked.push(path);
      if (!(path in have)) throw new Error("missing");
      return blob(have[path]!);
    },
    fetchImageBlobs: async (paths: readonly string[]) => {
      asked.push(...paths);
      const out = new Map<string, Blob>();
      for (const p of paths) if (p in have) out.set(p, blob(have[p]!));
      return out;
    },
  };
}

test("the thumbnail wins when it exists", async () => {
  const s = store({ "a/x.thumb.webp": "thumb", "a/x.png": "full" });
  assert.equal(await (await fetchPaperImageBlob(s, "a/x.png"))!.text(), "thumb");
  assert.deepEqual(s.asked, ["a/x.thumb.webp"]);
});

test("the full image is the fallback, and both missing is null", async () => {
  const s = store({ "a/x.png": "full" });
  assert.equal(await (await fetchPaperImageBlob(s, "a/x.png"))!.text(), "full");
  assert.equal(await fetchPaperImageBlob(s, "a/gone.png"), null);
});

test("the batch takes thumbnails, fills gaps with fulls, and drops the rest", async () => {
  const s = store({ "t.thumb.webp": "T", "f.png": "F" });
  const out = await fetchPaperImageBlobs(s, ["t.png", "f.png", "g.png"]);
  assert.deepEqual([...out.keys()], ["t.png", "f.png"]);
  assert.equal(await out.get("t.png")!.text(), "T");
  assert.equal(await out.get("f.png")!.text(), "F");
  assert.deepEqual(await fetchPaperImageBlobs(s, []), new Map());
});
