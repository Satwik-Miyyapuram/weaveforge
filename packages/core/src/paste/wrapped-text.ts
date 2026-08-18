/**
 * Putting hard-wrapped text back together.
 *
 * Terminals and PDF layouts both break a paragraph at a fixed column and there
 * is nothing in the result that says which breaks were the author's. The rule
 * used here is that a line long enough to have *reached* the wrap column was
 * broken by the margin, and every other break was meant. The wrap column is
 * inferred from the text itself, because it depends on how wide a window
 * happened to be when somebody pressed copy — a number no reader can be asked
 * for.
 *
 * Everything that is structure rather than prose stops a rejoin: headings,
 * lists, tables, fences, block maths, frontmatter, and Markdown's own
 * two-space hard break.
 */

import { markdownCodeRanges, leadingWidth, frontmatterRange, INDENTED_CODE_WIDTH } from "./markdown-ranges.js";
import { overlapsRange, type TextRange } from "./text-range.js";
import { markdownSyntaxRanges } from "./markdown-ranges.js";
import { stripControlSequences } from "./control-characters.js";

/**
 * Characters that open a list item.
 *
 * The en and em dash are deliberately absent: a line opening with a long dash
 * is far more often prose than a bullet, and reading it as a list item both
 * blocks a legitimate rejoin and mangles the sentence.
 */
export const LIST_MARKERS: readonly string[] = [
  "•",
  "‣",
  "▪",
  "▫",
  "▸",
  "◦",
  "·",
  "-",
  "*",
  "+",
];

/** Shortest line a terminal could plausibly have broken. */
export const MIN_WRAP_WIDTH = 60;

/**
 * The same floor for a PDF. A two-column journal layout wraps prose at about
 * 45 characters, so the terminal floor would refuse every rejoin that matters.
 */
export const PDF_MIN_WRAP_WIDTH = 35;

/**
 * How far below the longest line still counts as a full line.
 *
 * A wrapped line falls short of the wrap column by roughly the length of the
 * word that did not fit, while a paragraph's genuinely last line usually falls
 * much further. Twenty-four leaves room for a long word without reaching far
 * enough down to swallow the end of a paragraph.
 */
export const WRAP_TOLERANCE = 24;

export interface WrappedTextOptions {
  /**
   * `any` rejoins every line that looks wrapped, `indented` only those indented
   * past their paragraph's first line, `never` strips and dedents without
   * joining anything.
   */
  rejoin: "any" | "indented" | "never";
  /** `markdown` rewrites bullets such as U+2022 into Markdown list items. */
  bullets: "preserve" | "markdown";
  /** Repairs words the layout hyphenated at a line end. PDF text wants this. */
  mergeHyphens?: boolean;
  /** Collapses the space runs justified text leaves between words. */
  collapseSpaces?: boolean;
  /** Lower bound for the inferred wrap column. */
  minWrapWidth?: number;
  /**
   * Treat a lone `$$` line as a maths delimiter. On for PDF text and prose; off
   * for terminal output, where `$$` is the shell's process id.
   */
  protectMath?: boolean;
}

export interface WrappedTextResult {
  text: string;
  changed: boolean;
}

const NUMBERED_LIST = /^\s*\d{1,9}[.)]\s/;
/** `(a)`, `(12)`, `[3]` or `c)` — how PDF lists number their items. */
const ENUMERATOR = /^\s*(?:\([a-z0-9]{1,4}\)|\[\d{1,4}\]|[a-z0-9]{1,4}\))\s/i;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const BLOCKQUOTE = /^\s{0,3}>/;
const TABLE_ROW = /^\s*\|/;
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FRONTMATTER_FENCE = /^ {0,3}(?:---|\.\.\.)\s*$/;
/** A run of `=` or `-` that turns the line above it into a heading. */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

interface Fence {
  marker: "`" | "~";
  length: number;
  info: string;
}

function fenceOf(line: string): Fence | null {
  const match = /^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker: "`" | "~" = match[1]!.startsWith("`") ? "`" : "~";
  if (marker === "`" && match[2]!.includes("`")) return null;
  return { marker, length: match[1]!.length, info: match[2]! };
}

