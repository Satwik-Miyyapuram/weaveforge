import {
  aiReadCategoryForResource,
} from "../domain/ai-access-policy.js";
import type {
  AiAccessSettings,
  AiProposalKind,
  AiSessionGrant,
  AiToolName,
  AiWorkspace,
  AiWorkspaceSource,
} from "../domain/ai-types.js";
import { AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS } from "../domain/ai-types.js";

export const AI_SESSION_DEFAULT_TTL_MS = 30 * 60 * 1000;
/** Long grants are still browser-memory-only and end immediately on lock, reload, or sign-out. */
export const AI_SESSION_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AiActiveSession {
  workspace: AiWorkspace;
  grant: AiSessionGrant;
  startedAt: string;
}

export interface CreateAiSessionGrantInput {
  id: string;
  workspaceName: string;
  sources: readonly AiWorkspaceSource[];
  settings: AiAccessSettings;
  encryptionUnlocked: boolean;
  now: string;
  ttlMs?: number;
  allowedTools: readonly AiToolName[];
  proposalCapabilities: readonly AiProposalKind[];
}

/**
 * Creates a short-lived, in-memory grant. This deliberately persists neither
 * plaintext nor a reusable capability token; the caller owns its lifecycle.
 */
export class CreateAiSessionGrantUseCase {
  execute(input: CreateAiSessionGrantInput): AiActiveSession {
    if (!input.settings.enabled) throw new Error("AI access is disabled.");
    if (!input.settings.disclosureAcceptedAt) throw new Error("Accept the AI disclosure first.");
    if (!input.encryptionUnlocked) throw new Error("Unlock encryption before starting AI access.");

    const workspaceName = input.workspaceName.trim();
    if (!workspaceName) throw new Error("Workspace name is required.");
    const sources = uniqueSources(input.sources);
    if (sources.length === 0) throw new Error("Select at least one source.");
    for (const source of sources) {
      if (!input.settings.readCategories.includes(aiReadCategoryForResource(source.resourceType))) {
        throw new Error(`AI reading is not enabled for ${source.resourceType}.`);
      }
    }

    const now = new Date(input.now);
    if (Number.isNaN(now.getTime())) throw new Error("A valid session start time is required.");
    const ttlMs = clampTtl(input.ttlMs ?? AI_SESSION_DEFAULT_TTL_MS);
    const proposalCapabilities = input.proposalCapabilities.filter((kind) =>
      input.settings.proposalKinds.includes(kind) && !AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.includes(kind),
    );
    const workspace: AiWorkspace = {
      id: input.id,
      name: workspaceName,
      sources,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    return {
      workspace,
      grant: {
        id: input.id,
        workspaceId: workspace.id,
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        readable: sources,
        allowedTools: [...new Set(input.allowedTools)],
        proposalCapabilities: [...new Set(proposalCapabilities)],
        requiresConfirmationForWrites: true,
      },
      startedAt: now.toISOString(),
    };
  }
}

function uniqueSources(sources: readonly AiWorkspaceSource[]): AiWorkspaceSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.resourceType}:${source.resourceId}`;
    if (!source.resourceId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs)) return AI_SESSION_DEFAULT_TTL_MS;
  return Math.max(1, Math.min(Math.floor(ttlMs), AI_SESSION_MAX_TTL_MS));
}
