import type {
  AiAccessSettings,
  AiProposalKind,
  AiSessionGrant,
  AiToolName,
  AiWorkspace,
  AiWorkspaceSource,
} from "../domain/ai-types.js";
import { rust } from "../../../shared/rust.js";

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
 * Creates a short-lived, in-memory grant. The access checks, TTL clamp and source
 * dedupe live in Rust (wf-core `ai::session_grant`). This deliberately persists neither
 * plaintext nor a reusable capability token; the caller owns its lifecycle.
 */
export class CreateAiSessionGrantUseCase {
  execute(input: CreateAiSessionGrantInput): AiActiveSession {
    return rust().startAiSession(input);
  }
}
