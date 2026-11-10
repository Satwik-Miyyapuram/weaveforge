/**
 * Semantic Scholar citation field rules (Rust `semantic_scholar_citation`), re-exported from index.ts.
 * Keeps the results of the helpers in
 * apps/web/src/features/relations/infrastructure/semantic-scholar-citation-source.ts.
 */
import {
  batchReferenceLists as rawBatchReferenceLists,
  citationCandidates as rawCitationCandidates,
  citationContexts as rawCitationContexts,
  citationExternalIdRef as rawCitationExternalIdRef,
  citationIntents as rawCitationIntents,
  nextCitationPageOffset as rawNextCitationPageOffset,
  s2PaperId as rawS2PaperId,
} from "../pkg/wf_wasm.js";
import type { PaperRef } from "./bindings.js";

/** A citing paper as the citation source keeps it (matches the app's `CitationCandidate`). */
export interface CitationCandidateWire {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  url: string;
  citationCount?: number;
  contexts?: string[];
  intents?: string[];
  isInfluential?: boolean;
}

/** Trimmed, non-empty context snippets, or undefined when none remain. */
export function citationContexts(raw: unknown): string[] | undefined {
  return (rawCitationContexts(raw) as string[] | null) ?? undefined;
}

/** The known citation intents, or undefined when none remain. */
export function citationIntents(raw: unknown): string[] | undefined {
  return (rawCitationIntents(raw) as string[] | null) ?? undefined;
}

/** The lookup reference for a paper's external ids (arXiv first, then DOI), or null. */
export function citationExternalIdRef(ids: unknown): PaperRef | null {
  return (rawCitationExternalIdRef(ids) as PaperRef | null) ?? null;
}

/** The Semantic Scholar id for a reference. */
export function s2PaperId(ref: PaperRef): string {
  return rawS2PaperId(ref) as string;
}

/** The next offset to request, or -1 to stop paging. */
export function nextCitationPageOffset(currentOffset: number, next: unknown, pagesFetched: number): number {
  return rawNextCitationPageOffset(currentOffset, next, pagesFetched);
}

/** The candidates from one page of `/citations` edges, in order. */
export function citationCandidates(data: unknown): CitationCandidateWire[] {
  return rawCitationCandidates(data) as CitationCandidateWire[];
}

/** The reference lists for one `/paper/batch` chunk, aligned to its ids. Throws when the count differs. */
export function batchReferenceLists(data: unknown, chunkLength: number): (PaperRef[] | null)[] {
  return rawBatchReferenceLists(data, chunkLength) as (PaperRef[] | null)[];
}
