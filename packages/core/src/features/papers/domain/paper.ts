/**
 * Papers domain model — pure, no I/O, no SDK imports.
 *
 * The `Paper` entity and its invariants live here. Persistence and metadata
 * fetching are someone else's job (infrastructure). This file has exactly one
 * reason to change: the rules of what a Paper *is* (Single Responsibility).
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export type PaperStatus = "to_read" | "reading" | "read" | "skimmed";

export const PAPER_STATUSES: readonly PaperStatus[] = [
  "to_read",
  "reading",
  "read",
  "skimmed",
];

export interface Paper extends Identifiable {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  pdfPath?: string;
  abstract?: string;
  /** The reader's own summary / notes. */
  summary?: string;
  status: PaperStatus;
  /** Optional 1–5 rating. */
  rating?: number;
  /** ISO date (yyyy-mm-dd) the paper was read. */
  readAt?: string;
  bibtex?: string;
  /** Keyword tags (normalized, no leading '#'). Derived from the summary and
   *  Zotero annotations, or edited by hand. Used by filters + the graph. */
  tags: string[];
  /** Extensible bag for anything not modeled explicitly. */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a paper; the rest are defaulted. */
export interface NewPaperInput {
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  summary?: string;
  status?: PaperStatus;
  rating?: number;
  bibtex?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface PaperFilter {
  status?: PaperStatus;
  /** Case-insensitive substring match against title. */
  titleContains?: string;
  arxivId?: string;
  doi?: string;
}

export class PaperValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperValidationError";
  }
}

/**
 * Build a valid Paper from partial input, applying defaults and invariants.
 * Throwing here keeps invalid entities from ever reaching a repository.
 */
export function createPaper(
  input: NewPaperInput,
  deps: { clock: Clock; ids: IdGenerator },
): Paper {
  const title = input.title?.trim();
  if (!title) {
    throw new PaperValidationError("Paper title is required.");
  }
  if (input.rating != null && (input.rating < 1 || input.rating > 5)) {
    throw new PaperValidationError("Rating must be between 1 and 5.");
  }
  const now = deps.clock.nowIso();
  return {
    id: deps.ids.newId(),
    title,
    authors: input.authors ?? [],
    year: input.year,
    venue: input.venue,
    doi: normalizeDoi(input.doi),
    arxivId: input.arxivId?.trim(),
    url: input.url,
    abstract: input.abstract,
    summary: input.summary,
    status: input.status ?? "to_read",
    rating: input.rating,
    bibtex: input.bibtex,
    tags: normalizeTags(input.tags ?? []),
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeDoi(doi?: string): string | undefined {
  if (!doi) return undefined;
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

/** Trim, drop a leading '#', lowercase, and dedupe (order-preserving). */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, "").toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Pull `#hashtags` out of free text, normalized (no '#', lowercase, deduped). */
export function extractHashtags(text?: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return normalizeTags(matches);
}
