import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPastedText, looksLikePdfText } from "../../src/paste/clean-pasted-text.js";
import { cleanPdfText } from "../../src/paste/pdf-text.js";
import { cleanWrappedText } from "../../src/paste/wrapped-text.js";
import { applyCommaPlacement } from "../../src/paste/quote-commas.js";
import { buildUrlCleanupOptions, cleanUrlsInText, cleanUrl } from "../../src/paste/url-cleanup.js";
import { markdownCodeRanges, mathRanges, markdownSyntaxRanges } from "../../src/paste/markdown-ranges.js";
import { normalizeInvisibleCharacters, straightenDashes, straightenQuotes } from "../../src/paste/typography.js";
import { DEFAULT_PASTE_SETTINGS } from "../../src/paste/paste-settings.js";

/**
 * What a paste can survive.
 *
 * These rules run on a keystroke, on text nobody wrote for them: a 40,000-line
 * log, a minified bundle on one line, a document made entirely of brackets. Two
 * failures matter and neither shows up in an example-based test. A regular
 * expression that backtracks exponentially freezes the tab, and an O(n^2) scan
 * over a large paste does the same thing more slowly. Both are found by timing
 * a hostile input, so that is what this file does.
 *
 * The budgets are deliberately loose — an order of magnitude above what the
 * work actually takes on this machine — because a tight budget on shared CI
 * hardware fails for reasons that have nothing to do with the code. They catch
 * a complexity class changing, not a machine having a slow minute.
 */

/**
 * Seven times the worst case measured here, which leaves room for slower CI
 * hardware while still failing loudly if a linear scan turns quadratic again.
 * Two did, and both were found by this file: a range check that scanned its own
 * output (4.9s on half a megabyte of maths) and a paragraph join that re-read
 * everything it had built (16.5s on forty thousand short lines).
 */
const BUDGET_MS = 1500;

function timed(name: string, run: () => void): number {
  const started = performance.now();
  run();
  const elapsed = performance.now() - started;
  assert.ok(
    elapsed < BUDGET_MS,
    `${name} took ${elapsed.toFixed(0)}ms, over the ${BUDGET_MS}ms budget — suspect a complexity change`,
  );
  return elapsed;
}

const options = buildUrlCleanupOptions();
const allOn = {
  ...DEFAULT_PASTE_SETTINGS,
  straightenQuotes: true,
  straightenDashes: true,
  cleanPdfOnPaste: true,
  tabsToTable: true,
  linkIdentifiers: true,
};

/* -------------------------------------------------------------------------- */
/* Catastrophic backtracking                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Inputs shaped to make a backtracking engine explore every split. Each is a
 * long run of the character a pattern in this folder treats as significant,
 * with the closing character withheld so no match can ever succeed.
 */
const REDOS_INPUTS: [string, string][] = [
  ["unclosed inline maths", "$" + "a".repeat(20000)],
  ["alternating dollars", "$a".repeat(10000)],
  ["unclosed block maths", "$$" + "x ".repeat(20000)],
  ["unclosed link destination", "](" + "a".repeat(20000)],
  ["nested link parens", "](" + "(".repeat(5000)],
  ["unclosed wikilink", "[[" + "a".repeat(20000)],
  ["alternating brackets", "[]".repeat(10000)],
  ["unclosed latex command", "\\cite{" + "a".repeat(20000)],
  ["backslash run", "\\".repeat(20000)],
  ["backtick run", "`".repeat(20000)],
  ["fence openers", "```\n".repeat(5000)],
  ["angle run", "<".repeat(20000)],
  ["html tag opener", "<a " + "b".repeat(20000)],
  ["quote run", '"'.repeat(20000)],
  ["url-ish run", "https://" + "a".repeat(20000)],
  ["url with many params", "https://a.example/x?" + "utm_a=1&".repeat(5000)],
  ["deep parens in url", "https://a.example/" + "(".repeat(5000)],
  ["closing parens in url", "https://a.example/" + ")".repeat(5000)],
  ["reference definition", "[" + "a".repeat(20000) + "]:"],
  ["dashes and quotes", "—“".repeat(10000)],
  ["soft hyphens", "a­".repeat(10000)],
];

