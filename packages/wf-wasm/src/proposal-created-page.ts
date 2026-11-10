/**
 * The page an approved proposal created (Rust `proposal_created_page`), re-exported from
 * index.ts. The shapes come from bindings.ts, generated from the Rust types.
 */
import { createdPageIndex as rawCreatedPageIndex } from "../pkg/wf_wasm.js";
import type { PageRef, ProposalPreviewItem } from "./bindings.js";

export type { PageRef, ProposalPreviewItem } from "./bindings.js";

/**
 * Index into `pages` of the page an approved proposal created, or null when no page matches.
 */
export function createdPageIndex(
  item: ProposalPreviewItem,
  pages: readonly PageRef[],
): number | null {
  return rawCreatedPageIndex(item, pages) as number | null;
}
