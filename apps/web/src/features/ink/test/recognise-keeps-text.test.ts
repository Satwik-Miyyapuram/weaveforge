/**
 * Recognition writes the handwriting's text into a page without wiping what
 * was typed there (E34): a typed note opened in Ink keeps its body.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { pageTextAfterRecognition } from "../application/recognise-page";

const BG = "![page background](vault:attachments/p1.webp)";
const FIG = "![figure x=10 y=20 w=100 h=50](vault:attachments/f.webp)";

test("a handwritten page with no text takes the recognised text", () => {
  assert.equal(pageTextAfterRecognition("", "", "hello"), "hello");
});

test("typed text on the page is kept and the recognised text follows it", () => {
  assert.equal(pageTextAfterRecognition("# MIG\n\nTyped body.", "", "X"), "# MIG\n\nTyped body.\n\nX");
});

test("a second run replaces the earlier recognised text, not the typed text", () => {
  assert.equal(pageTextAfterRecognition("Typed body.\n\nold words", "old words", "new words"), "Typed body.\n\nnew words");
});

test("a page that only held recognised text is replaced whole", () => {
  assert.equal(pageTextAfterRecognition("old words", "old words", "new words"), "new words");
});

test("nothing recognised leaves the typed text as it was", () => {
  assert.equal(pageTextAfterRecognition("Typed body.", "", ""), "Typed body.");
});

test("the background line stays first and figures stay in their block", () => {
  const was = `${BG}\n\n${FIG}\n\nTyped body.`;
  const next = pageTextAfterRecognition(was, "", "X");
  assert.equal(next, `${BG}\n\n${FIG}\n\nTyped body.\n\nX`);
});

test("recognised text the person edited by hand is kept, never lost", () => {
  assert.equal(pageTextAfterRecognition("old words, fixed", "old words", "new"), "old words, fixed\n\nnew");
});
