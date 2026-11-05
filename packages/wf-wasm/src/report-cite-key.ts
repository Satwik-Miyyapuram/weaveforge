/**
 * Cite-key resolution and citation formatting (Rust `report::cite_key`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/report/domain/cite-key.ts.
 * The paper input is the subset of `Paper` these functions read. Types come from ./bindings.ts.
 */
import {
  resolveCiteKey as rawResolveCiteKey,
  uniqueCiteKey as rawUniqueCiteKey,
  formatCitation as rawFormatCitation,
  formatPaperCitation as rawFormatPaperCitation,
} from "../pkg/wf_wasm.js";
import type { CiteKeyPaper } from "./bindings.js";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toCiteKeyPaper(paper: Parameters<typeof resolveCiteKey>[0]): CiteKeyPaper {
  const meta = paper.metadata ?? {};
  return {
    id: paper.id,
    doi: stringField(paper.doi),
    arxivId: stringField(paper.arxivId),
    bibtex: stringField(paper.bibtex),
    citeKey: stringField(meta["citeKey"]),
    citationKey: stringField(meta["citationKey"]),
    extra: stringField(meta["extra"]),
  };
}

/**
 * A paper's preferred cite key, without uniqueness suffixing. Never empty. `paper` is the subset of
 * `Paper` these functions read; a `Paper` satisfies it.
 */
export function resolveCiteKey(paper: {
  id: string;
  doi?: string;
  arxivId?: string;
  bibtex?: string;
  metadata?: Record<string, unknown>;
}): string {
  return rawResolveCiteKey(toCiteKeyPaper(paper));
}

/**
 * {@link resolveCiteKey}, made unique against keys already taken. `used` is mutated: the returned
 * key is added to it, so the next paper with the same key gets a suffix.
 */
export function uniqueCiteKey(
  paper: Parameters<typeof resolveCiteKey>[0],
  used: Set<string>,
): string {
  const key = rawUniqueCiteKey(toCiteKeyPaper(paper), [...used]);
  used.add(key);
  return key;
}

/** Format a cite key for insertion. Empty/whitespace keys yield "". */
export function formatCitation(key: string, format: "latex" | "pandoc" | "footnote" | "raw"): string {
  return rawFormatCitation(key, format);
}

/** Resolve then format in one step for a paper. */
export function formatPaperCitation(
  paper: Parameters<typeof resolveCiteKey>[0],
  format: "latex" | "pandoc" | "footnote" | "raw",
): string {
  return rawFormatPaperCitation(toCiteKeyPaper(paper), format);
}
