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
