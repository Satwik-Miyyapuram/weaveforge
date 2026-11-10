/**
 * A paper kept as a web page: the constants that frame it for reading.
 *
 * Some papers have no PDF anyone may read but a full text on the web — arXiv's
 * HTML rendering, PubMed Central, an open-access journal's article page. The
 * reader fetches that page once (see `find-free-copy.ts`), keeps the sanitised
 * article (`sanitize-paper-html.ts`) and shows it in a sandboxed frame with no
 * scripts, no same-origin access and no network beyond images.
 *
 * The document format, the text-length test and the parsing are in the Rust
 * core (`buildPaperHtmlDocument`, `parsePaperHtmlDocument`,
 * `isSubstantialPaperText`). The thresholds and the frame CSP stay here.
 */

/**
 * How much text a page must carry to count as the paper.
 *
 * A landing page with only the abstract is a few hundred words; the shortest
 * full papers are several thousand characters. Below this a page is taken for
 * the landing page it probably is, and the next candidate is tried.
 */
export const MIN_PAPER_TEXT_CHARS = 5000;

/**
 * A paper that *is* a web page — a blog post, an essay, a lab's write-up — has
 * no longer full text elsewhere to hold out for, and a good post can be short.
 * Its own page is kept when it has at least this much text; anything less is a
 * teaser or an index page.
 */
export const MIN_ARTICLE_TEXT_CHARS = 1500;

/**
 * The frame's own policy, on top of the page's: images from https and inline
 * data only, the reader's inline stylesheet, nothing else — no scripts, no
 * fetches, no fonts, no frames. The iframe's `sandbox` already stops scripts;
 * this is the second lock on the same door.
 */
export const PAPER_HTML_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; media-src https:";
