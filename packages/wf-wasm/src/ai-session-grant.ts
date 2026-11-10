/**
 * AI session start (Rust `ai::session_grant`), re-exported from index.ts.
 * Returns the active session, or throws the user-facing message of the first failed check.
 */
import { startAiSession as rawStartAiSession } from "../pkg/wf_wasm.js";

export interface AiSessionStartInput {
  id: string;
  workspaceName: string;
  sources: readonly { resourceType: string; resourceId: string; [key: string]: unknown }[];
  settings: Record<string, unknown>;
  encryptionUnlocked: boolean;
  now: string;
  ttlMs?: number;
  allowedTools: readonly string[];
  proposalCapabilities: readonly string[];
}

export interface AiActiveSession {
  workspace: { id: string; name: string; sources: unknown[]; createdAt: string; updatedAt: string };
  grant: {
    id: string;
    workspaceId: string;
    expiresAt: string;
    readable: unknown[];
    allowedTools: string[];
    proposalCapabilities: string[];
    requiresConfirmationForWrites: boolean;
  };
  startedAt: string;
}

/** Starts an AI session: TTL clamp, source dedupe and the access checks. Throws on the first failed check. */
export function startAiSession(input: AiSessionStartInput): AiActiveSession {
  return rawStartAiSession(input) as AiActiveSession;
}
