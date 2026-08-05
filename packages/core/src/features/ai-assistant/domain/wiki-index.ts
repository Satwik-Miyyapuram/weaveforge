/**
 * The wiki's index page: one place that links to every concept page.
 *
 * Regenerated wholesale rather than edited incrementally. An index is a
 * projection of what exists, and an incrementally maintained one drifts — a
 * page deleted outside the wiki screen leaves a link behind, and the index
 * quietly becomes another thing to lint. Rebuilding from the current page list
 * makes it correct by construction, at the cost of not being hand-editable,
 * which is the right trade for a file whose whole content is derived.
 */

import type { WikiPageRef } from "./wiki-lint.js";

/** Marks the generated region so a rebuild never eats hand-written text. */
export const INDEX_MARKER_START = "<!-- weaveforge:wiki-index -->";
export const INDEX_MARKER_END = "<!-- /weaveforge:wiki-index -->";

/** Pages are grouped under this when the title starts with a digit or symbol. */
const OTHER_GROUP = "#";

function groupKey(title: string): string {
  const first = title.trim()[0];
  if (!first) return OTHER_GROUP;
  const upper = first.toUpperCase();
  return upper >= "A" && upper <= "Z" ? upper : OTHER_GROUP;
}

export interface WikiIndexOptions {
  /** Heading above the list. */
  heading?: string;
  /** Reference time, so a regenerated index is testable. */
  now?: () => string;
}

/**
 * Build the generated block.
 *
 * Sorting is by title rather than by insertion, and groups are alphabetical
 * with the symbol group last: an index is read by scanning for a name, so the
 * order that matters is the reader's, not the wiki's history.
 */
export function buildWikiIndex(
  pages: readonly WikiPageRef[],
  options: WikiIndexOptions = {},
): string {
  const heading = options.heading ?? "Index";
  const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title));

  const groups = new Map<string, WikiPageRef[]>();
  for (const page of sorted) {
    const key = groupKey(page.title);
    const bucket = groups.get(key);
    if (bucket) bucket.push(page);
    else groups.set(key, [page]);
  }

  const keys = [...groups.keys()].sort((a, b) => {
    if (a === OTHER_GROUP) return 1;
    if (b === OTHER_GROUP) return -1;
    return a.localeCompare(b);
  });

  const lines: string[] = [INDEX_MARKER_START, `## ${heading}`, ""];

  if (sorted.length === 0) {
    lines.push("_No pages yet._", "");
  } else {
    for (const key of keys) {
      lines.push(`### ${key}`, "");
      for (const page of groups.get(key)!) {
        // Wikilinks rather than ids: the link resolver already matches by
        // title, so the index survives being read outside the app.
        const aliases = page.aliases?.length ? ` — also ${page.aliases.join(", ")}` : "";
        lines.push(`- [[${page.title}]]${aliases}`);
      }
      lines.push("");
    }
    lines.push(
      `_${sorted.length} page${sorted.length === 1 ? "" : "s"}. Generated ${
        (options.now ?? (() => new Date().toISOString()))().slice(0, 10)
      }._`,
      "",
    );
  }

  lines.push(INDEX_MARKER_END);
  return lines.join("\n");
}

/**
 * Splice a freshly built index into a body, replacing any previous one.
 *
 * Text outside the markers is left exactly as written. Someone who put a note
 * at the top of the wiki root keeps it — regeneration is only entitled to the
 * region it generated.
 */
export function replaceWikiIndex(body: string, index: string): string {
  const start = body.indexOf(INDEX_MARKER_START);
  const end = body.indexOf(INDEX_MARKER_END);

  if (start < 0 || end < start) {
    const trimmed = body.trimEnd();
    return trimmed ? `${trimmed}\n\n${index}\n` : `${index}\n`;
  }

  const before = body.slice(0, start);
  const after = body.slice(end + INDEX_MARKER_END.length);
  return `${before}${index}${after}`;
}
