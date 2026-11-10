/**
 * Proposal-apply check (Rust `ai::proposal_apply::proposal_applies`), re-exported from index.ts.
 */
import { proposalApplies as rawProposalApplies } from "../pkg/wf_wasm.js";

/** Whether a proposal written against `expectedRevision` still applies to a row at `storedUpdatedAt`. */
export function proposalApplies(storedUpdatedAt: string | null | undefined, expectedRevision?: string | null): boolean {
  return rawProposalApplies(storedUpdatedAt ?? undefined, expectedRevision ?? undefined);
}
