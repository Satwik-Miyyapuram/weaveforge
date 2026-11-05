/**
 * Wiki page merge (Rust `ai::wiki_merge`), re-exported from index.ts. Keeps the signature of
 * packages/core/src/features/ai-assistant/domain/wiki-merge.ts.
 */
import { mergeWikiPages as rawMergeWikiPages } from "../pkg/wf_wasm.js";
import type { MergeInput, WikiMergeResult } from "./bindings.js";

/**
 * Merge `secondary` into `primary`. `primary` keeps its title; the other title becomes an
 * alias so links to either continue to resolve.
 */
export function mergeWikiPages(primary: MergeInput, secondary: MergeInput): WikiMergeResult {
  return rawMergeWikiPages(primary, secondary) as WikiMergeResult;
}
