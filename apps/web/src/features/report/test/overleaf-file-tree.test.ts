import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFileTree, foldersOf, type FileTreeNode } from "../lib/overleaf-file-tree";

/** The tree as indented names, folders ending in "/". */
const outline = (nodes: FileTreeNode[], depth = 0): string[] =>
  nodes.flatMap((n) =>
    n.kind === "folder"
      ? [`${"  ".repeat(depth)}${n.name}/`, ...outline(n.children, depth + 1)]
      : [`${"  ".repeat(depth)}${n.name}`],
  );

test("nests paths into folders, folders first, sorted by name", () => {
  const tree = buildFileTree([
    { id: "1", path: "main.tex" },
    { id: "2", path: "chapters/intro.tex" },
    { id: "3", path: "appendix.tex" },
    { id: "4", path: "chapters/parts/a.tex" },
    { id: "5", path: "chapters/Background.tex" },
    { id: "6", path: "bib/refs.bib" },
  ]);
  assert.deepEqual(outline(tree), [
    "bib/",
    "  refs.bib",
    "chapters/",
    "  parts/",
    "    a.tex",
    "  Background.tex",
    "  intro.tex",
    "appendix.tex",
    "main.tex",
  ]);
  const chapters = tree[1];
  assert.equal(chapters?.kind === "folder" && chapters.path, "chapters/");
  const file = chapters?.kind === "folder" ? chapters.children.at(-1) : undefined;
  assert.deepEqual(file, { kind: "file", name: "intro.tex", path: "chapters/intro.tex", id: "2" });
});

test("numbers sort naturally and an empty project is an empty tree", () => {
  const tree = buildFileTree([{ id: "a", path: "ch10.tex" }, { id: "b", path: "ch2.tex" }]);
  assert.deepEqual(outline(tree), ["ch2.tex", "ch10.tex"]);
  assert.deepEqual(buildFileTree([]), []);
});

test("foldersOf lists the folders that hold a file", () => {
  assert.deepEqual(foldersOf("a/b/c.tex"), ["a/", "a/b/"]);
  assert.deepEqual(foldersOf("main.tex"), []);
});
