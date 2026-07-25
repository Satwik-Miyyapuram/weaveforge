import { AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS } from "./ai-types.js";
import type {
  AiAccessSettings,
  AiProposalKind,
  AiReadCategory,
  AiResourceType,
  AiSessionGrant,
  AiToolName,
} from "./ai-types.js";

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

const RESOURCE_READ_CATEGORY: Record<AiResourceType, AiReadCategory> = {
  paper: "paper_metadata",
  paper_note: "paper_notes",
  zotero_annotation: "zotero_annotations",
  zotero_note: "zotero_annotations",
  reading_list: "reading_lists",
  citation_graph: "paper_metadata",
  vault_page: "vault_notes",
  log_entry: "logbook",
  experiment: "experiments",
  milestone: "experiments",
};

export function aiReadCategoryForResource(resourceType: AiResourceType): AiReadCategory {
  return RESOURCE_READ_CATEGORY[resourceType];
}

/** Single policy evaluator shared by in-app tools and the future MCP adapter. */
export class AiAccessPolicy {
  evaluate(input: AiPolicyInput): AiPolicyDecision {
    if (!input.settings.enabled) return { allowed: false, reason: "ai_disabled" };
    if (!input.settings.disclosureAcceptedAt) {
      return { allowed: false, reason: "disclosure_missing" };
    }
    if (!input.encryptionUnlocked) {
      return { allowed: false, reason: "encryption_locked" };
    }
    if (Date.parse(input.grant.expiresAt) <= Date.parse(input.now ?? new Date().toISOString())) {
      return { allowed: false, reason: "grant_expired" };
    }
    if (!input.grant.allowedTools.includes(input.tool)) {
      return { allowed: false, reason: "tool_not_allowed" };
    }
    // Naming a resource type without an id cannot be checked against the
    // grant, so it must not silently skip the check — fail closed instead.
    if (input.resourceType) {
      if (!input.resourceId) return { allowed: false, reason: "source_not_granted" };
      const granted = input.grant.readable.some(
        (source) => source.resourceType === input.resourceType && source.resourceId === input.resourceId,
      );
      if (!granted) return { allowed: false, reason: "source_not_granted" };
      if (!input.settings.readCategories.includes(RESOURCE_READ_CATEGORY[input.resourceType])) {
        return { allowed: false, reason: "category_disabled" };
      }
    }
    if (input.proposalKind) {
      if (AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.includes(input.proposalKind)) {
        return { allowed: false, reason: "credential_protection_required" };
      }
      if (!input.grant.proposalCapabilities.includes(input.proposalKind)) {
        return { allowed: false, reason: "proposal_not_allowed" };
      }
      if (!input.settings.proposalKinds.includes(input.proposalKind)) {
        return { allowed: false, reason: "proposal_not_allowed" };
      }
    }
    return { allowed: true };
  }
}