function closesFence(line: string, opening: Fence): boolean {
  const candidate = fenceOf(line);
  return (
    candidate !== null &&
    candidate.marker === opening.marker &&
    candidate.length >= opening.length &&
    candidate.info.trim() === ""
  );
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** Markdown renders two trailing spaces or a trailing backslash as a hard break. */
function hasHardBreak(line: string): boolean {
  return / {2,}$|\\$/.test(line);
}

/** U+00AD, written as an escape because it is invisible in a source file. */
export const SOFT_HYPHEN = "\u00AD";

/**
 * Every hyphen a layout breaks a word with: ASCII, soft, the Unicode hyphen and
 * the small and fullwidth forms PDF fonts emit.
 */
const HYPHEN_FORMS = "-\\u00AD\\u2010\\uFE63\\uFF0D";
const HYPHEN_AT_END = new RegExp(`[\\p{L}\\d\\p{M}][${HYPHEN_FORMS}]$`, "u");
const HYPHEN_AFTER_DIGIT = new RegExp(`\\d[${HYPHEN_FORMS}]$`, "u");

/**
 * True when a line ends with a word broken at the margin.
 *
 * A letter, digit or combining mark then a hyphen — including the forms PDF
 * fonts emit. U+2011, the non-breaking hyphen, is excluded on purpose: its
 * whole meaning is that the word must *not* break there. Requiring a letter in
 * front keeps `---` out, because a thematic break is not a broken word.
 */
export function endsHyphenated(line: string): boolean {
  return HYPHEN_AT_END.test(line.trimEnd());
}

/**
 * True when the line's last word carries a web address. Such a line never
 * rejoins: a space join buries the break inside the address, and a bare join
 * could fuse an address that really ended there with the next word.
 */
function endsWithUrl(line: string): boolean {
  const trimmed = line.trimEnd();
  return /:\/\/\S*$/.test(trimmed) || /(^|\s)www\.\S+$/i.test(trimmed);
}

/** Scripts that wrap without spaces: Thai, kana, Han and the fullwidth forms. */
const UNSPACED = "\\u0E00-\\u0E7F\\u3000-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF";
const UNSPACED_TAIL = new RegExp(`[${UNSPACED}]$`);
const UNSPACED_HEAD = new RegExp(`^[${UNSPACED}]`);

/**
 * Joins two fragments across a removed break.
 *
 * The hyphen decision is the interesting one. After a digit it is content — a
 * range or a compound such as `10-20` or `5-fold` — so it stays and only the
 * break goes. After a letter it is the layout's own when the word resumes in
 * lowercase, so it goes; in front of a capital it belongs to a compound such as
 * `Navier-Stokes` or `RNA-Seq`, so it stays too. Keeping a hyphen that should
 * have gone is a smaller error than fusing two words that were never one, and
 * far easier to spot.
 */
export function joinFragments(previous: string, fragment: string): string {
  if (endsWithUrl(previous)) return `${previous}\n${fragment}`;
  if (endsHyphenated(previous)) {
    const afterDigit = HYPHEN_AFTER_DIGIT.test(previous);
    const brokenWord = !afterDigit && /^\p{Ll}/u.test(fragment);
    return brokenWord ? previous.slice(0, -1) + fragment : previous + fragment;
  }
  // A dash set tight against its word is a style; joining with a space breaks it.
  if (new RegExp("\\S[\\u2013\\u2014]$").test(previous)) return previous + fragment;
  if (UNSPACED_TAIL.test(previous) && UNSPACED_HEAD.test(fragment)) return previous + fragment;
  return `${previous} ${fragment}`;
}

/** Block maths spans, from a lone `$$` line to its closer. */
function blockMathRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let offset = 0;
  let open = -1;
  for (const line of text.split("\n")) {
    if (line.trim() === "$$") {
      if (open < 0) open = offset;
      else {
        ranges.push({ start: open, end: offset + line.length });
        open = -1;
      }
    }
    offset += line.length + 1;
  }
  return ranges;
}

