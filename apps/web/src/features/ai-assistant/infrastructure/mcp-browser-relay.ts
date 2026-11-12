import { errorMessage, type AiAccessSettings, type AiEvidence } from "@weaveforge/core";
import { relayUrl } from "@/lib/parts";
import { readyCore } from "@/lib/rust-core";
import { getContainer } from "@/bootstrap";

import { GENERATED_MCP_ENABLED, GENERATED_MCP_TOOL_NAMES } from "@/deployment/generated-registry";

/**
 * The slice of the assistant facade the tools need.
 *
 * Named as an interface rather than reached for through the container so the
 * dispatch below can be exercised against a stub: everything a tool call does
 * after decryption happens here, and none of it was reachable from a test while
 * this was a container lookup.
 */
export type McpToolHost = Pick<
  ReturnType<typeof getContainer>["aiAssistant"],
  "searchWorkspace" | "getSourceExcerpt" | "getWorkspaceOutline" | "proposeDraft" | "proposeZoteroImport"
>;

type Envelope = { iv: string; ciphertext: string };
type RelayRequest = { id: string; request_enc: Envelope; expires_at: string };

/**
 * Executes opaque relay requests only in the unlocked browser. The relay
 * server stores envelopes, but never the pairing secret or decrypted payload.
 */
const POLL_ACTIVE_MS = 1200;
/** A hidden tab can still serve the local MCP client, just less eagerly. */
const POLL_HIDDEN_MS = 15_000;

export function startMcpBrowserRelay(input: {
  sessionId: string;
  pairingSecret: string;
  /** Fresh settings on each dispatch so mid-session policy tightening applies. */
  getSettings: () => AiAccessSettings;
}): () => void {
  if (!GENERATED_MCP_ENABLED) return () => undefined;
  let stopped = false;
  let running = false;
  let timer: number | undefined;
  // Deriving the AES key costs 100k PBKDF2 iterations; the pairing secret is
  // fixed for the session, so derive it once and reuse it for every envelope.
  const sessionKey = key(input.pairingSecret);
  // Mark handled: tick() awaits it inside its own try, but the rejection would
  // otherwise surface before the first await lands.
  void sessionKey.catch(() => undefined);

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const accessToken = await getContainer().auth.auth.getAccessToken();
      if (!accessToken || !getContainer().aiAssistant.listActiveSessions().some((s) => s.grant.id === input.sessionId)) return;
      const res = await fetch(relayUrl(`/api/mcp/relay/browser?sessionId=${encodeURIComponent(input.sessionId)}`), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return;
      const payload = await res.json() as { requests?: RelayRequest[] };
      await handleRelayBatch({
        sessionId: input.sessionId,
        getSettings: input.getSettings,
        sessionKey,
        host: () => getContainer().aiAssistant,
        live: () => !stopped && getContainer().aiAssistant.listActiveSessions().some((s) => s.grant.id === input.sessionId),
        patch: (body) => fetch(relayUrl("/api/mcp/relay"), {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then((res) => res.ok),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      }, payload.requests ?? []);
    } catch { /* Requests are retried while the approved session remains active. */ }
    finally { running = false; }
  };

  const schedule = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = window.setInterval(() => void tick(), document.hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS);
  };
  const onVisibility = () => {
    schedule();
    if (!document.hidden) void tick();
  };

  schedule();
  document.addEventListener("visibilitychange", onVisibility);
  void tick();
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibility);
    if (timer !== undefined) window.clearInterval(timer);
  };
}

/** What one pass over a claimed batch needs. Injected so the rules below are testable. */
export interface RelayBatchDeps {
  sessionId: string;
  getSettings: () => AiAccessSettings;
  sessionKey: Promise<CryptoKey>;
  host: () => McpToolHost;
  /** False once the tab stopped relaying or the grant went away. */
  live: () => boolean;
  /** PATCH one status back to the relay; resolves true when it landed. */
  patch: (body: Record<string, unknown>) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
}

/** How many times a finished result is offered to the relay before giving up. */
const DELIVERY_ATTEMPTS = 3;

/**
 * Execute a claimed batch, in order, and account for every row in it.
 *
 * Two rules carry the weight here. A row that was never dispatched is
 * cancelled, because claimed rows are never requeued and the MCP client would
 * otherwise wait out the TTL. A row that *was* dispatched is never cancelled
 * even when delivery fails, because cancelling invites the client to retry a
 * call whose side effects already happened.
 */
