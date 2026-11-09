/** Types for page-title. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

const NAMED_ENTITIES: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

/**
 * Titles a site shows a robot rather than a reader.
 *
 * A challenge page answers 200 with a perfectly ordinary `<title>`, so without
 * this a pasted link becomes `[Just a moment…](…)` — which is worse than the
 * bare URL, because it looks like it worked.
 */
const BOT_WALL =
  /^\s*(?:just a moment|attention required|access denied|client challenge|verifying your browser|are you a robot|checking your browser|please wait|security check|redirecting|error \d{3}|\d{3} (?:forbidden|not found))\b/i;

/** Longer than this is a page dumping its whole description into the title. */
const MAX_TITLE = 300;

/**
 * How much of a document is worth scanning for a title.
 *
 * A `<title>` lives in the head. Exported so the caller that *decodes* the bytes
 * can stop at the same place this stops looking — decoding half a megabyte to
 * read a few dozen bytes at the top is work nobody asked for, and a page with a
 * large inline script before its `<title>` makes it measurable.
 */
export const PAGE_TITLE_SCAN_CHARS = 200_000;

export interface PageTitle {
  title: string;
  /** True when the title looks like a challenge page rather than the article. */
  suspect: boolean;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface PageTitleFns {
  /**
 * The named entities a title actually contains, plus numeric escapes.
 *
 * One pass, so what an entity decodes to is never read again: `&amp;lt;` and
 * `&#38;lt;` both stay `&lt;`. Unknown names are left as written.
 */
  decodeHtmlEntities(value: string): string;
  /**
 * The best title the HTML offers.
 *
 * OpenGraph first, because a site that sets it has said what the page should be
 * called when somebody links to it — which is exactly the question being asked
 * here. `<title>` is the fallback, and it often carries the site name as a
 * suffix, which is left alone: guessing which half is the separator gets the
 * wrong answer on any title with a dash in it.
 */
  extractPageTitle(html: string): PageTitle | null;
  /**
 * True when a URL's own path says it points at an image (Rust `looks_like_image_url`).
 *
 * Used to decide whether a pasted link is a picture worth downloading. Browser
 * only: it needs the loaded wasm module, which the browser shell registers.
 */
  looksLikeImageUrl(url: string): boolean;
}
