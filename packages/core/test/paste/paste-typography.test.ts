import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInvisibleCharacters,
  straightenDashes,
  straightenQuotes,
  trimSurroundingWhitespace,
} from "../../src/paste/typography.js";
import { stripControlSequences } from "../../src/paste/control-characters.js";
import { markdownCodeRanges, mathRanges, frontmatterRange } from "../../src/paste/markdown-ranges.js";

const ZERO_WIDTH = "\u200B";
const NO_BREAK = "\u00A0";
const CURLY = "\u201CIt works,\u201D she said \u2014 finally.";

test("normalises assistant typography to plain text", () => {
  const quotes = straightenQuotes(CURLY).text;
  assert.equal(straightenDashes(quotes).text, '"It works," she said - finally.');
});

test("removes zero-width characters and turns exotic spaces into plain ones", () => {
  const result = normalizeInvisibleCharacters(`a${ZERO_WIDTH}b${NO_BREAK}c`);
  assert.equal(result.text, "ab c");
  assert.equal(result.changed, true);
});

test("keeps the joiners that hold letters and emoji together", () => {
  const joined = "\u0928\u094D\u200D\u092F and \u{1F468}\u200D\u{1F4BB}";
  assert.equal(normalizeInvisibleCharacters(joined).text, joined);
});

test("an invisible character inside code is still removed", () => {
  // The one place a reader cannot see it, and the reason the block was pasted.
  assert.equal(normalizeInvisibleCharacters("`a" + ZERO_WIDTH + "b`").text, "`ab`");
});

test("quotes and dashes inside code, maths and links survive", () => {
  const code = "`don\u2019t` here\n\n```\na \u2014 b\n```";
  assert.equal(straightenQuotes(code).text, code);
  assert.equal(straightenDashes(code).text, code);

  const maths = "The bound $\\alpha \u2014 \\beta$ holds";
  assert.equal(straightenDashes(maths).text, maths);

  const link = "[[2013\u201314 season]] and [a](https://x.example/\u201Cq\u201D)";
  assert.equal(straightenDashes(link).text, link);
  assert.equal(straightenQuotes(link).text, link);
});

test("a citation command keeps its key", () => {
  const cite = "as shown \\cite{smith\u20132019} and [@a\u2019b]";
  assert.equal(straightenDashes(cite).text, cite);
  assert.equal(straightenQuotes(cite).text, cite);
});

test("frontmatter values are data, not prose", () => {
  const note = "---\ntitle: \u201CA \u2014 B\u201D\n---\n\nBody \u2014 here";
  assert.equal(straightenDashes(note).text, "---\ntitle: \u201CA \u2014 B\u201D\n---\n\nBody - here");
});

test("a converted leading dash is escaped so it does not become a list item", () => {
  assert.equal(straightenDashes("\u2014 finally").text, "\\- finally");
  assert.equal(straightenDashes("word \u2014 finally").text, "word - finally");
});

test("trimming keeps the blank lines inside a paste", () => {
  const result = trimSurroundingWhitespace("\n\n  one\n\ntwo  \n\n");
  assert.equal(result.text, "one\n\ntwo");
});

test("trimming settles in one pass when a blank line carries spaces", () => {
  // Written as "newlines then spaces" the rule needed a second pass here, which
  // means it disagreed with itself about what it had already done.
  const once = trimSurroundingWhitespace("a\n\n   \n\n").text;
  assert.equal(once, "a");
  assert.equal(trimSurroundingWhitespace(once).text, once);
});

test("trimming leaves an indented code block at the top of a paste alone", () => {
  // Four columns is a code block. Stripping it turns code into prose, and the
  // quote and dash rules then rewrite it on the next pass.
  const block = "    const a = \u201Cx\u201D \u2014 1;";
  assert.equal(trimSurroundingWhitespace(block).text, block);
  assert.equal(trimSurroundingWhitespace(`\n\n${block}\n\n`).text, block);
  // Under four columns is stray indentation from a chat window, and goes.
  assert.equal(trimSurroundingWhitespace("   three spaces").text, "three spaces");
});

test("strips ANSI colour, cursor moves and stray control bytes", () => {
  assert.equal(stripControlSequences("\u001B[31merror\u001B[0m\u0007"), "error");
  assert.equal(stripControlSequences("plain\ttext\n"), "plain\ttext\n");
});

test("code, maths and frontmatter ranges are found where expected", () => {
  assert.equal(markdownCodeRanges("a `b` c").length, 1);
  assert.equal(markdownCodeRanges("```\nx\n```").length, 1);
  // An unclosed fence protects to the end: a half-pasted block is still code.
  assert.equal(markdownCodeRanges("```\nx").length, 1);
  assert.equal(mathRanges("cost $5 and $10").length, 0);
  assert.equal(mathRanges("$x^2$ and $$\ny\n$$").length, 2);
  assert.ok(frontmatterRange("---\na: 1\n---\nbody"));
  assert.equal(frontmatterRange("body\n---\na: 1\n---"), null);
});
