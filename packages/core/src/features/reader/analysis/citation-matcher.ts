/**
 * Match one page's citations and map them back to real PDF rectangles.
 *
 * The pipeline is the reference Scholar reader's, ported verbatim: the text
 * candidates (`[12]`, "Smith et al. 2019") are the mentions, the document's
 * own internal links only *support* them, and what the links name that no
 * candidate claims is coalesced with its neighbours. That is what keeps an
 * author-year citation hyperref set as two boxes — `Kingma & Welling` and
 * `(2014)` — one citation rather than two.
 */

import type { PageTextItem } from "../../../reader/selection-to-anchor.js";
import type { CitationMention, PageTextRange, ParsedReference, PdfLink } from "./analysis-types.js";
import type { OutlineTextItem } from "../outline-from-text.js";
import { nativeCitationMentions } from "./pdf-links.js";
import { findCitationCandidates, findPatternCitationMentions } from "./citations.js";
import { assemblePageCitations } from "./citation-assembly.js";

export interface PageCitationInput {
  number: number;
  text: string;
  /** Raw pdf.js items — geometry, superscript sizes. */
  items: readonly PageTextItem[];
  /** The same runs as outline items, for the pattern finder. */
  outlineItems: readonly OutlineTextItem[];
  links?: readonly PdfLink[];
}

/**
 * One page's citations, as the reference reader assembles them: the native
 * links read as support, the pattern finder's mentions, and the two combined
 * over the text candidates. `referenceRanges` are the bibliography's own
 * spans, where nothing is a citation.
 */
export function matchPageCitations(
  page: PageCitationInput,
  references: readonly ParsedReference[],
  referenceRanges: readonly PageTextRange[] = [],
): CitationMention[] {
  const analyzePage = { pageNumber: page.number, items: page.items, links: page.links ?? [] };
  const native = nativeCitationMentions(analyzePage, references, referenceRanges);
  // Both steps walk the same text candidates; find them once per page.
  const candidates = findCitationCandidates(page.items);
  const patterns = findPatternCitationMentions(
    { number: page.number, items: page.items, text: page.text },
    references,
    referenceRanges,
    candidates,
  );
  return assemblePageCitations(analyzePage, native, patterns, referenceRanges, candidates);
}
