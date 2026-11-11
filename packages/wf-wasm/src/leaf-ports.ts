/**
 * Concept extraction, folder drafts (Rust `ai`), APA references (Rust `papers::reference_text`),
 * presence (Rust `collab`) and text anchors (Rust `text_anchor`), re-exported from index.ts.
 * Signatures match the removed TS in packages/core ai-assistant/domain/{ai-extraction,mcp-folder-draft}.ts
 * and apps/web {papers/domain/reference-text,collab/domain/presence}.ts.
 */
import {
  compactSkipReason as rawCompactSkipReason,
  formatReference as rawFormatReference,
  mergeExtractions as rawMergeExtractions,
  peersFromUsers as rawPeersFromUsers,
  spanPoints as rawSpanPoints,
  withoutExisting as rawWithoutExisting,
} from "../pkg/wf_wasm.js";
import type {
  ExtractionResult,
  Peer,
  ReferencePaper,
  SpanPoints,
  TextSpan,
} from "./bindings.js";

export {
  anchorAt,
  locateAnchor,
  parseFolderDraft,
  peersFromUsers,
  samePeers,
} from "../pkg/wf_wasm.js";

export {
  conceptKey,
  shouldPersistBody,
} from "../pkg/wf_wasm.js";

/** Merge results: counts summed, aliases unioned, mentions deduped; most-mentioned first. */
export function mergeExtractions<R extends ExtractionResult>(results: readonly R[]): R {
  return rawMergeExtractions(results) as R;
}

/** Drop concepts whose name or any alias is already in the wiki, and their mentions. */
export function withoutExisting<R extends ExtractionResult>(result: R, existing: readonly string[]): R {
  return rawWithoutExisting(result, [...existing]) as R;
}

/** A paper as an APA reference ready to paste. */
export function formatReference(paper: Omit<ReferencePaper, "authors"> & { authors: readonly string[] }): string {
  const { title, authors, year, venue, doi, arxivId, url } = paper;
  return rawFormatReference({ title, authors: [...authors], year, venue, doi, arxivId, url });
}

/** Awareness states → one entry per other person (not you, not your other sessions, one per person). */
export function peersFromStates(
  states: ReadonlyMap<number, unknown>,
  self: { clientId: number; authorId: string },
): Peer[] {
  const users = Array.from(states, ([id, s]): [number, unknown] => [id, (s as { user?: unknown } | null)?.user ?? null]);
  return rawPeersFromUsers(users, self.clientId, self.authorId);
}

/** Why a CRDT compaction is a no-op (`nothing-to-do` or `stale`), or undefined to send it (Rust `compact_skip_reason`). */
export function compactSkipReason(
  snapshotUptoId: number,
  currentSnapshotUpto?: number,
): "nothing-to-do" | "stale" | undefined {
  return (rawCompactSkipReason(snapshotUptoId, currentSnapshotUpto) ?? undefined) as
    | "nothing-to-do"
    | "stale"
    | undefined;
}

/** Start and end `[line, column]` points of a text span over text nodes of `lengths` (Rust `span_points`), or null when the span is out of range. */
export function spanPoints(lengths: readonly number[], span: TextSpan): SpanPoints | null {
  return (rawSpanPoints([...lengths], span) as SpanPoints | null) ?? null;
}
