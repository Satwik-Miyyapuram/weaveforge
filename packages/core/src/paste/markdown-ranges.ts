/**
 * The parts of a Markdown document that are syntax, data or verbatim content
 * rather than prose.
 *
 * WeaveForge notes are not plain prose: they carry `[[wikilinks]]` that resolve
 * to real rows, `\cite{}` keys that an export turns into a bibliography, LaTeX
 * maths, and YAML frontmatter the app reads back. Every one of those is a place
 * where a typography rule would be destructive rather than tidy, so they are
 * mapped once here and every rule consults the map.
 */

import { indexRanges, mergeRanges, type TextRange } from "./text-range.js";

/** Markdown treats four or more leading spaces as an indented code block. */
export const INDENTED_CODE_WIDTH = 4;

interface Fence {
  marker: "`" | "~";
  length: number;
}

/** The fence a line opens or closes, or null when it is not a fence line. */
function fenceOf(line: string): Fence | null {
  const match = /^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker: "`" | "~" = match[1]!.startsWith("`") ? "`" : "~";
  // An info string may not contain a backtick on a backtick fence, otherwise
  // `` `a` `` in prose would open one.
  if (marker === "`" && match[2]!.includes("`")) return null;
  return { marker, length: match[1]!.length };
}

/** A closing fence uses the opening marker and is at least as long. */
function closes(line: string, opening: Fence): boolean {
  const candidate = fenceOf(line);
  if (!candidate) return false;
  const rest = /^(?: {0,3}>[ \t]?)* {0,3}(?:`{3,}|~{3,})(.*)$/.exec(line)?.[1] ?? "";
  return candidate.marker === opening.marker && candidate.length >= opening.length && rest.trim() === "";
}

/** True when an odd run of backslashes escapes the character at `index`. */
function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashes += 1;
  return slashes % 2 === 1;
}

/** Backtick code spans on one line. A span never crosses a line break. */
function inlineCodeRanges(line: string, lineStart: number, into: TextRange[]): void {
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== "`" || isEscaped(line, index)) continue;

    let openLength = 1;
    while (line[index + openLength] === "`") openLength += 1;

    let search = index + openLength;
    let closed = false;
    while (search < line.length) {
      const candidate = line.indexOf("`", search);
      if (candidate < 0) break;
      let closeLength = 1;
      while (line[candidate + closeLength] === "`") closeLength += 1;
      // A closing run has to be exactly as long, so ``a ` b`` keeps its inner tick.
      if (!isEscaped(line, candidate) && closeLength === openLength) {
        into.push({ start: lineStart + index, end: lineStart + candidate + closeLength });
        index = candidate + closeLength - 1;
        closed = true;
        break;
      }
      search = candidate + closeLength;
    }
    // An unclosed run is literal text, so only the run itself is skipped.
    if (!closed) index += openLength - 1;
  }
}

/**
 * Everything Markdown renders as code: fenced blocks with their fences,
 * indented blocks, and inline backtick spans.
 *
 * An indented block only counts after a blank line, because an indented line
 * under a paragraph or a list item is a continuation of it, not code.
 */
export function markdownCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: { opening: Fence; start: number } | null = null;
  let indented: { start: number; end: number } | null = null;
  let previousBlank = true;

  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1;
    const blank = line.trim().length === 0;

    if (fence) {
      if (closes(line, fence.opening)) {
        ranges.push({ start: fence.start, end });
        fence = null;
      }
      previousBlank = false;
      continue;
    }

    const opening = fenceOf(line);
    if (opening) {
      if (indented) {
        ranges.push(indented);
        indented = null;
      }
      fence = { opening, start };
      previousBlank = false;
      continue;
    }

    const indentWidth = leadingWidth(line);
    if (!blank && indentWidth >= INDENTED_CODE_WIDTH && (previousBlank || indented)) {
      indented = indented ? { start: indented.start, end } : { start, end };
      previousBlank = false;
      continue;
    }
    if (indented && blank) {
      // A blank line inside an indented block does not end it; the next
      // non-indented line does. The range is only extended once that is known.
      previousBlank = true;
      continue;
    }
    if (indented) {
      ranges.push(indented);
      indented = null;
    }

    inlineCodeRanges(line, start, ranges);
    previousBlank = blank;
  }

  // An unclosed fence protects to the end of the text: a half-pasted block is
  // still code, and rewriting its tail is the worst possible reading.
  if (fence) ranges.push({ start: fence.start, end: text.length });
  if (indented) ranges.push(indented);

  return mergeRanges(ranges);
}

