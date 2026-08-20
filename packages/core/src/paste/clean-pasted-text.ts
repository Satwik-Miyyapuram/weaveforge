/**
 * The paste pipeline.
 *
 * Order matters more than any single rule here, and the reasons are all
 * interference between rules:
 *
 *  1. Invisible characters first, because a no-break space is not whitespace to
 *     a regular expression, and one left in place defeats every blank-line and
 *     indentation test that follows.
 *  2. Links next, while the text still has the exact spelling that was copied.
 *  3. The wrap repair, which needs line structure intact.
 *  4. Dashes last, because a hyphen is a list marker: converting a leading long
 *     dash before step 3 turns a wrapped sentence into a list item.
 *
 * Nothing here fetches anything. A paste is synchronous — the reader is
 * watching the caret — so every rule is a pure function of the clipboard text
 * and the settings.
 */

import { cleanUrlsInText, buildUrlCleanupOptions, httpUrlRanges } from "./url-cleanup.js";
import {
  normalizeInvisibleCharacters,
  straightenDashes,
  straightenQuotes,
  trimSurroundingWhitespace,
} from "./typography.js";
import { cleanPdfText } from "./pdf-text.js";
import { tabSeparatedToMarkdownTable } from "./tabular-text.js";
import { linkScholarlyIdentifiers } from "./scholarly-links.js";
import { stripControlSequences } from "./control-characters.js";
import { markdownCodeRanges } from "./markdown-ranges.js";
import { DEFAULT_PASTE_SETTINGS, type PasteSettings } from "./paste-settings.js";

export interface CleanPasteResult {
  text: string;
  changed: boolean;
  /** How many links were shortened, for a caller that wants to say so. */
  urlsCleaned: number;
}

/**
 * A paste that never gets cleaned.
 *
 * Inside a fenced block, an inline code span or frontmatter, the pasted text is
 * being shown rather than written, and every rule in this folder would be
 * changing the evidence. The caller passes the character offset the paste lands
 * at, together with the document it lands in.
 */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean {
  if (markdownCodeRanges(document).some((range) => offset > range.start && offset < range.end)) {
    return true;
  }
  // Frontmatter is checked by line rather than by the block range, so that a
  // paste at the very end of an unclosed opening block counts too.
  const before = document.slice(0, offset);
  if (!/^ {0,3}---[ \t]*(\n|$)/.test(document)) return false;
  const fences = before.split("\n").filter((line) => /^ {0,3}(?:---|\.\.\.)[ \t]*$/.test(line)).length;
  return fences === 1;
}

/** Runs the automatic rules a paste is entitled to under `settings`. */
export function cleanPastedText(
  input: string,
  settings: PasteSettings = DEFAULT_PASTE_SETTINGS,
): CleanPasteResult {
  if (!settings.cleanOnPaste) return { text: input, changed: false, urlsCleaned: 0 };

  let text = input.replace(/\r\n?/g, "\n");
  let urlsCleaned = 0;

  if (settings.stripEscapeSequences) text = stripControlSequences(text);

  if (settings.normalizeInvisible) text = normalizeInvisibleCharacters(text).text;

  // Before the line-based rules: a spreadsheet's rows are already a structure,
  // and the wrap repair would try to rejoin them into a paragraph. After the
  // invisible-character pass, because a cell can carry a no-break space and a
  // ragged row would then be rejected for the wrong reason.
  if (settings.tabsToTable) text = tabSeparatedToMarkdownTable(text).text;

  if (settings.cleanLinks) {
    const result = cleanUrlsInText(text, buildUrlCleanupOptions(settings.linkRemovals));
    text = result.text;
    urlsCleaned = result.count;
  }

  if (settings.cleanPdfOnPaste && looksLikePdfText(text)) {
    text = cleanPdfText(text, { removePageNumbers: false, singleParagraph: false }).text;
  }

  // A URL is a name, so neither character rule may reach into one — a curly
  // quote inside a query is part of the value, and an en dash in a slug is part
  // of the path.
  let urls = httpUrlRanges(text);

  // After the link cleaning and before the character rules: the URL ranges tell
  // it which identifiers are already inside a link, and the links it writes are
  // then protected from the dash rule like any other.
  if (settings.linkIdentifiers) {
    const linked = linkScholarlyIdentifiers(text, urls);
    if (linked.count > 0) {
      text = linked.text;
      urls = httpUrlRanges(text);
    }
  }

  if (settings.straightenQuotes) text = straightenQuotes(text, urls).text;
  if (settings.straightenDashes) text = straightenDashes(text, urls).text;

  if (settings.trimWhitespace) text = trimSurroundingWhitespace(text).text;

  return { text, changed: text !== input, urlsCleaned };
}

/**
 * A guess at whether text came out of a PDF, used only when the reader has
 * asked for the repair to run on every paste.
 *
 * The evidence is a ligature glyph, a soft hyphen, or several short lines in a
 * row where at least one ends with a hyphen. Prose that a person typed has none
 * of those; prose a PDF wrapped has all three.
 */
export function looksLikePdfText(text: string): boolean {
  if (new RegExp("[\\uFB00-\\uFB06\\u00AD]").test(text)) return true;

  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 3) return false;

  const hyphenated = lines.filter((line) => /[\p{L}]-$/u.test(line.trimEnd())).length;
  if (hyphenated === 0) return false;

  const lengths = lines.map((line) => line.trimEnd().length);
  const longest = lengths.reduce((max, length) => (length > max ? length : max), 0);
  // A wrapped column: the lines cluster at one width rather than varying freely.
  const nearLongest = lengths.filter((length) => length >= longest - 12).length;
  return longest <= 110 && nearLongest >= lines.length / 2;
}
