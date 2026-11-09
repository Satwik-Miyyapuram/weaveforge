/**
 * AI access policy and settings helpers (Rust `ai::access_policy`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/ai-assistant/domain/ai-access-policy.ts
 * and ai-settings.ts.
 */
import {
  aiReadCategoryForResource as rawAiReadCategoryForResource,
  evaluateAiAccess as rawEvaluateAiAccess,
  normalizeAiAccessSettings as rawNormalizeAiAccessSettings,
} from "../pkg/wf_wasm.js";
import type {
  AiAccessSettings,
  AiPolicyDenyReason,
  AiPolicyInput,
  AiProposalKind,
  AiReadCategory,
  AiResourceType,
} from "./bindings.js";
import type { ReadonlyInput } from "./readonly-input.js";

/** Allowed, or denied with the reason (Rust sets `reason` exactly when `allowed` is false). */
export type AiPolicyDecision = { allowed: true } | { allowed: false; reason: AiPolicyDenyReason };

/** Read categories an AI session may be granted (TS `AI_READ_CATEGORIES`). */
export const AI_READ_CATEGORIES: readonly AiReadCategory[] = [
  "paper_metadata",
  "paper_notes",
  "zotero_annotations",
  "reading_lists",
  "vault_notes",
  "logbook",
  "experiments",
];

/** Proposal kinds the assistant may suggest (TS `AI_PROPOSAL_KINDS`). */
export const AI_PROPOSAL_KINDS: readonly AiProposalKind[] = [
  "append_paper_note",
  "create_vault_note",
  "create_log_entry",
  "paper_update",
  "paper_field_value",
  "reading_list_change",
  "relation",
  "zotero_import",
  "milestone_follow_up",
  "experiment_follow_up",
  "edit_vault_note",
  "append_vault_note",
  "report_edit",
  "milestone_status",
  "experiment_update",
  "paper_annotation",
];

/** Drafts do not access Zotero. A future approved write still needs encrypted credentials. */
export const AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS: readonly AiProposalKind[] = [];

export function aiReadCategoryForResource(resourceType: AiResourceType): AiReadCategory {
  return rawAiReadCategoryForResource(resourceType) as AiReadCategory;
}

/** Evaluate one policy input at an ISO time. */
export function evaluateAiAccess(input: ReadonlyInput<AiPolicyInput>, now: string): AiPolicyDecision {
  return rawEvaluateAiAccess(input, now) as AiPolicyDecision;
}

/** Single policy evaluator shared by in-app tools and the future MCP adapter. */
export class AiAccessPolicy {
  evaluate(input: ReadonlyInput<AiPolicyInput> & { now?: string }): AiPolicyDecision {
    // The clock is read here, not in WASM, so the Rust side stays pure.
    const { now, ...rest } = input;
    return evaluateAiAccess(rest, now ?? new Date().toISOString());
  }
}

/** Persisted AI access settings with unknown values dropped and fail-closed defaults. */
export function normalizeAiAccessSettings(input?: Partial<AiAccessSettings>): AiAccessSettings {
  return rawNormalizeAiAccessSettings(input) as AiAccessSettings;
}