/** Visual indent width, counting a tab as four columns. */
export function leadingWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += INDENTED_CODE_WIDTH;
    else break;
  }
  return width;
}

/**
 * The leading YAML frontmatter block, including both `---` lines.
 *
 * Leading blank lines are skipped before looking, because the trim rule removes
 * them later — which promotes the block to real frontmatter once the text lands
 * in a note, and a value rewritten before that lands wrong.
 */
export function frontmatterRange(text: string): TextRange | null {
  const prefix = new RegExp("^[\\s\\u00AD\\u200B\\uFEFF]*").exec(text)?.[0].length ?? 0;
  const body = text.slice(prefix);
  if (!/^ {0,3}---[ \t]*(\n|$)/.test(body)) return null;
  const closer = /\n {0,3}(?:---|\.\.\.)[ \t]*(?=\n|$)/.exec(body);
  if (!closer) return null;
  return { start: prefix, end: prefix + closer.index + closer[0].length };
}

/**
 * LaTeX maths, block and inline.
 *
 * This is the range that matters most in a research vault and has no equivalent
 * in a general note-taker: `$\alpha - \beta$` is subtraction and `$x'$` is a
 * prime, so the dash and quote rules must not reach inside. Inline maths is
 * recognised conservatively — same line, no space just inside the delimiters,
 * and at least one non-digit — so that "$5 to $10" stays prose.
 */
export function mathRanges(text: string): TextRange[] {
  const blocks: TextRange[] = [];
  const block = /\$\$[\s\S]*?\$\$/g;
  for (let match = block.exec(text); match; match = block.exec(text)) {
    blocks.push({ start: match.index, end: match.index + match[0].length });
  }

  // Indexed, not scanned. Inline matches cannot overlap each other — the regex
  // only moves forward — so the only question is whether one sits inside a
  // block, and a document can hold tens of thousands of both.
  const inBlock = indexRanges(blocks);
  const inline: TextRange[] = [];
  const pattern = /\$(?![\s$])((?:\\.|[^\\$\n])*?)(?<![\s$])\$/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (inBlock.overlaps(start, end)) continue;
    // Currency runs like "$5" or "$1,200" have nothing else in them.
    if (/^[\d.,\s]*$/.test(match[1]!)) continue;
    inline.push({ start, end });
  }

  return mergeRanges([...blocks, ...inline]);
}

/**
 * Link and citation syntax whose text is a name or a key rather than prose:
 * wikilinks, Markdown link destinations, HTML tags, and the LaTeX citation and
 * reference commands the report export depends on.
 */
export function markdownSyntaxRanges(text: string): TextRange[] {
  const patterns = [
    // [[Note name|alias]] and ![[embed]]
    /!?\[\[[^\][\n]+\]\]/g,
    // ](destination "optional title"), allowing one nested paren for paths
    /\]\(\s*(?:<[^>\n]*>|(?:[^()\s\n]|\([^()\s\n]*\))*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/g,
    // <a href="...">, <img …>
    /<\/?[A-Za-z][^<>\n]*>/g,
    // \cite{key}, \ref{fig:1}, \label{…}, \includegraphics{…}
    /\\[A-Za-z@]+(?:\[[^\]\n]*\])?\{[^{}\n]*\}/g,
    // [@pandoc-key] and [^footnote]
    /\[[@^][^\]\n]+\]/g,
    // A reference definition's target: [label]: https://…
    /^ {0,3}\[[^\]\n]+\]:[ \t]*\S+.*$/gm,
  ];

  const ranges: TextRange[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return mergeRanges(ranges);
}

/**
 * Everything a prose rule must leave alone: code, maths, frontmatter and link
 * or citation syntax. Rules that need a different set build their own from the
 * parts above.
 */
export function protectedProseRanges(text: string): TextRange[] {
  const frontmatter = frontmatterRange(text);
  return mergeRanges([
    ...markdownCodeRanges(text),
    ...mathRanges(text),
    ...markdownSyntaxRanges(text),
    ...(frontmatter ? [frontmatter] : []),
  ]);
}

export type { TextRange };
