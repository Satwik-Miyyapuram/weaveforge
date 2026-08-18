/**
 * Stripping the tracking off links in a paste.
 *
 * Two halves, and the first is the harder one: finding where a URL in prose
 * actually ends. A greedy match swallows the full stop that ended the sentence,
 * the bracket that wrapped the link, and the `[[` of a wikilink pasted straight
 * behind it. Every trim here hands the cut text back verbatim, so a URL this
 * file declines to shorten comes out exactly as it went in.
 */

import { markdownCodeRanges } from "./markdown-ranges.js";
import { indexRanges, type TextRange } from "./text-range.js";
import {
  matchesParameterPattern,
  SIGNED_URL_PARAMETER_SETS,
  SITE_PARAMETER_REMOVALS,
  TRACKING_PARAMETERS,
  type SiteParameterRemoval,
} from "./tracking-parameters.js";

/** What to remove, once the built-in lists and the user's rules are merged. */
export interface UrlCleanupOptions {
  /** Names removed on every host. */
  globalParameters: readonly string[];
  /** Per-host rules. */
  siteRemovals: readonly SiteParameterRemoval[];
}

/**
 * Permissive by design: trailing punctuation is trimmed afterwards, which is
 * far more reliable than trying to say "not sentence-final punctuation" inside
 * the pattern.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"`\\]+/gi;

/** Punctuation that is almost always the sentence's, not the URL's. */
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", '"', "'", "`"]);

/** Closing brackets that belong to the URL only if it also opened them. */
const BRACKET_PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };

/**
 * A wikilink or Markdown link opener ends a URL. Without this a link pasted
 * flush in front of `[[Note]]` swallows the wikilink and deletes it when the
 * query is rewritten.
 */
const LINK_OPENER = /\[\[|\[(?:[^\][]|\[[^\][]*\])*\]\(/;

/** Index of the first closing bracket with no earlier opening partner, or -1. */
function unmatchedCloser(url: string): number {
  const depth = new Map<string, number>();
  for (const opener of Object.values(BRACKET_PAIRS)) depth.set(opener, 0);
  for (let index = 0; index < url.length; index++) {
    const char = url[index]!;
    if (depth.has(char)) {
      depth.set(char, depth.get(char)! + 1);
      continue;
    }
    const opener = BRACKET_PAIRS[char];
    if (!opener) continue;
    const open = depth.get(opener) ?? 0;
    if (open === 0) return index;
    depth.set(opener, open - 1);
  }
  return -1;
}

/** Where a URL match really ends, and whether shortening it would be a guess. */
export interface UrlBoundary {
  url: string;
  /**
   * True when the cut reads as URL data just as well as prose. Such a URL is
   * left uncleaned rather than corrupted under whichever reading is wrong.
   */
  ambiguous: boolean;
}

/** Cuts a greedy match down to where the URL ends. */
export function urlBoundary(match: string): UrlBoundary {
  let cut = match.length;
  let ambiguous = false;

  const closer = unmatchedCloser(match);
  if (closer !== -1) cut = closer;

  const opener = LINK_OPENER.exec(match);
  if (opener && opener.index < cut) {
    cut = opener.index;
    // `[[` behind a query reads as a pasted wikilink or as a JSON array in a
    // filter parameter, equally well.
    ambiguous = opener[0] === "[[" && match.slice(0, cut).includes("?");
  }

  return { url: match.slice(0, cut), ambiguous };
}

/** Trims sentence punctuation, closing emphasis pairs and unbalanced brackets. */
export function trimUrlTail(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1]!;

    if (TRAILING_PUNCTUATION.has(char)) {
      end -= 1;
      continue;
    }
    // `**https://x**` — a bold or struck run closing around the link.
    if ((char === "*" || char === "~") && url[end - 2] === char) {
      end -= 2;
      continue;
    }
    const opener = BRACKET_PAIRS[char];
    if (opener) {
      let opened = 0;
      let closed = 0;
      for (let index = 0; index < end; index++) {
        if (url[index] === opener) opened += 1;
        else if (url[index] === char) closed += 1;
      }
      // More closers than openers means this one came from the prose, as in
      // "(see https://example.com/a)". A balanced pair is Wikipedia's
      // /wiki/Foo_(film) and stays.
      if (closed > opened) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/** Normalises a rule's domain, accepting `*.site.com` and `site.*`. */
function parseDomain(raw: string): { domain: string; anyTld: boolean } {
  const cleaned = raw.trim().toLowerCase().replace(/^\*\./, "");
  const anyTld = cleaned.endsWith(".*");
  return { domain: anyTld ? cleaned.slice(0, -2) : cleaned, anyTld };
}

/** Second-level labels that appear in front of a two-letter country suffix. */
const COUNTRY_SECOND_LEVEL = new Set(["ac", "co", "com", "edu", "go", "gov", "ne", "net", "or", "org"]);

/** True when `host` is the rule's site, a subdomain of it, or it under another TLD. */
export function hostMatchesRemoval(host: string, removal: SiteParameterRemoval): boolean {
  if (!removal.anyTld) return host === removal.domain || host.endsWith(`.${removal.domain}`);

  const labels = host.split(".");
  const wanted = removal.domain.split(".");
  for (let start = 0; start + wanted.length < labels.length; start++) {
    if (!wanted.every((label, offset) => labels[start + offset] === label)) continue;
    const remaining = labels.length - (start + wanted.length);
    // One label covers .com and .se; two must look like .co.uk, so that
    // google.example.com does not match a `google.*` rule.
    if (remaining === 1) return true;
    if (remaining === 2) {
      const second = labels[start + wanted.length]!;
      const country = labels[start + wanted.length + 1]!;
      if (COUNTRY_SECOND_LEVEL.has(second) && country.length === 2) return true;
    }
  }
  return false;
}

/**
 * Parses the user's own removal rules.
 *
 * Three shapes, one per line:
 *   `fbclid`                 remove that name everywhere
 *   `mine.example | a, b`    remove `a` and `b` on that host and its subdomains
 *   `!youtube.com`           turn the built-in rules off for that host
 * `#` opens a comment.
 */
export interface ParsedLinkRemovals {
  globalParameters: string[];
  siteRemovals: SiteParameterRemoval[];
  disabledDomains: string[];
}

export function parseLinkRemovals(lines: readonly string[]): ParsedLinkRemovals {
  const globalParameters: string[] = [];
  const siteRemovals: SiteParameterRemoval[] = [];
  const disabledDomains: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("!")) {
      const { domain } = parseDomain(line.slice(1));
      if (domain) disabledDomains.push(domain);
      continue;
    }

    // A pipe wins over a colon, so `localhost:3000 | debug` is not read as a
    // parameter list starting at the port.
    const pipe = line.indexOf("|");
    const separator = pipe >= 0 ? pipe : line.indexOf(":");
    if (separator < 0) {
      if (!/[\s,|:]/.test(line)) globalParameters.push(line);
      continue;
    }

    const { domain, anyTld } = parseDomain(line.slice(0, separator));
    if (!domain) continue;
    const parameters = line
      .slice(separator + 1)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (parameters.length) siteRemovals.push({ domain, anyTld, parameters });
  }

  return { globalParameters, siteRemovals, disabledDomains };
}

/**
 * Merges the built-in lists with the user's rules.
 *
 * A `!site` line reaches the built-in rules for that site and every subdomain
 * of it, because those rules are not shown in the settings field and the user
 * cannot be expected to know their exact spelling.
 */
export function buildUrlCleanupOptions(userRules: readonly string[] = []): UrlCleanupOptions {
  const parsed = parseLinkRemovals(userRules);
  const disabled = (removal: SiteParameterRemoval): boolean =>
    parsed.disabledDomains.some(
      (domain) => removal.domain === domain || removal.domain.endsWith(`.${domain}`),
    );

  return {
    globalParameters: [...TRACKING_PARAMETERS, ...parsed.globalParameters],
    siteRemovals: [...SITE_PARAMETER_REMOVALS.filter((r) => !disabled(r)), ...parsed.siteRemovals],
  };
}

/** Splits a raw query into pairs, keeping each pair's original encoding. */
function splitQuery(query: string): { name: string; raw: string }[] {
  if (!query) return [];
  return query.split("&").map((raw) => {
    const equals = raw.indexOf("=");
    const encoded = equals >= 0 ? raw.slice(0, equals) : raw;
    let name = encoded;
    try {
      name = decodeURIComponent(encoded.replace(/\+/g, " "));
    } catch {
      // A malformed percent escape is left as written rather than dropped.
    }
    return { name, raw };
  });
}

function isSignedUrl(pairs: readonly { name: string }[]): boolean {
  const names = new Set(pairs.map((pair) => pair.name.toLowerCase()));
  return SIGNED_URL_PARAMETER_SETS.some((set) => set.every((name) => names.has(name.toLowerCase())));
}

/**
 * Drops a scroll-to-text fragment while keeping a real anchor. Browsers append
 * these when you copy a link to highlighted text: long, brittle, and never
 * wanted in a note.
 */
function cleanFragment(fragment: string): string {
  if (!fragment) return "";
  const marker = fragment.indexOf(":~:");
  if (marker < 0) return fragment;
  const remainder = fragment.slice(0, marker);
  return remainder === "#" ? "" : remainder;
}

/**
 * Cleans one URL, returning it byte for byte when nothing is removed so that
 * links needing no work keep their exact original spelling.
 */
export function cleanUrl(raw: string, options: UrlCleanupOptions): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return raw;

  // The raw string is rewritten rather than URL's normalised output, so
  // surviving parameters keep their original encoding.
  const hash = raw.indexOf("#");
  const fragment = hash >= 0 ? raw.slice(hash) : "";
  const withoutFragment = hash >= 0 ? raw.slice(0, hash) : raw;
  const mark = withoutFragment.indexOf("?");
  const base = mark >= 0 ? withoutFragment.slice(0, mark) : withoutFragment;
  const pairs = splitQuery(mark >= 0 ? withoutFragment.slice(mark + 1) : "");

  if (isSignedUrl(pairs)) return raw;

  const host = parsed.hostname.toLowerCase();
  const removed = (pair: { name: string }): boolean =>
    matchesParameterPattern(pair.name, options.globalParameters) ||
    options.siteRemovals.some(
      (removal) =>
        hostMatchesRemoval(host, removal) && matchesParameterPattern(pair.name, removal.parameters),
    );

  // A scheme inside the value of a parameter about to be dropped means a second
  // address ran into this one — "…?utm_source=n,https://b.example/y" is one
  // greedy match, and there is no separator in a query that says where the
  // first URL stopped. Removing the parameter would delete the second link
  // outright, so nothing is removed and both survive verbatim.
  if (pairs.some((pair) => removed(pair) && pair.raw.includes("://"))) return raw;

  const kept = pairs.filter((pair) => !removed(pair));

  const query = kept.map((pair) => pair.raw).join("&");
  const rebuilt = `${base}${query ? `?${query}` : ""}${cleanFragment(fragment)}`;
  return rebuilt === raw ? raw : rebuilt;
}

