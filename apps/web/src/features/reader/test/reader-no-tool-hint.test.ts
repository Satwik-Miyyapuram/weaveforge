/**
 * The line under the PDF toolbar saying what the armed tool does ("Drag across
 * text, then pick Highlight…") sat under the sticky toolbar and was cut off by
 * it. The tools are named by their tooltips; the line is gone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the PDF reader shows no tool hint line", () => {
  assert.doesNotMatch(read("../ui/pdf-reader/pdf-reader.tsx"), /tool-hint|CREATE_TOOL_HINTS/);
  assert.doesNotMatch(read("../ui/pdf-reader/constants.ts"), /CREATE_TOOL_HINTS/);
  assert.doesNotMatch(read("../../../app/styles/reader.css"), /pdf-reader-tool-hint/);
});
