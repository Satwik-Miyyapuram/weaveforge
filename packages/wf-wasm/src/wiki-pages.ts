/**
 * Wiki build rules (Rust `ai::wiki_pages`): which notes are wiki pages, extraction
 * documents, page refs, dead-link page plans and recently written pages. The web
 * adapter in `apps/web/.../wiki/application/wiki-build.ts` does the reads and proposals.
 */
import {
  findWikiRoot as rawFindWikiRoot,
  wikiPageRefs as rawWikiPageRefs,
  wikiSourceDocuments as rawWikiSourceDocuments,
  missingPagePlans as rawMissingPagePlans,
} from "../pkg/wf_wasm.js";
import type {
  RecentWikiPage,
  WikiNote,
  WikiPagePlanRecord,
  WikiPaper,
  WikiSourceDocument,
} from "./bindings.js";

export {
  recentlyApprovedWikiPages,
} from "../pkg/wf_wasm.js";

export type { RecentWikiPage, WikiNote, WikiPagePlanRecord, WikiPaper, WikiSourceDocument } from "./bindings.js";

/** The note titled `Wiki`, when there is one. */
export function findWikiRoot(pages: readonly WikiNote[]): WikiNote | null {
  return (rawFindWikiRoot(pages) as WikiNote | null | undefined) ?? null;
}

/**
 * The wiki's pages (children of the root) as `{ id, title, body, aliases? }`.
 *
 * Typed locally: the bindings name `WikiPageRef` belongs to the wiki-index shape
 * (`title`, `aliases`), not this lint shape. `aliases` is `undefined`, never `null`.
 */
export type WikiLintPageRef = { id: string; title: string; body: string; aliases?: string[] };

export function wikiPageRefs(pages: readonly WikiNote[]): WikiLintPageRef[] {
  const raw = rawWikiPageRefs(pages) as Array<WikiLintPageRef & { aliases?: string[] | null }>;
  return raw.map(({ aliases, ...page }) => (aliases ? { ...page, aliases } : page));
}

/** Notes (not generated pages) and papers as extraction documents; `sourceIds` restricts them. */
export function wikiSourceDocuments(
  pages: readonly WikiNote[],
  papers: readonly WikiPaper[],
  sourceIds?: readonly string[],
): WikiSourceDocument[] {
  return rawWikiSourceDocuments(pages, papers, sourceIds ? [...sourceIds] : undefined) as WikiSourceDocument[];
}

/** One placeholder plan per distinct, non-blank dead-link target. */
export function missingPagePlans(targets: readonly string[]): WikiPagePlanRecord[] {
  return rawMissingPagePlans([...targets]) as WikiPagePlanRecord[];
}

