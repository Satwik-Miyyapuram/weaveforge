/**
 * Concept extraction, folder drafts (Rust `ai`), APA references (Rust `papers::reference_text`),
 * presence (Rust `collab`) and text anchors (Rust `text_anchor`), re-exported from index.ts.
 * Signatures match the removed TS in packages/core ai-assistant/domain/{ai-extraction,mcp-folder-draft}.ts
 * and apps/web {papers/domain/reference-text,collab/domain/presence}.ts.
 */
import {
  anchorAt as rawAnchorAt,
  conceptKey as rawConceptKey,
  formatReference as rawFormatReference,
  locateAnchor as rawLocateAnchor,
  mergeExtractions as rawMergeExtractions,
  parseFolderDraft as rawParseFolderDraft,
  peersFromUsers as rawPeersFromUsers,
  samePeers as rawSamePeers,
  shouldPersistBody as rawShouldPersistBody,
  spanPoints as rawSpanPoints,
  withoutExisting as rawWithoutExisting,
} from "../pkg/wf_wasm.js";
import type {
  CommentAnchor,
  ExtractionResult,
  Peer,
  ReferencePaper,
  SpanPoints,
  TextSpan,
} from "./bindings.js";

/** Normalized key for comparing concept names: trimmed, lowercased, whitespace runs as one space. */
export function conceptKey(name: string): string {
  return rawConceptKey(name);
}

/** Merge results: counts summed, aliases unioned, mentions deduped; most-mentioned first. */
export function mergeExtractions<R extends ExtractionResult>(results: readonly R[]): R {
  return rawMergeExtractions(results) as R;
}

/** Drop concepts whose name or any alias is already in the wiki, and their mentions. */
export function withoutExisting<R extends ExtractionResult>(result: R, existing: readonly string[]): R {
  return rawWithoutExisting(result, [...existing]) as R;
}

/** A local-MCP draft file's parsed form (core `FolderDraft`), or null when it is not one. */
export function parseFolderDraft(raw: string): {
  kind: string;
  tool: string;
  resourceId: string;
  resourceType?: string;
  content: string;
  payload?: Record<string, unknown>;
  sourceLinks?: string[];
  expectedRevision?: string;
  createdAt?: string;
  projectId?: string;
} | null {
  return rawParseFolderDraft(raw) ?? null;
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
  const users = Array.from(states, ([id, s]) => [id, (s as { user?: unknown } | null)?.user ?? null]);
  return rawPeersFromUsers(users, self.clientId, self.authorId) as Peer[];
}

/** True when both lists show the same people the same way. */
export function samePeers(a: readonly Peer[], b: readonly Peer[]): boolean {
  return rawSamePeers(a, b);
}

/** The anchor for `text.slice(start, end)`, or null for an empty or blank span. */
export function anchorAt(text: string, start: number, end: number): CommentAnchor | null {
  return (rawAnchorAt(text, start, end) as CommentAnchor | null) ?? null;
}

/** Where `anchor` is in `text` now (UTF-16 offsets), or null when its quote no longer occurs. */
export function locateAnchor(text: string, anchor: CommentAnchor): { start: number; end: number } | null {
  return (rawLocateAnchor(text, anchor) as { start: number; end: number } | null) ?? null;
}

/** `[clientId, user]` pairs → one entry per other person (Rust `peers_from_users`). */
export function peersFromUsers(users: readonly (readonly [number, unknown])[], selfClientId: number, selfAuthorId: string): Peer[] {
  return rawPeersFromUsers(users, selfClientId, selfAuthorId) as Peer[];
}

/** Whether an editor may write `next` back over `lastSaved`: only once `ready`, and only when the text changed (Rust `should_persist_body`). */
export function shouldPersistBody(ready: boolean, next: string, lastSaved: string): boolean {
  return rawShouldPersistBody(ready, next, lastSaved);
}

/** Start and end `[line, column]` points of a text span over text nodes of `lengths` (Rust `span_points`), or null when the span is out of range. */
export function spanPoints(lengths: readonly number[], span: TextSpan): SpanPoints | null {
  return (rawSpanPoints([...lengths], span) as SpanPoints | null) ?? null;
}
