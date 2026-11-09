/**
 * The AI proposal card's preview split (Rust `ai::proposal_preview`),
 * re-exported from index.ts.
 */
import { splitProposalContent as rawSplitProposalContent } from "../pkg/wf_wasm.js";
import type { ProposalPreview } from "./bindings.js";

export type { ProposalPreview } from "./bindings.js";

/** A draft's preview split: bold first line → title, "Why:" → reason, the rest → body. */
export function splitProposalContent(content: string): ProposalPreview {
  return rawSplitProposalContent(content) as ProposalPreview;
}
