/** Types for ai-access-policy. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { AiAccessSettings, AiProposalKind, AiReadCategory, AiResourceType, AiSessionGrant, AiToolName } from "./ai-types.js";

export type AiPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: AiPolicyDenyReason };

export type AiPolicyDenyReason =
  | "ai_disabled"
  | "disclosure_missing"
  | "encryption_locked"
  | "grant_expired"
  | "source_not_granted"
  | "category_disabled"
  | "tool_not_allowed"
  | "proposal_not_allowed"
  | "credential_protection_required";

export interface AiPolicyInput {
  settings: AiAccessSettings;
  grant: AiSessionGrant;
  resourceType?: AiResourceType;
  resourceId?: string;
  tool: AiToolName;
  now?: string;
  encryptionUnlocked: boolean;
  proposalKind?: AiProposalKind;
}

/** Single policy evaluator shared by in-app tools and the future MCP adapter (Rust core `AiAccessPolicy`). */
export interface AiAccessPolicy {
  evaluate(input: AiPolicyInput): AiPolicyDecision;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface AiAccessPolicyFns {
  aiReadCategoryForResource(resourceType: AiResourceType): AiReadCategory;
}