/**
 * Works out the column the text was wrapped at.
 *
 * When at least two lines cluster near the longest one, that length is the wrap
 * column. A single long line is an outlier rather than evidence, so the floor is
 * used instead — which is also the right answer for text that was never wrapped.
 */
export function inferWrapWidth(lines: readonly string[], floor: number = MIN_WRAP_WIDTH): number {
  // Fenced content is copied verbatim, so one long JSON line inside a log dump
  // must not drag the threshold above the prose the reader wants rejoined.
  const prose: string[] = [];
  let fence: Fence | null = null;
  for (const line of lines) {
    if (fence === null) {
      const opening = fenceOf(line);
      if (opening) {
        fence = opening;
        continue;
      }
      if (!isBlank(line)) prose.push(line);
      continue;
    }
    if (closesFence(line, fence)) fence = null;
  }

  const lengths = prose.map((line) => line.trimEnd().length);
  if (lengths.length < 2) return floor;

  // Reduced rather than spread: a large pasted log would blow the argument limit.
  const longest = lengths.reduce((max, length) => (length > max ? length : max), 0);
  const nearLongest = lengths.filter((length) => length >= longest - WRAP_TOLERANCE).length;
  if (nearLongest < 2) return floor;

  return Math.max(floor, longest - WRAP_TOLERANCE);
}

/** Leading whitespace and blockquote markers, kept verbatim when a line is rewritten. */
function linePrefix(line: string): string {
  return /^(?: {0,3}>[ \t]?)*[ \t]*/.exec(line)?.[0] ?? "";
}

/** The bullet a line opens with, or null. A marker only counts before whitespace. */
function listMarkerOf(line: string): string | null {
  const body = line.slice(linePrefix(line).length);
  for (const marker of LIST_MARKERS) {
    if (body.startsWith(marker) && /\s/.test(body.charAt(marker.length))) return marker;
  }
  return null;
}

/** True when the line is a heading, behind any depth of list or quote markers. */
function isHeadingLine(line: string): boolean {
  return HEADING.test(line.replace(/^(?: {0,3}(?:>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+))*[ \t]*/, ""));
}

/** True when the line opens a block that must not be merged into the paragraph above. */
function startsNewBlock(line: string): boolean {
  return (
    listMarkerOf(line) !== null ||
    NUMBERED_LIST.test(line) ||
    ENUMERATOR.test(line) ||
    HEADING.test(line) ||
    BLOCKQUOTE.test(line) ||
    fenceOf(line) !== null ||
    TABLE_ROW.test(line) ||
    THEMATIC_BREAK.test(line) ||
    FRONTMATTER_FENCE.test(line) ||
    // Joining a setext underline onto the line above erases the heading it makes.
    SETEXT_UNDERLINE.test(line) ||
    leadingWidth(line) >= INDENTED_CODE_WIDTH
  );
}

/** Removes the longest leading whitespace every non-blank line shares. */
export function dedentLines(lines: readonly string[]): string[] {
  const prefixes = lines.filter((line) => !isBlank(line)).map((line) => /^[ \t]*/.exec(line)?.[0] ?? "");
  if (prefixes.length === 0) return [...lines];

  let common = prefixes[0]!;
  for (const prefix of prefixes) {
    while (common.length > 0 && !prefix.startsWith(common)) common = common.slice(0, -1);
    if (common.length === 0) break;
  }
  if (common.length === 0) return [...lines];
  return lines.map((line) => (isBlank(line) ? line : line.slice(common.length)));
}

/** Rewrites a non-Markdown bullet to a dash, keeping the line's indentation. */
function toMarkdownBullet(line: string): string {
  const marker = listMarkerOf(line);
  if (marker === null || marker === "-" || marker === "*" || marker === "+") return line;
  const prefix = linePrefix(line);
  const body = line.slice(prefix.length + marker.length).replace(/^\s+/, "");
  return `${prefix}- ${body}`;
}

