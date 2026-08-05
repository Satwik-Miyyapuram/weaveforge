/**
 * Query syntax parser.
 *
 * Written here rather than pulled from `search-query-parser` (the library
 * Omnisearch uses) because query parsing belongs in this package, and this
 * package has no runtime dependencies. The grammar is small enough that a
 * dependency would cost more than it saves.
 *
 * Supported:
 *   term                 plain term
 *   "exact phrase"       contiguous match
 *   -term  -"phrase"     exclusion
 *   kind:note            restrict to entity kinds (repeatable)
 *   path:Method          restrict to a breadcrumb path substring
 *   tag:vae              restrict to a tag
 *
 * `kind:` replaces Omnisearch's `ext:` — this workspace has entity kinds, not
 * file extensions.
 */

import { SEARCH_KINDS, type SearchKind } from "./search-port.js";

export interface ParsedQuery {
  /** Free terms, already lowercased. */
  terms: string[];
  /** Quoted phrases that must appear contiguously. */
  phrases: string[];
  /** Terms and phrases that must NOT appear. */
  exclude: string[];
  kinds: SearchKind[];
  paths: string[];
  tags: string[];
  /** The query with all operators stripped — what gets handed to the ranker. */
  text: string;
}

const KNOWN_KINDS = new Set<string>(SEARCH_KINDS);

/** Split on whitespace, keeping quoted runs (and `-"…"`) together. */
function splitTokens(input: string): string[] {
  const tokens: string[] = [];
  const re = /-?"[^"]*"?|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) tokens.push(match[0]);
  return tokens;
}

function unquote(value: string): string {
  return value.replace(/^"|"$/g, "");
}

export function parseSearchQuery(input: string): ParsedQuery {
  const result: ParsedQuery = {
    terms: [],
    phrases: [],
    exclude: [],
    kinds: [],
    paths: [],
    tags: [],
    text: "",
  };
  if (!input?.trim()) return result;

  const free: string[] = [];

  for (const token of splitTokens(input.trim())) {
    if (token === "-" || token === '"') continue;

    if (token.startsWith("-") && token.length > 1) {
      const value = unquote(token.slice(1)).trim().toLowerCase();
      if (value) result.exclude.push(value);
      continue;
    }

    const field = /^(kind|path|tag):(.*)$/i.exec(token);
    if (field) {
      const value = unquote(field[2] ?? "").trim();
      if (!value) continue;
      const key = field[1]!.toLowerCase();
      if (key === "kind") {
        const lower = value.toLowerCase();
        // Unknown kinds are dropped rather than treated as free text: a typo in
        // `kind:` should narrow to nothing visible, not silently widen.
        if (KNOWN_KINDS.has(lower)) result.kinds.push(lower as SearchKind);
      } else if (key === "path") {
        result.paths.push(value.toLowerCase());
      } else {
        result.tags.push(value.replace(/^#/, "").toLowerCase());
      }
      continue;
    }

    if (token.startsWith('"')) {
      const phrase = unquote(token).trim().toLowerCase();
      if (phrase) {
        result.phrases.push(phrase);
        free.push(phrase);
      }
      continue;
    }

    const term = token.toLowerCase();
    result.terms.push(term);
    free.push(term);
  }

  result.text = free.join(" ").trim();
  return result;
}

/** True when the query carries no ranking input, only filters (or nothing). */
export function isFilterOnly(query: ParsedQuery): boolean {
  return query.text.length === 0;
}

/** True when the query says nothing at all. */
export function isEmptyQuery(query: ParsedQuery): boolean {
  return (
    isFilterOnly(query) &&
    query.kinds.length === 0 &&
    query.paths.length === 0 &&
    query.tags.length === 0 &&
    query.exclude.length === 0
  );
}
