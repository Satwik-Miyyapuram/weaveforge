/**
 * Document statistics for the status bar.
 *
 * Deliberately not a markdown parse. What a writer wants from "words" in a
 * document they are typing into is the number of things they have written,
 * including the frontmatter they just edited — a count that excludes half the
 * file is a number that keeps disagreeing with the file on disk. The one thing
 * that *is* excluded is whitespace, because a blank line is not a word.
 *
 * Pure and cheap enough to run on every keystroke: the status bar reports what
 * the pane last handed it, and the pane hands it the body it already has.
 */

export interface BodyStats {
  words: number;
  chars: number;
}

export function bodyStats(body: string): BodyStats {
  const chars = body.length;
  const words = body.split(/\s+/).filter((token) => token.length > 0).length;
  return { words, chars };
}

/** A count as the status bar shows it: thousands separated by a thin space. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US").replace(/,/g, "\u2009");
}

/** Silent-reading pace used for the estimate, in words per minute. */
const WORDS_PER_MINUTE = 238;

/** The word segment: "1 word", "12 words", plus a reading time once there is text. */
export function formatWords(words: number): string {
  const count = `${formatCount(words)} ${words === 1 ? "word" : "words"}`;
  if (words <= 0) return count;
  return `${count} · ${Math.ceil(words / WORDS_PER_MINUTE)} min read`;
}

/** A 1-based line/column as the status bar shows it. */
export function formatCursor(cursor: { line: number; col: number }): string {
  return `Ln ${cursor.line}, Col ${cursor.col}`;
}
