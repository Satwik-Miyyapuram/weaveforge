import type { CommentAnchor } from "@weaveforge/core";

/**
 * Pinning a comment to a passage of text that keeps changing.
 *
 * An anchor is the passage itself plus up to {@link CONTEXT} characters either
 * side. Finding it again means finding every place the quote occurs and taking
 * the one whose surroundings agree best — so a word that appears five times is
 * still pinned to the right one, and an edit elsewhere in the note moves nothing.
 * When the quote is gone the anchor is gone: the comment is shown as detached
 * rather than pinned to whatever now sits at its old offset.
 */
export const CONTEXT = 32;

export interface TextSpan {
  start: number;
  end: number;
}

/** The anchor for `text.slice(start, end)`, or null for an empty or blank span. */
export function anchorAt(text: string, start: number, end: number): CommentAnchor | null {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(text.length, Math.max(start, end));
  const quote = text.slice(from, to);
  if (!quote.trim()) return null;
  return {
    quote,
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
  };
}

/** Where `anchor` is in `text` now, or null when its quote no longer occurs. */
export function locateAnchor(text: string, anchor: CommentAnchor): TextSpan | null {
  if (!anchor.quote) return null;
  let best: TextSpan | null = null;
  let bestScore = -1;
  for (let at = text.indexOf(anchor.quote); at !== -1; at = text.indexOf(anchor.quote, at + 1)) {
    const end = at + anchor.quote.length;
    const score =
      sharedSuffix(text.slice(Math.max(0, at - anchor.prefix.length), at), anchor.prefix) +
      sharedPrefix(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    if (score > bestScore) {
      best = { start: at, end };
      bestScore = score;
    }
  }
  return best;
}

function sharedSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function sharedPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}
