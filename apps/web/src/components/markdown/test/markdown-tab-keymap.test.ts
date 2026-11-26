import assert from "node:assert/strict";
import test from "node:test";
import { acceptCompletion } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import { markdownTabKeymap } from "@/components/markdown/markdown-editor-extensions";

/** Tab never leaves the editor: it takes the open suggestion, else indents; Shift-Tab outdents. */
test("Tab accepts an open completion first, then indents", () => {
  const tabs = markdownTabKeymap.filter((b) => b.key === "Tab").map((b) => b.run);
  assert.deepEqual(tabs, [acceptCompletion, indentMore]);
});

test("Shift-Tab outdents", () => {
  const binding = markdownTabKeymap.find((b) => b.key === "Tab" && b.shift);
  assert.equal(binding?.shift, indentLess);
});