function convertBullets(text: string, protectMath: boolean): string {
  const frontmatter = frontmatterRange(text);
  const ranges = [
    ...markdownCodeRanges(text),
    ...(frontmatter ? [frontmatter] : []),
    ...(protectMath ? blockMathRanges(text) : []),
  ];
  let offset = 0;
  return text
    .split("\n")
    .map((line) => {
      const start = offset;
      offset += line.length + 1;
      return overlapsRange(ranges, start, start + 1) ? line : toMarkdownBullet(line);
    })
    .join("\n");
}

/**
 * Collapses the space runs justified text leaves between words. Runs at a line
 * start are indentation and runs at a line end are Markdown hard breaks, so only
 * runs between visible characters collapse — and never inside code, maths,
 * frontmatter or a link target, where one space fewer silently points a
 * wikilink at a different note.
 */
function collapseSpaceRuns(text: string, protectMath: boolean): string {
  const frontmatter = frontmatterRange(text);
  const ranges = [
    ...markdownCodeRanges(text),
    ...markdownSyntaxRanges(text),
    ...(frontmatter ? [frontmatter] : []),
    ...(protectMath ? blockMathRanges(text) : []),
  ];
  return text.replace(/(\S) {2,}(?=\S)/g, (match, before: string, offset: number) =>
    overlapsRange(ranges, offset + 1, offset + match.length) ? match : `${before} `,
  );
}

interface Paragraph {
  lines: string[];
  /** True when the lines pass through untouched. */
  verbatim: boolean;
}

