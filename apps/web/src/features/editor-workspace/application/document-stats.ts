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

/** A 1-based line/column as the status bar shows it. */
export function formatCursor(cursor: { line: number; col: number }): string {
  return `Ln ${cursor.line}, Col ${cursor.col}`;
}
