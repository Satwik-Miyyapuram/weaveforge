/**
 * The page an approved proposal created (Rust `proposal_created_page`), re-exported from
 * index.ts. The shapes come from bindings.ts, generated from the Rust types.
 */
import type {
  PageRef,
  ProposalPreviewItem,
} from "./bindings.js";

export {
  createdPageIndex,
} from "../pkg/wf_wasm.js";

export type { PageRef, ProposalPreviewItem } from "./bindings.js";

