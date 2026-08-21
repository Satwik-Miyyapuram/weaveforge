import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanWrappedText,
  dedentLines,
  endsHyphenated,
  inferWrapWidth,
  MIN_WRAP_WIDTH,
} from "../src/paste/wrapped-text.js";
import { cleanPdfText } from "../src/paste/pdf-text.js";

const TERMINAL_OPTIONS = { rejoin: "any", bullets: "markdown" } as const;

test("rejoins a line a terminal broke at its window width", () => {
  const wrapped =
    "npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do\n  not use it. Check out lru-cache instead.";
  assert.equal(
    cleanWrappedText(wrapped, TERMINAL_OPTIONS).text,
    "npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do not use it. Check out lru-cache instead.",
  );
});

test("a short line was the author's break and stays one", () => {
  const short = "one\ntwo\nthree";
  assert.equal(cleanWrappedText(short, TERMINAL_OPTIONS).text, short);
});

test("structure stops a rejoin", () => {
  const long = "x".repeat(MIN_WRAP_WIDTH + 5);
  for (const next of ["- item", "1. item", "# Heading", "> quote", "| a | b |", "```", "---", "    code"]) {
    const text = `${long}\n${next}`;
    assert.equal(cleanWrappedText(text, TERMINAL_OPTIONS).text, text, next);
  }
});

test("a fenced block passes through verbatim", () => {
  const text = "```js\nconst a =\n  1;\n```";
  assert.equal(cleanWrappedText(text, TERMINAL_OPTIONS).text, text);
});

test("terminal bullets become Markdown list items", () => {
  assert.equal(cleanWrappedText("• first\n• second", TERMINAL_OPTIONS).text, "- first\n- second");
  // Markers Markdown already understands are left exactly as written.
  assert.equal(cleanWrappedText("* first", TERMINAL_OPTIONS).text, "* first");
});

test("escape sequences are removed and the shared indent goes with them", () => {
  const text = "    \u001B[32mok\u001B[0m one\n    two";
  assert.equal(cleanWrappedText(text, TERMINAL_OPTIONS).text, "ok one\ntwo");
});

test("dedent keeps relative indentation", () => {
  assert.deepEqual(dedentLines(["    a", "      b", "", "    c"]), ["a", "  b", "", "c"]);
});

test("the wrap column is inferred from the text, with a floor", () => {
  assert.equal(inferWrapWidth(["short", "lines"]), MIN_WRAP_WIDTH);
  const wide = ["y".repeat(100), "z".repeat(96), "end"];
  assert.equal(inferWrapWidth(wide), 76);
});

test("a hyphen at a line end is repaired only when the word resumes lowercase", () => {
  assert.equal(endsHyphenated("expo-"), true);
  assert.equal(endsHyphenated("---"), false);
});

test("repairs a paragraph copied out of a two-column PDF", () => {
  const pasted =
    "The findings suggest that long-term expo-\nsure has a measurable effect on the out-\ncome in both groups.";
  assert.equal(
    cleanPdfText(pasted).text,
    "The findings suggest that long-term exposure has a measurable effect on the outcome in both groups.",
  );
});

test("ligatures become real letters so search can find the words", () => {
  assert.equal(
    cleanPdfText("the ﬁnancial eﬀect and ﬃx").text,
    "the financial effect and ffix",
  );
});

test("page numbers go only when asked, and close a sentence across the break", () => {
  const pages = "the result was\n\n14\n\nmeasured again";
  assert.equal(cleanPdfText(pages).text, pages);
  assert.equal(
    cleanPdfText(pages, { removePageNumbers: true, singleParagraph: false }).text,
    "the result was\nmeasured again",
  );
  // A standalone value that is not page furniture stays put.
  const data = "the result was\n\n95%\n\nmeasured again";
  assert.equal(cleanPdfText(data, { removePageNumbers: true, singleParagraph: false }).text, data);
});

test("single paragraph joins prose and leaves code alone", () => {
  const text = "first line\n\nsecond line\n\n```\ncode\n```";
  assert.equal(
    cleanPdfText(text, { removePageNumbers: false, singleParagraph: true }).text,
    "first line second line\n\n```\ncode\n```",
  );
});

test("maths survives a PDF cleanup", () => {
  const text = "the bound\n\n$$\na - b\n$$\n\nholds";
  assert.equal(cleanPdfText(text).text, text);
});

test("a paste that needed nothing is reported unchanged", () => {
  const text = "one\ntwo";
  const result = cleanWrappedText(text, TERMINAL_OPTIONS);
  assert.equal(result.changed, false);
  assert.equal(result.text, text);
});
