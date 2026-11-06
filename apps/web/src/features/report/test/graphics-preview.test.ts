import { test } from "node:test";
import assert from "node:assert/strict";
import { graphicsFileFor, previewableFiles, previewResolver } from "../lib/graphics-file";

const FILES = [
  { id: "a1", path: "plots/aa.png" },
  { id: "b2", path: "fig.PDF" },
  { id: "c3", path: "logo.jpg" },
  { id: "d4", path: "logo.png" },
];

test("an \\includegraphics path finds its project file as LaTeX does, extension optional", () => {
  assert.deepEqual(graphicsFileFor(FILES, "plots/aa.png"), { id: "a1", path: "plots/aa.png", extension: "png" });
  assert.deepEqual(graphicsFileFor(FILES, "plots/aa"), { id: "a1", path: "plots/aa.png", extension: "png" });
  assert.deepEqual(graphicsFileFor(FILES, "./plots/aa"), { id: "a1", path: "plots/aa.png", extension: "png" });
  assert.equal(graphicsFileFor(FILES, "fig")?.extension, "PDF");
  assert.equal(graphicsFileFor(FILES, "logo")?.id, "d4", "png before jpg, as pdflatex tries them");
  assert.equal(graphicsFileFor(FILES, "missing"), null);
  assert.equal(graphicsFileFor(FILES, ""), null);
});

test("only images and PDFs are fetched for previews", () => {
  const files = [...FILES, { id: "e5", path: "refs.bib" }, { id: "f6", path: "art.svg" }, { id: "g7", path: "p.JPEG" }];
  assert.deepEqual(previewableFiles(files).map((f) => f.id), ["a1", "b2", "c3", "d4", "f6", "g7"]);
});

test("the preview resolver gives a fetched file's URL and extension, null until it is fetched", () => {
  const resolve = previewResolver(FILES, new Map([["a1", "blob:a"], ["b2", "blob:b"]]));
  assert.deepEqual(resolve("plots/aa"), { url: "blob:a", extension: "png" });
  assert.deepEqual(resolve("fig"), { url: "blob:b", extension: "PDF" });
  assert.equal(resolve("logo"), null, "found but not fetched");
  assert.equal(resolve("missing"), null);
});
