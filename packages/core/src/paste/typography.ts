/**
 * Character-level cleanups for pasted prose.
 *
 * All three rules convert toward plain ASCII, which is the direction that
 * repairs pasted Markdown rather than breaking it: straight quotes and hyphens
 * are what Markdown's own syntax is made of, and a LaTeX export of a note full
 * of curly quotes and en dashes is a stream of encoding surprises.
 *
 * Every pattern is written from escape strings, because the whole point of
 * these rules is that the characters are invisible or easily confused on
 * screen.
 */

import { markdownCodeRanges, mathRanges, markdownSyntaxRanges, frontmatterRange } from "./markdown-ranges.js";
import { indexRanges, type RangeIndex, type TextRange } from "./text-range.js";

/** Em dash and en dash. */
const DASHES = new RegExp("[\\u2013\\u2014]", "g");

/**
 * Curly double quotes, including the low-9 form German opens with.
 *
 * Guillemets are deliberately absent: they are the ordinary quotation marks of
 * French and Russian, so converting them would not be tidying pasted text, it
 * would be rewriting correctly set text.
 */
const DOUBLE_QUOTES = new RegExp("[\\u201C\\u201D\\u201E\\u201F]", "g");

/** Curly single quotes. U+2019 is the one that matters: it is the apostrophe. */
const SINGLE_QUOTES = new RegExp("[\\u2018\\u2019\\u201A\\u201B]", "g");

/**
 * Spaces that are not the ordinary space. The ideographic space U+3000 is left
 * alone: it is the normal word space in CJK text and a full character wide, so
 * swapping it re-lays out a sentence that was set correctly.
 */
const EXOTIC_SPACE = new RegExp("[\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F]");

/**
 * Every character the invisible pass touches: the exotic spaces above, the soft
 * hyphen, the zero-width space, the byte-order mark, and the two bidirectional
 * *overrides*.
 *
 * Direction marks, embeddings and isolates are kept, because they carry meaning
 * in mixed-direction text; so are the zero-width joiner and non-joiner, which
 * hold emoji and Indic and Arabic letters together. Only the overrides go, and
 * only because they can make a line render in an order unrelated to its source.
 */
const INVISIBLE = new RegExp("[\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u00AD\\u200B\\uFEFF\\u202D\\u202E]", "g");

export interface TypographyResult {
  text: string;
  changed: boolean;
}

/** The spans a quote or dash rule must not reach into. */
function protectedForCharacterRules(text: string, extra: readonly TextRange[]): RangeIndex {
  const frontmatter = frontmatterRange(text);
  return indexRanges([
    ...extra,
    ...markdownCodeRanges(text),
    ...mathRanges(text),
    ...markdownSyntaxRanges(text),
    ...(frontmatter ? [frontmatter] : []),
  ]);
}

/**
 * Replaces the characters that look ordinary and are not: exotic spaces become
 * plain spaces, zero-width characters and bidirectional overrides are dropped.
 *
 * Runs before every other rule, because a no-break space is not whitespace to a
 * regular expression — leaving one in would defeat the blank-line and
 * indentation detection the rejoin depends on.
 *
 * Code is deliberately *not* protected here. An invisible character inside a
 * pasted code block is exactly the bug this rule exists to remove, and it is
 * the one place where the reader cannot see it at all.
 */
export function normalizeInvisibleCharacters(
  text: string,
  extra: readonly TextRange[] = [],
): TypographyResult {
  const frontmatter = frontmatterRange(text);
  // Link targets and frontmatter values carry the character as part of a name
  // or of data, so a no-break space inside them stays.
  const ranges = indexRanges([
    ...extra,
    ...markdownSyntaxRanges(text),
    ...(frontmatter ? [frontmatter] : []),
  ]);
  const out = text.replace(INVISIBLE, (match, offset: number) => {
    if (ranges.overlaps(offset, offset + match.length)) return match;
    return EXOTIC_SPACE.test(match) ? " " : "";
  });
  return { text: out, changed: out !== text };
}

/** Turns curly quotes and apostrophes into straight ones. */
export function straightenQuotes(
  text: string,
  extra: readonly TextRange[] = [],
): TypographyResult {
  const ranges = protectedForCharacterRules(text, extra);
  const replace = (match: string, offset: number, replacement: string): string =>
    ranges.overlaps(offset, offset + match.length) ? match : replacement;

  const out = text
    .replace(DOUBLE_QUOTES, (match, offset: number) => replace(match, offset, '"'))
    .replace(SINGLE_QUOTES, (match, offset: number) => replace(match, offset, "'"));
  return { text: out, changed: out !== text };
}

/**
 * Turns em and en dashes into hyphens.
 *
 * Runs after the rejoin, never before it: a hyphen is a list marker, so a line
 * opening with a converted long dash would read as a bullet and the paragraph
 * it belongs to would refuse to rejoin — and would then render as a list.
 * A converted dash that still lands at the start of a line is escaped for the
 * same reason.
 */
export function straightenDashes(
  text: string,
  extra: readonly TextRange[] = [],
): TypographyResult {
  const ranges = protectedForCharacterRules(text, extra);

  let out = text.replace(DASHES, (match, offset: number) =>
    ranges.overlaps(offset, offset + match.length) ? match : "-",
  );

  const sourceLines = text.split("\n");
  out = out
    .split("\n")
    .map((line, index) => {
      // The prefix covers blockquote and list markers, matched against the
      // source line where a long dash cannot yet be mistaken for one.
      const opening = new RegExp(
        "^((?: {0,3}>[ \\t]?)* {0,3}(?:[-*+][ \\t]+|\\d{1,9}[.)][ \\t]+)?)[\\u2013\\u2014]",
      ).exec(sourceLines[index] ?? "");
      if (!opening) return line;
      const tail = line.replace(/\r$/, "").slice(opening[1]!.length);
      // One hyphen and a space is a bullet; two or more alone underline the
      // paragraph above as a setext heading.
      if (!/^(?:-(?:[ \t]|$)|-{2,}[ \t]*$)/.test(tail)) return line;
      return `${opening[1]}\\${line.slice(opening[1]!.length)}`;
    })
    .join("\n");

  return { text: out, changed: out !== text };
}

/**
 * Removes blank lines and stray spaces around a paste without touching the
 * blank lines inside it, which are paragraph breaks the writer meant.
 *
 * The leading indent is the subtle one. Four columns in front of the first line
 * is not stray whitespace, it is an indented code block — and stripping it
 * turns code into prose, which the quote and dash rules then rewrite on the
 * *next* pass because the protection went with the indent. Anything under four
 * columns cannot carry that meaning at the start of a paste, so it goes.
 */
export function trimSurroundingWhitespace(text: string): TypographyResult {
  // A blank line may carry spaces, so the run has to be matched as "lines that
  // are blank" rather than as "newlines, then spaces". Written the other way it
  // took two passes to settle on "a\n\n   \n\n", which means the rule
  // disagreed with itself about what it had already done.
  let out = text.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:[ \t]*\n)+[ \t]*$/, "");

  const indent = /^[ \t]*/.exec(out)?.[0] ?? "";
  if (indent && indentColumns(indent) < INDENTED_CODE_COLUMNS) out = out.slice(indent.length);

  out = out.replace(/[ \t]+$/, "");
  return { text: out, changed: out !== text };
}

/** Markdown reads four or more leading columns as a code block. */
const INDENTED_CODE_COLUMNS = 4;

function indentColumns(indent: string): number {
  let columns = 0;
  for (const char of indent) columns += char === "\t" ? INDENTED_CODE_COLUMNS : 1;
  return columns;
}
