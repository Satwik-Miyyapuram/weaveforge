import {
  AI_PROPOSAL_KINDS,
  AI_READ_CATEGORIES,
  type AiAccessSettings,
  type AiProposalKind,
  type AiReadCategory,
} from "./ai-types.js";

function uniqueValid<T extends string>(values: readonly string[] | undefined, allowed: readonly T[]): T[] {
  const allowedSet = new Set<string>(allowed);
  return [...new Set((values ?? []).filter((value): value is T => allowedSet.has(value)))];
}

/** Normalize persisted AI access settings and fail closed for missing values. */
export function normalizeAiAccessSettings(input?: Partial<AiAccessSettings>): AiAccessSettings {
  const normalized: AiAccessSettings = {
    enabled: input?.enabled === true,
    readCategories: uniqueValid(input?.readCategories, AI_READ_CATEGORIES) as AiReadCategory[],
    proposalKinds: uniqueValid(input?.proposalKinds, AI_PROPOSAL_KINDS) as AiProposalKind[],
    autoIncludeNewSourceCategories: uniqueValid(input?.autoIncludeNewSourceCategories, AI_READ_CATEGORIES) as AiReadCategory[],
  };
  const disclosureAcceptedAt = input?.disclosureAcceptedAt?.trim();
  if (disclosureAcceptedAt) normalized.disclosureAcceptedAt = disclosureAcceptedAt;
  return normalized;
}
