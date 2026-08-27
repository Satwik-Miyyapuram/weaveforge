/**
 * What a paper is called in a bibliography — pure, no I/O.
 *
 * These rules lived in the Overleaf export, which was the only place that
 * needed them until the bibliography check did. Two answers to "what is this
 * paper's cite key" would drift apart, and the drift would show up as a check
 * reporting a missing entry for a key the export had just written.
 *
 * The precedence is deliberate and matches what a reader expects from their
 * reference manager: a key they set by hand wins, then the one their BibTeX
 * already carries, then Better BibTeX's note in the extra field, and only then
 * something synthesised from an identifier.
 */

import type { Paper } from "../../papers/domain/paper.js";

export type CitationFormat = "latex" | "pandoc" | "footnote" | "raw";

/** Everything BibTeX and biber accept in a key; everything else becomes `_`. */
const KEY_SAFE = /[^A-Za-z0-9_:-]/g;

/**
 * A paper's preferred cite key, without uniqueness suffixing.
 *
 * Never empty: a paper with no metadata, no BibTeX and no identifier still gets
 * a key derived from its id, because an export that silently omits an entry is
 * worse than one with an ugly key in it.
 */
export function resolveCiteKey(paper: Paper): string {
  const fromMeta =
    (typeof paper.metadata?.["citeKey"] === "string" && paper.metadata["citeKey"].trim()) ||
    (typeof paper.metadata?.["citationKey"] === "string" && paper.metadata["citationKey"].trim()) ||
    "";
  const fromBib = paper.bibtex?.match(/@\w+\{([^,\s]+)\s*,/)?.[1]?.trim() || "";
  const fromExtra =
    typeof paper.metadata?.["extra"] === "string"
      ? /Citation Key:\s*(\S+)/i.exec(paper.metadata["extra"] as string)?.[1]?.trim() || ""
      : "";
  const preferred = (fromMeta || fromBib || fromExtra).replace(KEY_SAFE, "_");
  return (
    preferred ||
    (paper.doi && `doi_${paper.doi.replace(/[^A-Za-z0-9]/g, "_")}`) ||
    (paper.arxivId && `arxiv_${paper.arxivId.replace(/[^A-Za-z0-9]/g, "_")}`) ||
    `paper_${paper.id.replace(/-/g, "").slice(0, 12)}`
  );
}

/**
 * {@link resolveCiteKey}, made unique against keys already taken.
 *
 * `used` is mutated, because the caller is walking a library and the second
 * `smith2020` must know about the first.
 */
export function uniqueCiteKey(paper: Paper, used: Set<string>): string {
  const base = resolveCiteKey(paper);
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

/**
 * Format a cite key for insertion. Empty/whitespace keys yield "" — callers
 * decide how to surface "no resolvable key" rather than inventing one here.
 */
export function formatCitation(key: string, format: CitationFormat): string {
  const trimmed = key.trim().replace(KEY_SAFE, "_");
  if (!trimmed) return "";
  switch (format) {
    case "latex":
      return `\\cite{${trimmed}}`;
    case "pandoc":
      return `[@${trimmed}]`;
    case "footnote":
      return `[^${trimmed}]`;
    case "raw":
      return trimmed;
  }
}

/** Resolve then format in one step for a paper. */
export function formatPaperCitation(paper: Paper, format: CitationFormat): string {
  return formatCitation(resolveCiteKey(paper), format);
}
