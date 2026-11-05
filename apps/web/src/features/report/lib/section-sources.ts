import { readyCore } from "@/lib/rust-core";

/** Pandoc-style keys: `[@smith2020]`, `[@a; @b]`, or a bare `@smith2020` after a space. */
const CITE_KEY = /(?:^|[\s[;])@([A-Za-z][\w:.-]*\w)/g;

/**
 * How many distinct sources a section draft cites: `[[wikilinks]]` to papers
 * or notes, plus `@citekeys`. The Sources column of the Sections mock.
 */
export function countSectionSources(body?: string): number {
  if (!body) return 0;
  const seen = new Set<string>();
  for (const ref of readyCore().extractWikilinks(body)) seen.add(`w:${readyCore().normalizeTitleKey(ref.target)}`);
  for (const m of body.matchAll(CITE_KEY)) seen.add(`k:${m[1]!.toLowerCase()}`);
  return seen.size;
}
