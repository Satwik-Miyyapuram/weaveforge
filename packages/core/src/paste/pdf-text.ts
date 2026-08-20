/**
 * Repairing text copied out of a PDF.
 *
 * This is the rule a research workspace needs most and the one a general note
 * app can treat as optional. A quotation lifted from a two-column paper arrives
 * as short lines, with words split across them by a hyphen the typesetter
 * added, ligature glyphs where `fi` and `ffl` should be, and a page number
 * sitting in the middle of a sentence. Pasted as-is it is unreadable in a note,
 * un-greppable in search, and wrong in a quotation.
 *
 * Two of the fixes cannot be inferred from the text — whether a bare number was
 * a page number or data, and whether the passage was one paragraph — so they
 * are options a caller asks for rather than guesses this file makes.
 */

import { cleanWrappedText, endsHyphenated, joinPieces, PDF_MIN_WRAP_WIDTH, SOFT_HYPHEN, type WrappedTextResult } from "./wrapped-text.js";
import { markdownCodeRanges } from "./markdown-ranges.js";
import { indexRanges } from "./text-range.js";

export interface PdfTextOptions {
  /** Remove page-number lines along with the page break around them. */
  removePageNumbers: boolean;
  /** Join the whole selection into a single paragraph. */
  singleParagraph: boolean;
}

export const DEFAULT_PDF_TEXT_OPTIONS: PdfTextOptions = {
  removePageNumbers: false,
  singleParagraph: false,
};

/**
 * The Latin ligature glyphs publisher fonts put on the clipboard. Expanded
 * because a search for "financial" never matches the word with a ligature in
 * it, and neither does a reviewer reading the quotation.
 */
const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  // Unicode folds both long-s ligatures to st.
  "ﬅ": "st",
  "ﬆ": "st",
};

const LIGATURE_PATTERN = new RegExp("[\\uFB00-\\uFB06]", "g");

/**
 * A line whose visible content is digits and the separators page numbers use:
 * `14`, `- 3 -`, `3 / 12`. A whitelist rather than a blacklist, so `95%`,
 * `[12]` and `2 + 2 = 4` stay content.
 */
const PAGE_NUMBER_LINE = new RegExp("^[\\s\\-\\u2013\\u2014.()/|:]*\\d[\\d\\s\\-\\u2013\\u2014.()/|:]*$");

/** Longest visible content that can plausibly still be a page number. */
const PAGE_NUMBER_MAX_LENGTH = 24;

interface ClassifiedLine {
  text: string;
  /** True when Markdown renders the whole line as code or maths. */
  verbatim: boolean;
}

/**
 * Splits into lines, marking the ones that must pass through untouched. A line
 * with an inline backtick span in it is prose with code in it, so it stays
 * workable; only a whole line of code is verbatim.
 */
function classifyLines(text: string): ClassifiedLine[] {
  // Indexed rather than scanned: a long selection carrying many code spans
  // would otherwise cost lines x ranges.
  const code = indexRanges(markdownCodeRanges(text));
  const lines: ClassifiedLine[] = [];
  let start = 0;
  let math = false;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    const delimiter = line.trim() === "$$";
    // The line counts as code only when a range covers its whole span; the
    // strict lower bound keeps the blank line that merely touches a range's
    // endpoint, such as the one after a closing fence, out of the block.
    const range = code.find(start);
    const covered = range !== undefined && range.end > start && range.end >= end;
    const verbatim = math || delimiter || covered;
    if (delimiter) math = !math;
    lines.push({ text: line, verbatim });
    start = end + 1;
  }
  return lines;
}

/**
 * Removes page-number lines together with the blank lines around them.
 *
 * When the text before the gap ends mid-sentence, the gap closes completely so
 * the rejoin can repair the sentence across the page break; otherwise one blank
 * line stays and the paragraphs remain separate. Running headers and footers
 * are deliberately left alone: telling them from repeated content needs the
 * page geometry, which a clipboard never carries.
 */
