import { test } from "node:test";
import assert from "node:assert/strict";
import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { editorImageUpload } from "@/lib/editor-image-upload";

test("an image the browser cannot re-encode is stored as it came, and logged (11-14)", async () => {
  const stored: { blob: Blob; ext: string }[] = [];
  const upload = editorImageUpload({
    store: async (blob, ext) => {
      stored.push({ blob, ext });
      return "img/1";
    },
    toMarkdown: (path, alt) => `![${alt}](${path})`,
  });
  // Node has no canvas, so the re-encode fails the way an unknown format does.
  const file = new File(["bytes"], "scan.tiff", { type: "image/tiff" });
  await withAppLogs(async (logs) => {
    const markdown = await upload.upload(file);
    assert.match(markdown, /\]\(img\/1\)$/);
    assert.equal(stored[0]?.blob, file, "the original is kept");
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.source, "image-upload");
    assert.match(String(logs[0]?.detail), /scan\.tiff/);
  });
});

test("a GIF is stored untouched and logs nothing", async () => {
  const stored: Blob[] = [];
  const upload = editorImageUpload({
    store: async (blob) => {
      stored.push(blob);
      return "img/2";
    },
    toMarkdown: (path) => path,
  });
  const gif = new File(["GIF89a"], "loop.gif", { type: "image/gif" });
  await withAppLogs(async (logs) => {
    assert.equal(await upload.upload(gif), "img/2");
    assert.equal(stored[0], gif);
    assert.deepEqual(logs, []);
  });
});
