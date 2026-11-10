/**
 * Semantic Scholar citation field rules (Rust `semantic_scholar_citation`), re-exported from index.ts.
 * Keeps the results of the helpers in
 * apps/web/src/features/relations/infrastructure/semantic-scholar-citation-source.ts.
 */
import {
  citationContexts as rawCitationContexts,
  citationExternalIdRef as rawCitationExternalIdRef,
  citationIntents as rawCitationIntents,
  nextCitationPageOffset as rawNextCitationPageOffset,
  s2PaperId as rawS2PaperId,
} from "../pkg/wf_wasm.js";
import type { PaperRef } from "./bindings.js";

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