export interface UrlCleanupResult {
  text: string;
  /** How many URLs were actually shortened. */
  count: number;
}

/** The spans http(s) addresses occupy, with prose punctuation excluded. */
export function httpUrlRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  URL_PATTERN.lastIndex = 0;
  for (let match = URL_PATTERN.exec(text); match; match = URL_PATTERN.exec(text)) {
    const url = trimUrlTail(urlBoundary(match[0]).url);
    ranges.push({ start: match.index, end: match.index + url.length });
    // Rescan the text the trim gave back, so a URL pasted flush behind this one
    // gets a range of its own.
    URL_PATTERN.lastIndex = match.index + Math.max(url.length, 1);
  }
  return ranges;
}

/** Cleans every http(s) URL in `text`, including Markdown link destinations. */
export function cleanUrlsInText(
  text: string,
  options: UrlCleanupOptions,
  protect: readonly TextRange[] = [],
): UrlCleanupResult {
  const ranges = indexRanges([...protect, ...markdownCodeRanges(text)]);
  const parts: string[] = [];
  let cursor = 0;
  let count = 0;

  URL_PATTERN.lastIndex = 0;
  for (let match = URL_PATTERN.exec(text); match; match = URL_PATTERN.exec(text)) {
    const boundary = urlBoundary(match[0]);
    const url = trimUrlTail(boundary.url);

    if (boundary.ambiguous) {
      // Resume past the whole greedy match: rescanning inside it would clean a
      // URL nested in the very query this match declined to touch.
      URL_PATTERN.lastIndex = match.index + match[0].length;
      continue;
    }
    URL_PATTERN.lastIndex = match.index + Math.max(url.length, 1);

    if (ranges.overlaps(match.index, match.index + url.length)) continue;

    const cleaned = cleanUrl(url, options);
    if (cleaned === url) continue;
    count += 1;
    parts.push(text.slice(cursor, match.index), cleaned);
    cursor = match.index + url.length;
  }

  parts.push(text.slice(cursor));
  return { text: parts.join(""), count };
}
