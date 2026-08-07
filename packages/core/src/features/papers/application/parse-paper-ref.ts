/**
 * Reference parsing — turns whatever the researcher pasted into a `PaperRef`.
 *
 * People paste what they have: an abs page, a PDF link, `arXiv:2305.12345`,
 * `doi:10.1145/…`, a doi.org URL, a bare id. The picker in the add form says
 * what *kind* they think it is; this decides what it actually is, so a DOI URL
 * dropped in the arXiv box still resolves instead of erroring.
 *
 * Zotero keys are never re-classified: they are opaque 8-character strings with
 * no structure to detect, so a wrong guess there would silently pick the wrong
 * source.
 */

import type { PaperRef } from "./metadata-source.js";

/** A DOI anywhere in the text — `10.1145/3592979`, doi.org URLs, `doi:` forms. */
const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/;

/**
 * An arXiv id: modern `2305.12345` (optional `v2`), or legacy `cs.LG/0501001`.
 * Anchored forms only — a bare number inside some other URL is not an id.
 */
const ARXIV_URL_RE =
  /arxiv\.org\/(?:abs|pdf)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?(?:\.pdf)?/i;
const ARXIV_PREFIXED_RE =
  /\barxiv\s*[:\s]\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i;
const ARXIV_BARE_RE = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?$/i;

/**
 * A scheme-less URL: dotted host with an alphabetic TLD, optional path, no
 * whitespace. The alphabetic-TLD requirement is what keeps a bare arXiv id
 * (`2306.09643`) from being read as a hostname.
 */
const HOSTLIKE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i;

/**
 * Extract an arXiv id from a URL, an `arXiv:` prefixed string, or a bare id.
 * The version suffix is dropped: the API resolves the latest version, and
 * keeping `v2` would defeat dedupe against the same paper stored as `v1`.
 */
export function normalizeArxivId(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const m = ARXIV_URL_RE.exec(text) ?? ARXIV_PREFIXED_RE.exec(text) ?? ARXIV_BARE_RE.exec(text);
  return m?.[1];
}

/**
 * Extract a DOI from a URL, a `doi:` prefixed string, or a bare DOI.
 * Trailing punctuation picked up from prose or a copied citation is trimmed.
 */
export function extractDoi(value?: string): string | undefined {
  if (!value) return undefined;
  let text = value.trim();
  if (!text) return undefined;
  try {
    text = decodeURIComponent(text);
  } catch {
    /* keep the raw text — a stray '%' is not worth failing the parse over */
  }
  const m = DOI_RE.exec(text)?.[0];
  return m?.replace(/[).,;]+$/, "").toLowerCase();
}

/**
 * Decide what a pasted reference really is.
 *
 * arXiv wins over DOI when both are present: an arXiv abs URL can carry the
 * published DOI, and the arXiv API answers with the abstract while Crossref
 * often does not.
 */
export function parsePaperRef(kind: PaperRef["kind"], value: string): PaperRef {
  const text = value.trim();
  if (kind === "zotero") return { kind, value: text };

  const arxivId = normalizeArxivId(text);
  if (arxivId) return { kind: "arxiv", value: arxivId };

  const doi = extractDoi(text);
  if (doi) return { kind: "doi", value: doi };

  if (/^https?:\/\//i.test(text)) return { kind: "url", value: text };
  // `example.com/paper`, `www.nature.com/articles/…` — a URL missing its
  // scheme. Assumed https: a site still on http will redirect, and guessing
  // http first would downgrade every https site to a plaintext round trip.
  // Kind-independent: a link pasted into the arXiv or DOI box is still a link.
  if (HOSTLIKE_RE.test(text)) return { kind: "url", value: `https://${text}` };
  return { kind, value: text };
}