export async function handleRelayBatch(deps: RelayBatchDeps, batch: readonly RelayRequest[]): Promise<void> {
  const cancel = async (id: string) => {
    try { await deps.patch({ id, status: "cancelled" }); } catch { /* the TTL is the backstop */ }
  };
  for (let i = 0; i < batch.length; i++) {
    const request = batch[i]!;
    if (!deps.live()) {
      for (const leftover of batch.slice(i)) await cancel(leftover.id);
      return;
    }
    let command: { tool?: string; arguments?: Record<string, unknown> };
    try {
      command = await decrypt(deps.sessionKey, request.request_enc);
    } catch {
      // Nothing openable here, so nothing to answer with. Another tab would
      // fail the same way, and cancelling reveals no plaintext to the relay.
      await cancel(request.id);
      continue;
    }
    // A refusal is sealed back rather than cancelled: the caller can only see
    // that a cancelled call went nowhere, so a policy denial used to reach the
    // model as a bare "Relay cancelled" with no way to correct itself.
    let result: unknown;
    try {
      result = await dispatchMcpTool(deps.host(), deps.sessionId, deps.getSettings(), command);
    } catch (error) {
      result = { weaveforgeError: errorMessage(error) };
    }
    try {
      const envelope = await encrypt(deps.sessionKey, result);
      for (let attempt = 0; attempt < DELIVERY_ATTEMPTS; attempt++) {
        try {
          if (await deps.patch({ id: request.id, envelope })) break;
        } catch { /* fall through to the backoff */ }
        if (attempt < DELIVERY_ATTEMPTS - 1) await deps.sleep(250 * (attempt + 1));
      }
    } catch {
      await cancel(request.id);
    }
  }
}

type DraftInput = Parameters<McpToolHost["proposeDraft"]>[0];
type EvidenceRequest = Parameters<ReturnType<typeof readyCore>["mcpPaperEvidence"]>[0];

/**
 * Run one decrypted tool call. Every argument is untrusted: the tool check,
 * the argument checks and the draft shapes are decided in Rust
 * (`ai::mcp_dispatch`); this runs the host calls the plan names, in its order.
 */
export async function dispatchMcpTool(ai: McpToolHost, sessionId: string, settings: AiAccessSettings, command: { tool?: string; arguments?: Record<string, unknown> }): Promise<unknown> {
  const enabled = GENERATED_MCP_ENABLED ? [...GENERATED_MCP_TOOL_NAMES] : [];
  const plan = readyCore().planMcpTool(command.tool ?? "", command.arguments ?? {}, enabled);
  switch (plan.op) {
    case "searchWorkspace": return ai.searchWorkspace({ sessionId, settings, query: plan.query, limit: plan.limit });
    case "getSourceExcerpt": return ai.getSourceExcerpt({ sessionId, settings, sourceId: plan.sourceId });
    case "getWorkspaceOutline": return ai.getWorkspaceOutline({ sessionId, settings });
    case "proposeZoteroImport": return ai.proposeZoteroImport({
      sessionId, settings, title: plan.title, authors: plan.authors, doi: plan.doi,
      url: plan.url, year: plan.year, abstract: plan.abstract,
    });
    case "proposeDraft": {
      // Evidence is fetched only after the plan accepted the call, so a refused
      // call never reads an excerpt and never writes a draft.
      const evidence = plan.evidence ? await buildPaperEvidence(ai, sessionId, settings, plan.evidence) : undefined;
      const draft = {
        sessionId, settings, kind: plan.kind, tool: plan.tool,
        resourceId: plan.resourceId, resourceType: plan.resourceType,
        expectedRevision: plan.expectedRevision, content: plan.content,
        payload: plan.payload, evidence,
      };
      return ai.proposeDraft(draft as DraftInput);
    }
    default: throw new Error("This MCP tool is not enabled for live execution.");
  }
}

/**
 * Fetch the source a draft cites, then let Rust check it: the quote must be in
 * the excerpt, and the source must be this paper.
 */
async function buildPaperEvidence(ai: McpToolHost, sessionId: string, settings: AiAccessSettings, request: EvidenceRequest): Promise<AiEvidence[]> {
  const doc = await ai.getSourceExcerpt({ sessionId, settings, sourceId: request.sourceId });
  return readyCore().mcpPaperEvidence(request, doc) as AiEvidence[];
}

async function key(secret: string) { return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]).then((base) => crypto.subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode("weaveforge-mcp-v1"), iterations: 100_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])); }
async function encrypt(sessionKey: Promise<CryptoKey>, value: unknown): Promise<Envelope> { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sessionKey, new TextEncoder().encode(JSON.stringify(value))); return { iv: readyCore().encodeBase64(iv), ciphertext: readyCore().encodeBase64(new Uint8Array(data)) }; }
async function decrypt(sessionKey: Promise<CryptoKey>, envelope: Envelope): Promise<{ tool?: string; arguments?: Record<string, unknown> }> { const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: readyCore().decodeBase64(envelope.iv) }, await sessionKey, readyCore().decodeBase64(envelope.ciphertext)); return JSON.parse(new TextDecoder().decode(data)); }
