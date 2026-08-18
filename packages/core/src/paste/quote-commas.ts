/**
 * Comma placement next to a closing quotation mark.
 *
 * American style puts the comma inside the quotation and British style puts it
 * outside; journals disagree and a thesis has to pick one. Neither is a default
 * worth imposing, so this only runs when a writer asks for it on a selection.
 *
 * The guards are what make it safe. A comma next to a quote is far more often
 * data than prose — CSV fields, JSON objects, a list of quoted words — and
 * moving one there corrupts the value silently.
 */

import { markdownCodeRanges, mathRanges, markdownSyntaxRanges, frontmatterRange } from "./markdown-ranges.js";
import { indexRanges } from "./text-range.js";

export type CommaPlacement = "inside" | "outside";

export interface CommaPlacementResult {
  text: string;
  changed: boolean;
}

/** Moves commas to the chosen side of a closing double quote. */
export function applyCommaPlacement(input: string, placement: CommaPlacement): CommaPlacementResult {
  const frontmatter = frontmatterRange(input);
  const ranges = indexRanges([
    ...markdownCodeRanges(input),
    ...mathRanges(input),
    ...markdownSyntaxRanges(input),
    ...(frontmatter ? [frontmatter] : []),
  ]);

  const pattern = placement === "inside" ? /["”],/g : /,["”]/g;
  const text = input.replace(pattern, (match, offset: number) => {
    if (ranges.overlaps(offset, offset + match.length)) return match;

    // Quoted prose must end right before the match: for `inside` the quote has
    // to close a word, for `outside` the comma has to follow one. A digit does
    // not count — a straight quote after a number is an inch mark or an
    // attribute value, not a quotation.
    if (!/[\p{L}\p{M}]/u.test(input[offset - 1] ?? "")) return match;

    // Only mid-sentence, where a plain space follows. A quote or comma next
    // means CSV fields, a tab means a TSV row, a line end means a row of
    // either, and a letter means a missing space before a new quotation.
    if (input[offset + match.length] !== " ") return match;

    // A quote or bracket after that space reads as the next value in
    // single-line JSON just as well as an enumeration of quoted words.
    if (/["“”[{]/.test(input[offset + match.length + 1] ?? "")) return match;

    // A straight quote has no direction, so it only closes a quotation when an
    // earlier one on the line opened it. Without that the match sits at a field
    // boundary, as in: name," John Smith",age
    const quote = placement === "inside" ? match[0]! : match[1]!;
    if (quote === '"') {
      let open = false;
      for (let index = input.lastIndexOf("\n", offset - 1) + 1; index < offset; index++) {
        if (input[index] === '"') open = !open;
      }
      if (!open) return match;
    }

    return placement === "inside" ? `,${match[0]}` : `${match[1]},`;
  });

  return { text, changed: text !== input };
}
