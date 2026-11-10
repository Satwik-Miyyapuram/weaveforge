/**
 * The AI proposal card's preview split (Rust `ai::proposal_preview`),
 * re-exported from index.ts.
 */
import type {
  ProposalPreview,
} from "./bindings.js";

export {
  splitProposalContent,
} from "../pkg/wf_wasm.js";

export type { ProposalPreview } from "./bindings.js";

