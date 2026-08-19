import { normalizeDoi, type Paper, type PaperStatus } from "@weaveforge/core";
import { encryptedRowFields, encryptedListRowFields } from "@/lib/encrypted-row";

/**
 * How paper rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface PaperRow {
  id: string;
  title: string;
  authors: string[] | null;
  year: number | null;
  venue?: string | null;
  doi?: string | null;
  arxiv_id?: string | null;
  url?: string | null;
  pdf_path?: string | null;
  abstract?: string | null;
  summary?: string | null;
  status: PaperStatus;
  rating?: number | null;
  read_at: string | null;
  bibtex?: string | null;
  tags: string[] | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  doi_bidx?: string | null;
  arxiv_bidx?: string | null;
}

export function emptyToNull(value: string | undefined | null): string | null {
  if (value == null || value === "") return null;
  return value;
}

export function toRow(p: Paper): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title ?? "",
    authors: p.authors ?? [],
    year: p.year ?? null,
    venue: emptyToNull(p.venue),
    doi: p.doi ? emptyToNull(normalizeDoi(p.doi)) : null,
    arxiv_id: emptyToNull(p.arxivId),
    url: emptyToNull(p.url),
    pdf_path: p.pdfPath ?? null,
    abstract: emptyToNull(p.abstract),
    summary: emptyToNull(p.summary),
    status: p.status,
    rating: p.rating ?? null,
    read_at: p.readAt ?? null,
    bibtex: emptyToNull(p.bibtex),
    tags: p.tags ?? [],
    metadata: p.metadata ?? {},
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    doi_bidx: null,
    arxiv_bidx: null,
    ...encryptedRowFields(p),
    ...encryptedListRowFields(p),
  };
}