/** Groups lines into paragraphs, continuing one only across a wrap-looking break. */
function groupParagraphs(
  lines: readonly string[],
  options: WrappedTextOptions,
  wrapWidth: number,
): Paragraph[] {
  const requireIndent = options.rejoin === "indented";
  const paragraphs: Paragraph[] = [];
  let current: Paragraph | null = null;
  let fence: Fence | null = null;
  let math = false;

  // Leading frontmatter is data: rejoining a long value with the key below it
  // merges two YAML entries into one. Blank lines in front count as leading,
  // because the trim rule removes them and promotes the block.
  let consumed = 0;
  let opener = 0;
  while (opener < lines.length && isBlank(lines[opener]!)) opener += 1;
  if (lines[opener] !== undefined && /^ {0,3}---\s*$/.test(lines[opener]!)) {
    while (consumed <= opener) paragraphs.push({ lines: [lines[consumed++]!], verbatim: true });
    while (consumed < lines.length) {
      const line = lines[consumed++]!;
      paragraphs.push({ lines: [line], verbatim: true });
      if (FRONTMATTER_FENCE.test(line)) break;
    }
  }

  for (const line of lines.slice(consumed)) {
    if (math) {
      paragraphs.push({ lines: [line], verbatim: true });
      if (line.trim() === "$$") math = false;
      continue;
    }

    if (isBlank(line) && fence === null) {
      current = null;
      // Runs of blank lines collapse here rather than over the rendered text,
      // because a fence's interior blank lines never reach this branch.
      const last = paragraphs[paragraphs.length - 1];
      const lastBlank = last !== undefined && last.verbatim && last.lines.length === 1 && isBlank(last.lines[0]!);
      if (!lastBlank) paragraphs.push({ lines: [line], verbatim: true });
      continue;
    }

    if (fence !== null) {
      paragraphs.push({ lines: [line], verbatim: true });
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    if (options.protectMath === true && line.trim() === "$$") {
      current = null;
      math = true;
      paragraphs.push({ lines: [line], verbatim: true });
      continue;
    }

    const opening = fenceOf(line);
    if (opening) {
      current = null;
      fence = opening;
      paragraphs.push({ lines: [line], verbatim: true });
      continue;
    }

    if (hasHardBreak(line)) {
      current = null;
      paragraphs.push({ lines: [line], verbatim: true });
      continue;
    }

    // A rule or setext underline is complete in itself, also inside a quote.
    // Absorbing the next line would fabricate a heading out of two blocks.
    const unquoted = line.replace(/^(?: {0,3}>[ \t]?)+/, "");
    if (THEMATIC_BREAK.test(unquoted) || SETEXT_UNDERLINE.test(unquoted)) {
      current = null;
      paragraphs.push({ lines: [line], verbatim: true });
      continue;
    }

    // Held in a const so the compiler can narrow it: `current` is reassigned
    // all over this loop, and a nullable let never stays narrowed to the use.
    const active = current;
    const previous = active?.lines[active.lines.length - 1];
    const first = active?.lines[0];

    const continues =
      options.rejoin !== "never" &&
      active !== null &&
      previous !== undefined &&
      first !== undefined &&
      // A heading is complete in itself; absorbing the line below would swallow
      // a paragraph into it.
      !isHeadingLine(first) &&
      !startsNewBlock(line) &&
      !(options.mergeHyphens === true && endsWithUrl(previous)) &&
      // A trailing hyphen is wrap evidence on its own: a layout hyphenates only
      // when the line has reached the margin, so the width test would reject
      // exactly the narrow columns that need the repair most.
      (previous.trimEnd().length >= wrapWidth ||
        (options.mergeHyphens === true && endsHyphenated(previous))) &&
      (!requireIndent || leadingWidth(line) > leadingWidth(first));

    if (continues && active) active.lines.push(line);
    else {
      current = { lines: [line], verbatim: false };
      paragraphs.push(current);
    }
  }

  return paragraphs;
}

/** Joins a paragraph's wrapped lines and drops the indentation the wrap left. */
function renderParagraph(paragraph: Paragraph, options: WrappedTextOptions): string {
  if (paragraph.verbatim) return paragraph.lines.join("\n");

  const first = paragraph.lines[0]!;
  let joined = first.trimEnd();
  for (const line of paragraph.lines.slice(1)) {
    const fragment = line.trim();
    if (options.mergeHyphens !== true) joined = `${joined} ${fragment}`;
    else if (joined.endsWith(SOFT_HYPHEN)) joined = joined.slice(0, -1) + fragment;
    else joined = joinFragments(joined, fragment);
  }

  // With no rejoin the breaks are the layout, so what is left of the
  // indentation after the shared dedent is content too.
  if (options.rejoin === "never") return joined;

  const structural = listMarkerOf(first) !== null || NUMBERED_LIST.test(first);
  if (structural || leadingWidth(first) >= INDENTED_CODE_WIDTH) return joined;
  return joined.replace(/^[ \t]+/, "");
}

/**
 * Strips escape sequences, removes the shared indentation, and rejoins the
 * paragraphs the margin broke.
 *
 * Dedenting, trimming and collapsing blank lines only make sense on text that
 * really came from a terminal or a PDF. Nothing identifies itself as such
 * unless it carried escape sequences or was actually rejoined, so on anything
 * else only the explicitly requested rules run — otherwise this would quietly
 * flatten pasted code, nested lists and Markdown's own line breaks.
 */
export function cleanWrappedText(input: string, options: WrappedTextOptions): WrappedTextResult {
  const normalized = input.replace(/\r\n?/g, "\n");
  const text = stripControlSequences(normalized);
  const hadEscapes = text !== normalized;

  const lines = dedentLines(text.split("\n"));
  const wrapWidth = inferWrapWidth(lines, options.minWrapWidth);
  const paragraphs = groupParagraphs(lines, options, wrapWidth);
  const rejoined = paragraphs.some((paragraph) => !paragraph.verbatim && paragraph.lines.length > 1);

  if (options.rejoin !== "never" && !hadEscapes && !rejoined) {
    let converted = input;
    if (options.bullets === "markdown") converted = convertBullets(converted, options.protectMath === true);
    if (options.collapseSpaces === true) converted = collapseSpaceRuns(converted, options.protectMath === true);
    return { text: converted, changed: converted !== input };
  }

  let output = paragraphs.map((paragraph) => renderParagraph(paragraph, options)).join("\n");
  if (options.bullets === "markdown") output = convertBullets(output, options.protectMath === true);
  if (options.collapseSpaces === true) output = collapseSpaceRuns(output, options.protectMath === true);

  return { text: output, changed: output !== input };
}
