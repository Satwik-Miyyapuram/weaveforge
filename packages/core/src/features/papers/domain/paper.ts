/**
 * Papers domain model — pure, no I/O, no SDK imports.
 *
 * The `Paper` entity and its invariants live here. Persistence and metadata
 * fetching are someone else's job (infrastructure). This file has exactly one
 * reason to change: the rules of what a Paper *is* (Single Responsibility).
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { ValidationError } from "../../../shared/errors.js";
import { rust } from "../../../shared/rust.js";

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

/**
 * The card projection of a paper — what `listSummaries()` returns.
 *
 * The papers grid paints a card from a subset of columns; the full row (the
 * abstract, the bibtex, the `metadata` bag) is only loaded when a paper is
 * opened. Typing that subset as a `Paper` is what let a summary be concatenated
 * with full rows into one list and then written back through `toRow`, dropping
 * everything the projection had not fetched (review-2 F6).
 *
 * The fields here are exactly what the card needs and what the summary columns
 * carry (see `PAPER_SUMMARY_COLUMNS` in the PostgREST adapter). Absent on
 * purpose: `abstract`, `bibtex`, `metadata`, `venue`, `rating`.
 */
export interface PaperSummary {
  id: string;
  title: string;
  authors: string[];
  status: PaperStatus;
  year?: number;
  /** ISO date (yyyy-mm-dd) the paper was read. */
  readAt?: string;
  pdfPath?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  /** The reader's own summary / notes (a column, not the derived `metadata`). */
  summary?: string;
  /** Keyword tags (normalized, no leading '#'). */
  tags: string[];
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

/** A paper input whose optional fields may be `null`, as the Rust core returns them. */
export type NullablePaperInput = { title: string } & {
  [K in Exclude<keyof NewPaperInput, "title">]?: NewPaperInput[K] | null;
};

/** Drops `null` fields so a Rust-built input fits `NewPaperInput`. */
export function paperInputWithoutNulls(input: NullablePaperInput): NewPaperInput {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)) as unknown as NewPaperInput;
}

export interface PaperFilter {
  status?: PaperStatus;
  /** Case-insensitive substring match against title. */
  titleContains?: string;
  arxivId?: string;
  doi?: string;
}

export class PaperValidationError extends ValidationError {
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
  let title: string;
  try {
    title = rust().checkNewPaper(input.title ?? "", input.rating ?? undefined);
  } catch (error) {
    throw new PaperValidationError((error as Error).message);
  }
  const now = deps.clock.nowIso();
  return {
    id: deps.ids.newId(),
    title,
    authors: input.authors ?? [],
    year: input.year,
    venue: input.venue,
    doi: rust().normalizeDoi(input.doi),
    arxivId: input.arxivId?.trim(),
    url: input.url,
    abstract: input.abstract,
    summary: input.summary,
    status: input.status ?? "to_read",
    rating: input.rating,
    bibtex: input.bibtex,
    tags: rust().normalizeTags(input.tags ?? []),
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

/** A hashtag with the offset it was found at, for evidence that points at it. */
export interface HashtagRef {
  /** Normalized: no leading '#', lowercased. */
  tag: string;
  /** Index of the '#' in the text it was read from. */
  index: number;
  /** Length of the matched text, including the '#'. */
  length: number;
}

/** The placeholder older rows hold in place of a summary. */
export const NO_SUMMARY = "No summary yet.";
