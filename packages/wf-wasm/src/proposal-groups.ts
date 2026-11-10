/**
 * AI review queue grouping (Rust `proposal_groups`), re-exported from index.ts.
 * Returns indices into the input list; the caller maps them back to its rows.
 * The shapes come from bindings.ts, generated from the Rust types.
 */
import { groupProposals as rawGroupProposals } from "../pkg/wf_wasm.js";
import type { ProposalGroup, ProposalRef } from "./bindings.js";

export type { ProposalGroup, ProposalRef } from "./bindings.js";

/**
 * Groups in the order their first proposal appears. By `"document"`, a resource id not in
 * `knownIds` (a create's fresh id, or a target not in the catalog) is grouped under
 * `kind:<kind>` instead.
 */
export function groupProposals(
  items: readonly ProposalRef[],
  by: "document" | "kind",
  knownIds?: readonly string[],
): ProposalGroup[] {
  return rawGroupProposals(items, by, knownIds ? [...knownIds] : undefined) as ProposalGroup[];
}
