/**
 * AI proposal-draft shaping (Rust `ai::proposal_draft`), re-exported from index.ts.
 * Throws `AI proposal preview is required.` when the content is blank.
 */
import { shapeAiProposalDraft as rawShapeAiProposalDraft } from "../pkg/wf_wasm.js";

export interface AiProposalDraftInput {
  id: string;
  kind: string;
  resourceId: string;
  content: string;
  payload: unknown;
  createdAt: string;
  sourceLinks?: string[];
  expectedRevision?: string;
  evidence?: unknown[];
}

export interface AiProposalDraft {
  id: string;
  kind: string;
  resourceId: string;
  content: string;
  payload: unknown;
  createdAt: string;
  status: "pending";
  sourceLinks: string[];
  expectedRevision?: string;
  evidence?: unknown[];
}

export function shapeAiProposalDraft(input: AiProposalDraftInput): AiProposalDraft {
  return rawShapeAiProposalDraft(input) as AiProposalDraft;
}
