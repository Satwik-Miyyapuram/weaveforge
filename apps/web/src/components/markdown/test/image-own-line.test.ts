/**
 * Pictures land on a line of their own, a paragraph apart from the text
 * around them, and a click opens them full size (design D19, DA-104). A paste
 * mid-sentence used to glue the image to the words either side.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Text } from "@codemirror/state";

import { ownLinePadding } from "../markdown-pending-insert";
import { IMAGE_SIZES, sizeFor } from "../../image-size-control";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const doc = Text.of(["first line", "a sentence here", "", "last"]);
// "first line" 0–10, "a sentence here" 11–26, "" 27, "last" 28–32.

test("mid-sentence, the picture is its own paragraph", () => {
  assert.deepEqual(ownLinePadding(doc, 13, 13), { before: "\n\n", after: "\n\n" });
});

test("at the end of a line of text, a blank line goes before it", () => {
  // The blank line under it already ends the paragraph.
  assert.deepEqual(ownLinePadding(doc, 26, 26), { before: "\n\n", after: "" });
});

test("on an empty line between paragraphs nothing is added", () => {
  const spaced = Text.of(["one", "", "", "", "two"]);
  assert.deepEqual(ownLinePadding(spaced, 5, 5), { before: "", after: "" });
});

test("on an empty line hugging text, the gap is completed", () => {
  // The blank line 27 sits under "a sentence here" and over "last".
  assert.deepEqual(ownLinePadding(doc, 27, 27), { before: "\n", after: "\n" });
});

test("at the very start and end of a note nothing is added outward", () => {
  assert.deepEqual(ownLinePadding(Text.of([""]), 0, 0), { before: "", after: "" });
  assert.deepEqual(ownLinePadding(doc, 0, 0), { before: "", after: "\n\n" });
  assert.deepEqual(ownLinePadding(doc, 32, 32), { before: "\n\n", after: "" });
});

test("a selection is replaced; the padding looks past both ends", () => {
  assert.deepEqual(ownLinePadding(doc, 11, 26), { before: "\n", after: "" });
});

test("uploads and downloaded pictures both insert on their own line", () => {
  assert.match(read("../markdown-image-paste.ts"), /insertPending\(.*ownLine: true/);
  assert.match(read("../markdown-remote-paste.ts"), /insertPending\(.*ownLine: true/);
});

test("the image bar offers S / M / L / Full", () => {
  assert.deepEqual(IMAGE_SIZES.map((s): [string, number] =>[s.label, s.value]), [["S", 25], ["M", 50], ["L", 75], ["Full", 100]]);
  assert.equal(sizeFor(50), 50);
  assert.equal(sizeFor(60), null, "a width the slider set is no preset");
});

test("a click opens the picture in the shared ImageViewer", () => {
  const src = read("../../image-size-control.tsx");
  assert.match(src, /<ImageViewer\b/);
  assert.match(src, />\s*Open full size\s*</);
});