for (const [name, input] of REDOS_INPUTS) {
  test(`no catastrophic backtracking: ${name}`, () => {
    timed(`ranges(${name})`, () => {
      markdownCodeRanges(input);
      mathRanges(input);
      markdownSyntaxRanges(input);
    });
    timed(`pipeline(${name})`, () => cleanPastedText(input, allOn));
    timed(`pdf(${name})`, () => cleanPdfText(input));
    timed(`commas(${name})`, () => applyCommaPlacement(input, "outside"));
  });
}

/* -------------------------------------------------------------------------- */
/* Volume                                                                      */
/* -------------------------------------------------------------------------- */

/** The cap the editor applies before calling any of this. */
const MAX_PASTE = 500_000;

function repeatTo(unit: string, size: number): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

const VOLUME_INPUTS: [string, string][] = [
  ["ordinary prose", repeatTo("The quick brown fox jumps over the lazy dog. ", MAX_PASTE)],
  ["one enormous line", "x".repeat(MAX_PASTE)],
  ["many short lines", repeatTo("short line\n", MAX_PASTE)],
  ["thousands of code spans", repeatTo("a `code` b ", MAX_PASTE)],
  ["thousands of urls", repeatTo("https://a.example/x?utm_source=n and ", MAX_PASTE)],
  ["thousands of wikilinks", repeatTo("[[Some Note Title]] and ", MAX_PASTE)],
  ["thousands of maths spans", repeatTo("$x^2 + y^2$ and ", MAX_PASTE)],
  ["thousands of citations", repeatTo("\\cite{smith2019} and ", MAX_PASTE)],
  ["a long fenced block", "```\n" + repeatTo("const a = 1;\n", MAX_PASTE - 8) + "```"],
  ["wrapped pdf columns", repeatTo("The findings suggest that long-term expo-\nsure was measured.\n", MAX_PASTE)],
  ["deeply indented", repeatTo("        indented line\n", MAX_PASTE)],
  ["crlf everywhere", repeatTo("line one\r\nline two\r\n", MAX_PASTE)],
  ["invisible characters", repeatTo("a​ b­ ", MAX_PASTE)],
  ["a reference list of DOIs", repeatTo("See 10.1145/3292500.3330701 and arXiv:1706.03762.\n", MAX_PASTE)],
  ["a wide spreadsheet", repeatTo("a\tb\tc\td\te\tf\tg\th\n", MAX_PASTE)],
  ["ragged tab-separated rows", repeatTo("a\tb\nc\td\te\n", MAX_PASTE)],
  ["mixed everything", repeatTo(
    "Prose with https://a.example/x?utm_source=n, `code`, $x^2$, [[a note]], \\cite{k} and “quotes” — dashes.\n",
    MAX_PASTE,
  )],
];

for (const [name, input] of VOLUME_INPUTS) {
  test(`half a megabyte of ${name}`, () => {
    assert.ok(input.length >= MAX_PASTE - 200, "input should be at the size cap");
    // Every entry point, with every option on. The 16-second join hid behind a
    // suite that only ever exercised the paste pipeline.
    timed(`pipeline(${name})`, () => cleanPastedText(input, allOn));
    timed(`pdf(${name})`, () =>
      cleanPdfText(input, { removePageNumbers: true, singleParagraph: true }),
    );
    timed(`terminal(${name})`, () =>
      cleanWrappedText(input, { rejoin: "any", bullets: "markdown", collapseSpaces: true }),
    );
    timed(`commas(${name})`, () => applyCommaPlacement(input, "outside"));
  });
}

test("a whole megabyte still completes, in case the editor cap is ever raised", () => {
  const input = repeatTo("Prose, a https://a.example/x?utm_source=n link and `code`. ", 1_000_000);
  timed("pipeline(1MB)", () => cleanPastedText(input, allOn));
  timed("pdf(1MB)", () => cleanPdfText(input, { removePageNumbers: true, singleParagraph: true }));
});

/* -------------------------------------------------------------------------- */
/* Never throws                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Text a clipboard really can hold. Lone surrogates come from a truncated copy
 * out of a buggy application; the rest is ordinary content that happens to look
 * like syntax.
 */
