/** URL safety and page-title Rust function signatures. */

/* Net: URL and address checks and fetch limits (Rust url_safety); page titles (Rust page_title). */

/**
 * Which addresses the server is allowed to fetch on a visitor's behalf.
 *
 * Refuse addresses, not URLs: `http://169.254.169.254/` returns cloud instance
 * credentials and `http://127.0.0.1:5432` reaches the database. A name is not an
 * address, so callers resolve the hostname and check every address it returns.
 */

/** Why a URL was refused. Phrased for a person, not a log. */
export type UrlRejection =
  | "not-a-url"
  | "scheme"
  | "credentials"
  | "port"
  | "private-address"
  | "hostname";

export interface UrlCheck {
  ok: boolean;
  reason?: UrlRejection;
}

/** Limits a fetch on the visitor's behalf runs under (Rust `DEFAULT_FETCH_LIMITS`). */
export interface OutboundFetchLimits {
  /** Redirect hops followed. Each one is re-checked. */
  maxRedirects: number;
  /** Bytes read before the response is abandoned. */
  maxBytes: number;
  /** Wall-clock budget for the whole fetch, redirects included. */
  timeoutMs: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface UrlSafetyFns {
  /** Parses a URL, accepting a scheme-less host the way a person would type it. */
  parseUserUrl(input: string): URL | null;
  /** Everything that can be decided from the URL alone. The address check comes after DNS. */
  checkUrlShape(input: string | URL): UrlCheck;
  /** True when the string is an IPv4 or IPv6 literal. */
  isIpAddress(value: string): boolean;
  /** True when an address is one the internet can route to somebody else. Unreadable is refused. */
  isPublicAddress(address: string): boolean;
  /** Expands an IPv6 address to its eight groups, or null when it is not one. */
  expandIpv6(value: string): number[] | null;
  /** The caps on an outbound fetch, read at call time. */
  fetchLimits(): OutboundFetchLimits;
}

/** The best title a page offers. `suspect` marks a challenge page rather than the article. */
export interface PageTitle {
  title: string;
  /** True when the title looks like a challenge page rather than the article. */
  suspect: boolean;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface PageTitleFns {
  /** The named entities a title contains plus numeric escapes, decoded in one pass. */
  decodeHtmlEntities(value: string): string;
  /** The best title the HTML offers: OpenGraph first, then `<title>`. */
  extractPageTitle(html: string): PageTitle | null;
  /** True when a URL's own path says it points at an image. Browser only (needs the loaded wasm). */
  looksLikeImageUrl(url: string): boolean;
  /** How much of a document the title scan reads, so the decoder stops at the same place. */
  pageTitleScanChars(): number;
}
