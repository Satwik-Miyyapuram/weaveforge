/**
 * Wiki index (Rust `ai::wiki_index`), re-exported from index.ts. Each function keeps the
 * signature of packages/core/src/features/ai-assistant/domain/wiki-index.ts.
 */
import {
  buildWikiIndex as rawBuildWikiIndex,
  replaceWikiIndex as rawReplaceWikiIndex,
} from "../pkg/wf_wasm.js";
import type { WikiPageRef } from "./bindings.js";

/** Marks the generated region so a rebuild never eats hand-written text. */
export const INDEX_MARKER_START = "<!-- weaveforge:wiki-index -->";
export const INDEX_MARKER_END = "<!-- /weaveforge:wiki-index -->";

/** Build the generated block. `now` is read only when pages exist, as in the TS original. */
export function buildWikiIndex(
  pages: readonly WikiPageRef[],
  options: { heading?: string; now?: () => string } = {},
): string {
  const generatedAt = pages.length > 0 ? (options.now ?? (() => new Date().toISOString()))() : "";
  return rawBuildWikiIndex(pages, options.heading, generatedAt);
}

/** Splice a freshly built index into a body, replacing any previous one. */
export function replaceWikiIndex(body: string, index: string): string {
  return rawReplaceWikiIndex(body, index);
}