const HOSTILE: string[] = [
  "",
  " ",
  "\n",
  "\r\n\r\n",
  // control characters, written as escapes: literal ones in the source make git
  // treat this whole file as binary and hide it from grep.
  "\u0000\u0001\u0002",
  "\uD800", // lone high surrogate
  "\uDC00", // lone low surrogate
  "a\uD800b\uDC00c",
  "�￾￿",
  "---",
  "---\n",
  "---\nnot: closed",
  "```",
  "```\n```\n```",
  "$$",
  "$$$$",
  "$",
  "[[",
  "]]",
  "](",
  "![](",
  "!()[]",
  "\\",
  "\\\\\\",
  "\\cite{",
  "> ",
  ">>>>>>",
  "| | |",
  "\t\t\t",
  "https://",
  "https:// ",
  "http://[",
  "https://%%%",
  "https://a.example/%E0%A4%A",
  "https://user:pass@a.example/x?utm_source=n",
  "https://[::1]:8080/x?utm_source=n",
  "https://a.example/x?=&&=&utm_source=n",
  "https://a.example/x#" + "#".repeat(100),
  "HTTPS://A.EXAMPLE/X?UTM_SOURCE=N",
  "https://xn--80ak6aa92e.com/x?utm_source=n",
  "‮‭reversed‬",
  "́".repeat(1000),
  "\u{1F468}‍\u{1F469}‍\u{1F467}",
  "กขฃ",
  "中文测试",
];

test("no input makes any transform throw", () => {
  for (const input of HOSTILE) {
    for (const settings of [DEFAULT_PASTE_SETTINGS, allOn, { ...DEFAULT_PASTE_SETTINGS, cleanOnPaste: false }]) {
      assert.doesNotThrow(() => cleanPastedText(input, settings), `cleanPastedText(${JSON.stringify(input)})`);
    }
    assert.doesNotThrow(() => cleanPdfText(input), `cleanPdfText(${JSON.stringify(input)})`);
    assert.doesNotThrow(
      () => cleanPdfText(input, { removePageNumbers: true, singleParagraph: true }),
      `cleanPdfText(all options)(${JSON.stringify(input)})`,
    );
    assert.doesNotThrow(
      () => cleanWrappedText(input, { rejoin: "any", bullets: "markdown", protectMath: true }),
      `cleanWrappedText(${JSON.stringify(input)})`,
    );
    assert.doesNotThrow(
      () => cleanWrappedText(input, { rejoin: "never", bullets: "preserve" }),
      `cleanWrappedText(never)(${JSON.stringify(input)})`,
    );
    assert.doesNotThrow(() => cleanUrl(input, options), `cleanUrl(${JSON.stringify(input)})`);
    assert.doesNotThrow(() => cleanUrlsInText(input, options), `cleanUrlsInText(${JSON.stringify(input)})`);
    assert.doesNotThrow(() => applyCommaPlacement(input, "inside"));
    assert.doesNotThrow(() => applyCommaPlacement(input, "outside"));
    assert.doesNotThrow(() => normalizeInvisibleCharacters(input));
    assert.doesNotThrow(() => straightenQuotes(input));
    assert.doesNotThrow(() => straightenDashes(input));
    assert.doesNotThrow(() => looksLikePdfText(input));
    assert.doesNotThrow(() => markdownCodeRanges(input));
    assert.doesNotThrow(() => mathRanges(input));
    assert.doesNotThrow(() => markdownSyntaxRanges(input));
  }
});

test("ranges are always well formed", () => {
  for (const input of [...HOSTILE, ...VOLUME_INPUTS.slice(0, 4).map(([, text]) => text.slice(0, 20000))]) {
    for (const ranges of [markdownCodeRanges(input), mathRanges(input), markdownSyntaxRanges(input)]) {
      for (const range of ranges) {
        assert.ok(Number.isInteger(range.start), `start not an integer in ${JSON.stringify(input.slice(0, 40))}`);
        assert.ok(Number.isInteger(range.end));
        assert.ok(range.start >= 0, "start before the document");
        assert.ok(range.end <= input.length, "end past the document");
        assert.ok(range.start <= range.end, "inverted range");
      }
      // mergeRanges leaves them sorted and disjoint, which every consumer assumes.
      for (let i = 1; i < ranges.length; i++) {
        assert.ok(ranges[i]!.start >= ranges[i - 1]!.end, "ranges overlap after merging");
      }
    }
  }
});
