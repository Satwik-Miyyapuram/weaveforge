/** Types for url-safety. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * Which addresses the server is allowed to fetch on a visitor's behalf.
 *
 * Any feature that takes a URL from a person and requests it from the server is
 * a request *from inside the network*, made with the server's credentials and
 * its view of the routing table. `http://169.254.169.254/latest/meta-data/`
 * returns cloud instance credentials; `http://127.0.0.1:5432` reaches the
 * database; `http://10.0.0.5/admin` reaches whatever else is on the subnet. The
 * fetch is the feature, so the fix is not to refuse URLs but to refuse
 * *addresses*.
 *
 * This file is the policy and holds no I/O, so it is the same rules on the
 * server, in the Electron main process and in a test. The caller resolves the
 * hostname and asks about every address it got back, because a name is not an
 * address: `evil.example` resolving to `127.0.0.1` is the whole attack.
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

/**
 * Hostnames that mean "this machine" or "this network" whatever DNS says.
 *
 * Checked before resolution as a cheap first pass; the address check after
 * resolution is what actually holds, since none of these names is required.
 */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".onion"];

/** Limits a fetch on the visitor's behalf runs under. */
export interface OutboundFetchLimits {
  /** Redirect hops followed. Each one is re-checked. */
  maxRedirects: number;
  /** Bytes read before the response is abandoned. */
  maxBytes: number;
  /** Wall-clock budget for the whole fetch, redirects included. */
  timeoutMs: number;
}

/** Enough for a page's head or a figure, not enough to be a download service. */
export const DEFAULT_FETCH_LIMITS: OutboundFetchLimits = {
  maxRedirects: 4,
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 10_000,
};

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface UrlSafetyFns {
  /** Parses a URL, accepting a scheme-less host the way a person would type it. */
  parseUserUrl(input: string): URL | null;
  /**
 * Everything that can be decided from the URL alone.
 *
 * The address check is separate and comes after DNS: this half rejects the
 * obvious, so a caller does no network work for a URL that was never going to
 * be allowed.
 */
  checkUrlShape(input: string | URL): UrlCheck;
  /**
 * True when the string is an IPv4 or IPv6 literal.
 *
 * The IPv6 half is a colon test, which is loose: `not:an:address` counts. That
 * is deliberate and safe in the only direction it is used — a string that looks
 * like IPv6 but is not one fails `expandIpv6` and is refused below, so the
 * looseness can only produce a refusal, never an allowance.
 */
  isIpAddress(value: string): boolean;
  /**
 * True when an address is one the internet can route to somebody else.
 *
 * Everything private, reserved, local or special-purpose is refused, and so is
 * anything unparseable — an address this cannot read is not one to trust.
 */
  isPublicAddress(address: string): boolean;
  /**
 * Expands an IPv6 address to its eight groups, or null when it is not one.
 *
 * Written out rather than pattern-matched on the text, because `URL` normalises
 * what it is given: `[::ffff:127.0.0.1]` comes back as `::ffff:7f00:1`, and a
 * check that looked for the dotted form let loopback straight through.
 */
  expandIpv6(value: string): number[] | null;
}
