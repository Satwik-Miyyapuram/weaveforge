import type { AiAccessSettings } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { GENERATED_MCP_ENABLED, GENERATED_MCP_TOOL_NAMES } from "@/deployment/generated-registry";

type Envelope = { iv: string; ciphertext: string };
type RelayRequest = { id: string; request_enc: Envelope; expires_at: string };

/**
 * Executes opaque relay requests only in the unlocked browser. The relay
 * server stores envelopes, but never the pairing secret or decrypted payload.
 */
const POLL_ACTIVE_MS = 1200;
/** A hidden tab can still serve the local MCP client, just less eagerly. */
const POLL_HIDDEN_MS = 15_000;

export function startMcpBrowserRelay(input: { sessionId: string; pairingSecret: string; settings: AiAccessSettings }): () => void {
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
      const res = await fetch(`/api/mcp/relay/browser?sessionId=${encodeURIComponent(input.sessionId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return;
      const payload = await res.json() as { requests?: RelayRequest[] };
      for (const request of payload.requests ?? []) {
        try {
          const command = await decrypt(sessionKey, request.request_enc);
          const result = await dispatch(input.sessionId, input.settings, command);
          const envelope = await encrypt(sessionKey, result);
          await fetch("/api/mcp/relay", { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: request.id, envelope }) });
        } catch {
          // A malformed or no-longer-permitted request must not be retried by
          // another browser tab. Cancellation reveals no plaintext to the relay.
          await fetch("/api/mcp/relay", { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: request.id, status: "cancelled" }) });
        }
      }
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

async function dispatch(sessionId: string, settings: AiAccessSettings, command: { tool?: string; arguments?: Record<string, unknown> }): Promise<unknown> {
  if (!GENERATED_MCP_ENABLED || !command.tool || !GENERATED_MCP_TOOL_NAMES.includes(command.tool as (typeof GENERATED_MCP_TOOL_NAMES)[number])) {
    throw new Error("This MCP tool is not enabled for this deployment.");
  }
  const ai = getContainer().aiAssistant;
  const args = command.arguments ?? {};
  switch (command.tool) {
    case "search_workspace": return ai.searchWorkspace({ sessionId, settings, query: String(args.query ?? ""), limit: Number(args.limit) || undefined });
    case "get_source_excerpt": return ai.getSourceExcerpt({ sessionId, settings, sourceId: String(args.sourceId ?? "") });
    case "get_workspace_outline": return ai.getWorkspaceOutline({ sessionId, settings });
    case "propose_zotero_import": return ai.proposeZoteroImport({
      sessionId, settings, title: String(args.title ?? ""),
      authors: Array.isArray(args.authors) ? args.authors.map(String) : [], doi: typeof args.doi === "string" ? args.doi : undefined,
      url: typeof args.url === "string" ? args.url : undefined, year: typeof args.year === "string" || typeof args.year === "number" ? args.year : undefined,
      abstract: typeof args.abstract === "string" ? args.abstract : undefined,
    });
    case "propose_append_paper_note": {
      const addition = required(args, "addition");
      const paperId = required(args, "paperId");
      const sourceId = optional(args, "sourceId");
      let evidence: import("@thesis/core").AiEvidence[] | undefined;
      if (sourceId) {
        const doc = await ai.getSourceExcerpt({ sessionId, settings, sourceId });
        if (doc?.text) {
          const quoteExact = optional(args, "quoteExact");
          const pageRaw = args.page;
          const page =
            typeof pageRaw === "number" && Number.isInteger(pageRaw) && pageRaw >= 0
              ? pageRaw
              : undefined;
          const paperFromSource =
            doc.source.resourceType === "paper" || doc.source.resourceType === "paper_note"
              ? doc.source.resourceId
              : doc.source.resourceType === "zotero_annotation" || doc.source.resourceType === "zotero_note"
                ? doc.source.resourceId.split(":")[0] || undefined
                : undefined;
          evidence = [{
            sourceId,
            excerpt: doc.text,
            label: doc.source.label,
            ...(paperFromSource ? { paperId: paperFromSource } : {}),
            href: doc.source.href,
            ...(quoteExact
              ? {
                  locus: {
                    quote: {
                      type: "TextQuoteSelector" as const,
                      exact: quoteExact,
                      ...(optionalRaw(args, "quotePrefix")
                        ? { prefix: optionalRaw(args, "quotePrefix") }
                        : {}),
                      ...(optionalRaw(args, "quoteSuffix")
                        ? { suffix: optionalRaw(args, "quoteSuffix") }
                        : {}),
                    },
                  },
                }
              : {}),
            ...(page != null ? { page } : {}),
          }];
        }
      }
      return ai.proposeDraft({
        sessionId, settings, kind: "append_paper_note", tool: "propose_append_paper_note",
        resourceId: paperId, resourceType: "paper_note",
        expectedRevision: optional(args, "expectedRevision"),
        content: `Append to paper note:\n\n${addition}`,
        payload: { addition },
        evidence,
      });
    }
    case "propose_create_vault_note": return ai.proposeDraft({ sessionId, settings, kind: "create_vault_note", tool: "propose_create_vault_note", content: `Create vault note: ${required(args, "title")}`, payload: { title: required(args, "title"), body: required(args, "body"), parentId: optional(args, "parentId") } });
    case "propose_create_log_entry": return ai.proposeDraft({ sessionId, settings, kind: "create_log_entry", tool: "propose_create_log_entry", content: `Create log entry:\n\n${required(args, "body")}`, payload: { body: required(args, "body"), entryDate: optional(args, "entryDate"), kind: optional(args, "kind") ?? "daily" } });
    case "propose_paper_update": return ai.proposeDraft({ sessionId, settings, kind: "paper_update", tool: "propose_paper_update", resourceId: required(args, "paperId"), resourceType: "paper", expectedRevision: optional(args, "expectedRevision"), content: `Update paper metadata`, payload: { status: optional(args, "status"), rating: typeof args.rating === "number" ? args.rating : undefined, tags: stringList(args.tags) } });
    case "propose_reading_list_change": return ai.proposeDraft({ sessionId, settings, kind: "reading_list_change", tool: "propose_reading_list_change", resourceId: required(args, "listId"), resourceType: "reading_list", content: "Add an item to a reading list", payload: { listId: required(args, "listId"), paperId: optional(args, "paperId"), vaultPageId: optional(args, "vaultPageId"), note: optional(args, "note") } });
    case "propose_relation": return ai.proposeDraft({ sessionId, settings, kind: "relation", tool: "propose_relation", resourceId: required(args, "fromPaper"), resourceType: "paper", content: `Add ${required(args, "relation")} relation`, payload: { fromPaper: required(args, "fromPaper"), toPaper: required(args, "toPaper"), relation: required(args, "relation") } });
    case "propose_milestone_follow_up": return ai.proposeDraft({ sessionId, settings, kind: "milestone_follow_up", tool: "propose_milestone_follow_up", content: `Create milestone: ${required(args, "title")}`, payload: { title: required(args, "title"), description: optional(args, "description"), targetDate: optional(args, "targetDate") } });
    case "propose_experiment_follow_up": return ai.proposeDraft({ sessionId, settings, kind: "experiment_follow_up", tool: "propose_experiment_follow_up", content: `Create experiment: ${required(args, "name")}`, payload: { name: required(args, "name"), hypothesis: optional(args, "hypothesis"), relatedPaper: optional(args, "relatedPaper") } });
    default: throw new Error("This MCP tool is not enabled for live execution.");
  }
}

function required(args: Record<string, unknown>, key: string): string { const value = optional(args, key); if (!value) throw new Error(`${key} is required.`); return value; }
function optional(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" && args[key].trim() ? args[key].trim() : undefined;
}

/** Affixes must keep abutting whitespace for quote matching — do not trim. */
function optionalRaw(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" && args[key].length > 0 ? args[key] : undefined;
}
function stringList(value: unknown): string[] | undefined { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined; }

async function key(secret: string) { return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]).then((base) => crypto.subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode("thesis-tracker-mcp-v1"), iterations: 100_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])); }
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
async function encrypt(sessionKey: Promise<CryptoKey>, value: unknown): Promise<Envelope> { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sessionKey, new TextEncoder().encode(JSON.stringify(value))); return { iv: b64(iv), ciphertext: b64(new Uint8Array(data)) }; }
async function decrypt(sessionKey: Promise<CryptoKey>, envelope: Envelope): Promise<{ tool?: string; arguments?: Record<string, unknown> }> { const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, await sessionKey, unb64(envelope.ciphertext)); return JSON.parse(new TextDecoder().decode(data)); }
