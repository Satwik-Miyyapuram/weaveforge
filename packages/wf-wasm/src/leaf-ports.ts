/**
 * Concept extraction, folder drafts (Rust `ai`), APA references (Rust `papers::reference_text`),
 * presence (Rust `collab`) and text anchors (Rust `text_anchor`), re-exported from index.ts.
 * Signatures match the removed TS in packages/core ai-assistant/domain/{ai-extraction,mcp-folder-draft}.ts
 * and apps/web {papers/domain/reference-text,collab/domain/presence,sharing/domain/text-anchor}.ts.
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
  withoutExisting as rawWithoutExisting,
} from "../pkg/wf_wasm.js";

/** A run's concepts and mentions (core `ExtractionResult`). */
export interface ExtractionResultShape {
  concepts: { name: string; aliases: string[]; kind: string; mentions: number }[];
  mentions: { documentId: string; conceptName: string; evidence: string }[];
  pending?: true;
}

/** Normalized key for comparing concept names: trimmed, lowercased, whitespace runs as one space. */
export function conceptKey(name: string): string {
  return rawConceptKey(name);
}

/** Merge results: counts summed, aliases unioned, mentions deduped; most-mentioned first. */
export function mergeExtractions<R extends ExtractionResultShape>(results: readonly R[]): R {
  return rawMergeExtractions(results) as R;
}

/** Drop concepts whose name or any alias is already in the wiki, and their mentions. */
export function withoutExisting<R extends ExtractionResultShape>(result: R, existing: readonly string[]): R {
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

/** The paper fields an APA reference uses. */
export interface ReferencePaperShape {
  title: string;
  authors: readonly string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  url?: string | null;
}

/** A paper as an APA reference ready to paste. */
export function formatReference(paper: ReferencePaperShape): string {
  const { title, authors, year, venue, doi, arxivId, url } = paper;
  return rawFormatReference({ title, authors, year, venue, doi, arxivId, url });
}

/** Someone else in a document, as the presence avatars show them. */
export interface Peer {
  key: string;
  name: string;
  color: string;
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

/** A passage and its surroundings (sharing `CommentAnchor`). */
export interface TextAnchorShape {
  quote: string;
  prefix: string;
  suffix: string;
}

/** The anchor for `text.slice(start, end)`, or null for an empty or blank span. */
export function anchorAt(text: string, start: number, end: number): TextAnchorShape | null {
  return (rawAnchorAt(text, start, end) as TextAnchorShape | null) ?? null;
}

/** Where `anchor` is in `text` now (UTF-16 offsets), or null when its quote no longer occurs. */
export function locateAnchor(text: string, anchor: TextAnchorShape): { start: number; end: number } | null {
  return (rawLocateAnchor(text, anchor) as { start: number; end: number } | null) ?? null;
}
