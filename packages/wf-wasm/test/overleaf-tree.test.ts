import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { flattenOverleafDocs, flattenOverleafFiles } from "../src/overleaf-tree.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const ROOT = [
  {
    docs: [{ _id: "d1", name: "main.tex" }],
    fileRefs: [{ _id: "f0", name: "logo.png" }],
    folders: [
      {
        name: "chapters",
        docs: [{ _id: "d2", name: "intro.tex" }],
        fileRefs: [{ _id: "f1", name: "figure.png" }],
        folders: [{ name: "deep", docs: [{ _id: "d3", name: "x.tex" }], folders: [] }],
      },
    ],
  },
];

test("docs are walked with folder prefixes, own files before subfolders", () => {
  assert.deepEqual(flattenOverleafDocs(ROOT), [
    { id: "d1", path: "main.tex" },
    { id: "d2", path: "chapters/intro.tex" },
    { id: "d3", path: "chapters/deep/x.tex" },
  ]);
});

test("file refs use the fileRefs list, not docs", () => {
  assert.deepEqual(flattenOverleafFiles(ROOT), [
    { id: "f0", path: "logo.png" },
    { id: "f1", path: "chapters/figure.png" },
  ]);
});

test("null or empty roots give no entries", () => {
  assert.deepEqual(flattenOverleafDocs(null), []);
  assert.deepEqual(flattenOverleafFiles(null), []);
  assert.deepEqual(flattenOverleafDocs([]), []);
});

test("entries without a string id and name, and unnamed folders, are skipped", () => {
  const root = [{ docs: [{ _id: 7, name: "bad.tex" }, { _id: "d9" }], folders: [{ docs: [{ _id: "d8", name: "ok.tex" }] }] }];
  assert.deepEqual(flattenOverleafDocs(root), []);
});