function removePageNumbers(text: string): string {
  const lines = classifyLines(text);

  const isPageNumber = (index: number): boolean => {
    const line = lines[index]!;
    if (line.verbatim) return false;
    const key = line.text.trim();
    if (key.length === 0) return false;
    return key.length <= PAGE_NUMBER_MAX_LENGTH && PAGE_NUMBER_LINE.test(key);
  };

  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.verbatim || (line.text.trim().length > 0 && !isPageNumber(index))) {
      output.push(line.text);
      index += 1;
      continue;
    }

    // Blank lines and page furniture around one break form a single gap.
    let end = index;
    let sawPageNumber = false;
    while (end < lines.length && !lines[end]!.verbatim && (lines[end]!.text.trim().length === 0 || isPageNumber(end))) {
      if (isPageNumber(end)) sawPageNumber = true;
      end += 1;
    }

    if (!sawPageNumber) {
      for (let at = index; at < end; at += 1) output.push(lines[at]!.text);
    } else {
      const previous = output[output.length - 1];
      const next = end < lines.length ? lines[end] : undefined;
      // A gap at either edge of the selection disappears with its furniture. In
      // the middle it closes only when the text reads as one sentence crossing
      // the page: the line before ends in a broken word or without sentence
      // punctuation, and the line after resumes in lowercase or a plain number.
      if (previous !== undefined && next !== undefined) {
        const crossesPage =
          endsHyphenated(previous) ||
          (!new RegExp("[.!?:;\"'\\u2019\\u201D\\u2026)]$").test(previous.trimEnd()) &&
            !next.verbatim &&
            /^[\p{Ll}\d]/u.test(next.text.trimStart()) &&
            !/^\s*\d{1,9}[.)]\s/.test(next.text));
        if (!crossesPage) output.push("");
      }
    }
    index = end;
  }

  return output.join("\n");
}

/** Joins every prose line into one paragraph, leaving code and maths alone. */
function joinIntoOneParagraph(text: string): string {
  const parts: string[] = [];
  const prose: string[] = [];
  const verbatim: string[] = [];

  const flushProse = (): void => {
    if (prose.length === 0) return;
    parts.push(joinPieces(prose));
    prose.length = 0;
  };
  const flushVerbatim = (): void => {
    if (verbatim.length === 0) return;
    parts.push(verbatim.join("\n"));
    verbatim.length = 0;
  };

  for (const line of classifyLines(text)) {
    if (line.verbatim) {
      flushProse();
      verbatim.push(line.text);
      continue;
    }
    flushVerbatim();
    const trimmed = line.text.trim();
    if (trimmed.length > 0) prose.push(trimmed);
  }
  flushProse();
  flushVerbatim();

  // The blank line keeps an indented code block out of the joined paragraph:
  // Markdown reads an indented line straight after prose as more prose.
  return parts.join("\n\n");
}

/**
 * Expands ligatures, repairs hyphenated words, rejoins the lines the layout
 * wrapped, and collapses the spacing justified text leaves behind.
 */
export function cleanPdfText(
  input: string,
  options: PdfTextOptions = DEFAULT_PDF_TEXT_OPTIONS,
): WrappedTextResult {
  // Some extractors put accents on the clipboard as combining marks. Composing
  // them lets the hyphen repair see the letter, and lets search find the word.
  let text = input.normalize("NFC").replace(/\r\n?/g, "\n");

  text = text.replace(LIGATURE_PATTERN, (glyph) => LIGATURES[glyph] ?? glyph);

  // A soft hyphen inside a word is dropped. One at a line end stays for now:
  // the rejoin reads it as wrap evidence and removes it whatever follows,
  // unlike a visible hyphen, which may be part of a compound.
  text = text.replace(new RegExp(`${SOFT_HYPHEN}(?![ \\t]*\\n)`, "g"), "");

  if (options.removePageNumbers) text = removePageNumbers(text);

  const rejoined = cleanWrappedText(text, {
    rejoin: "any",
    bullets: "markdown",
    mergeHyphens: true,
    collapseSpaces: true,
    minWrapWidth: PDF_MIN_WRAP_WIDTH,
    protectMath: true,
  });

  // A soft hyphen that survived sat at a break the rejoin kept, for example in
  // front of a list item, so it goes here instead.
  let cleaned = rejoined.text.split(SOFT_HYPHEN).join("");

  if (options.singleParagraph) cleaned = joinIntoOneParagraph(cleaned);

  return { text: cleaned, changed: cleaned !== input };
}
