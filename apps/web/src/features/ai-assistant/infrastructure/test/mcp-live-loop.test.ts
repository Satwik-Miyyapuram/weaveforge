import assert from "node:assert/strict";
import test from "node:test";
import nodeCrypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AiAssistantFacade } from "@/container/facades";
import type { AiAccessSettings, AiWriteProposal } from "@weaveforge/core";
import { handleRelayBatch } from "../mcp-browser-relay";

/**
 * The whole tools/call path, end to end, with the password off.
 *
 * Everything either side of the relay was already unit-tested, but the seam
 * itself never was: it needs a real MCP client process, a real relay transport
 * and a browser holding real keys, and CI cannot unlock a vault. So this test
 * builds that browser out of in-memory repositories with encryption forced
 * unlocked, and stands the relay up as a local HTTP server over an in-memory
 * row store that mirrors the real route's claim, TTL and 409 rules.
 *
 * What is real here: the shipped MCP server binary, its JSON-RPC framing, its
 * PBKDF2/AES-GCM sealing, its POST-then-poll protocol, the browser-side claim
 * loop, decryption, tool dispatch, the access policy, and the proposal store.
 * What is a stand-in: Postgres and Supabase auth — both covered separately by
 * mcp-relay.rls.integration.ts against a real database.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "../../../../../../../plugins/weaveforge-research/mcp-server/index.mjs");

const SECRET = "pairing-secret-for-the-live-loop";
const TOKEN = "test-access-token";

const PAPER = {
  id: "paper-1", title: "Attention", authors: ["A"], year: 2017, venue: "NeurIPS",
  abstract: "Transformers replace recurrence with attention entirely.",
  status: "reading", tags: [], summary: "The note body already on the paper.",
} as unknown as import("@weaveforge/core").Paper;

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-01-01T00:00:00.000Z",
  readCategories: ["paper_metadata", "paper_notes"],
  proposalKinds: ["append_paper_note"],
};

const empty = { async list() { return []; } };

// ---------------------------------------------------------------- the browser

function browser(saved: AiWriteProposal[]) {
  return new AiAssistantFacade({
    papers: { async list() { return [PAPER]; }, async getById() { return PAPER; } } as never,
    vaultPages: empty as never, readingLists: empty as never, logEntries: empty as never,
    experiments: empty as never, milestones: empty as never,
    proposals: {
      async save(proposal: AiWriteProposal) { saved.push(proposal); },
      async getById() { return null; },
      async listPending() { return saved; },
    } as never,
    // The password is off: this stands in for an unlocked vault.
    isEncryptionUnlocked: () => true,
    newId: () => "session-1",
    now: () => new Date().toISOString(),
  });
}

/** Derived the way the browser derives it, from the same secret the client uses. */
async function sessionKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode("weaveforge-mcp-v1"), iterations: 100_000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

// ------------------------------------------------------------------ the relay

interface Row {
  id: string;
  session_id: string;
  request_enc: unknown;
  response_enc: unknown;
  status: "pending" | "claimed" | "complete" | "cancelled";
  expires_at: string;
}

/**
 * The relay routes over an in-memory store.
 *
 * Deliberately narrow: it enforces the bearer token, the 64 kB envelope cap,
 * the TTL clamp, and the "only a claimed, unexpired row can be patched" rule
 * that the real PATCH expresses as .eq("status","claimed").gt("expires_at",…),
 * because those are what the client and the browser loop are written against.
 */
function relayServer(rows: Map<string, Row>) {
  return http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://relay.test");
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      if (req.method === "POST") {
        const envelope = body.envelope as { iv: string; ciphertext: string };
        if (!envelope?.iv || !envelope.ciphertext) return send(400, { error: "invalid envelope" });
        if (envelope.iv.length + envelope.ciphertext.length > 64_000) return send(413, { error: "envelope too large" });
        const id = nodeCrypto.randomUUID();
        const ttl = Math.max(15_000, Math.min(Number(body.ttlMs) || 90_000, 10 * 60_000));
        rows.set(id, {
          id, session_id: String(body.sessionId), request_enc: envelope, response_enc: null,
          status: "pending", expires_at: new Date(Date.now() + ttl).toISOString(),
        });
        return send(201, { request: { id } });
      }
      if (req.method === "GET") {
        const row = rows.get(url.searchParams.get("id") ?? "");
        if (!row) return send(404, { error: "not found" });
        const expired = row.status === "pending" && Date.parse(row.expires_at) < Date.now();
        return send(200, { request: { ...row, status: expired ? "expired" : row.status } });
      }
      if (req.method === "PATCH") {
        const row = rows.get(String(body.id));
        if (!row || row.status !== "claimed" || Date.parse(row.expires_at) < Date.now()) {
          return send(409, { error: "Relay request is no longer claimable." });
        }
        if (body.status === "cancelled") { row.status = "cancelled"; row.response_enc = null; }
        else { row.status = "complete"; row.response_enc = body.envelope; }
        return send(200, { request: row });
      }
      return send(405, { error: "method not allowed" });
    });
  });
}

// ------------------------------------------------------------- the MCP client

/** One JSON-RPC message per line, answers matched back by id. */
class Client {
  private buffer = "";
  private next = 1;
  private readonly waiting = new Map<number, (message: Record<string, unknown>) => void>();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let cut: number;
      while ((cut = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, cut);
        this.buffer = this.buffer.slice(cut + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number };
        if (typeof message.id === "number") this.waiting.get(message.id)?.(message as Record<string, unknown>);
      }
    });
  }

  call(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  /** The text payload every tools/call answer wraps its result in. */
  async tool(name: string, args: Record<string, unknown>): Promise<{ result?: unknown; error?: string }> {
    const message = await this.call("tools/call", { name, arguments: args });
    const error = message.error as { message: string } | undefined;
    if (error) return { error: error.message };
    const content = (message.result as { content: { text: string }[] }).content;
    return { result: JSON.parse(content[0]!.text) as unknown };
  }
}

test("a real MCP client drives the real browser loop through the relay", async (t) => {
  const rows = new Map<string, Row>();
  const server = relayServer(rows);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  const saved: AiWriteProposal[] = [];
  const ai = browser(saved);
  const options = await ai.listSourceOptions();
  const paperSource = options.find((option) => option.resourceType === "paper")!;
  const noteSource = options.find((option) => option.resourceType === "paper_note")!;
  const active = await ai.startSession({
    workspaceName: "w",
    sourceIds: [paperSource.sourceId, noteSource.sourceId],
    settings,
    proposalCapabilities: ["append_paper_note"],
  });

  // The browser tab: claim whatever is pending, then run the real batch handler.
  const key = await sessionKey(SECRET);
  let pumping = true;
  const pump = (async () => {
    while (pumping) {
      const batch = [...rows.values()].filter((row) => row.status === "pending" && row.session_id === active.grant.id);
      for (const row of batch) row.status = "claimed";
      if (batch.length > 0) {
        await handleRelayBatch({
          sessionId: active.grant.id,
          getSettings: () => settings,
          sessionKey: Promise.resolve(key),
          host: () => ai,
          live: () => pumping,
          patch: (body) => fetch(`http://127.0.0.1:${port}/api/mcp/relay`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).then((res) => res.ok),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        }, batch.map((row) => ({ id: row.id, request_enc: row.request_enc as never, expires_at: row.expires_at })));
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  })();

  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      WEAVEFORGE_MCP_URL: `http://127.0.0.1:${port}`,
      WEAVEFORGE_MCP_TOKEN: TOKEN,
      WEAVEFORGE_MCP_SESSION: active.grant.id,
      WEAVEFORGE_MCP_PAIRING_SECRET: SECRET,
    },
  }) as ChildProcessWithoutNullStreams;
  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => stderr.push(chunk));

  t.after(async () => {
    pumping = false;
    await pump;
    child.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const handshake = await client(child).call("initialize", { protocolVersion: "2024-11-05" });
  assert.equal((handshake.result as { serverInfo: { name: string } }).serverInfo.name, "weaveforge-research");

  const listed = await client(child).call("tools/list");
  const names = (listed.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
  assert.ok(names.includes("search_workspace") && names.length === 13, `advertised: ${names.join(", ")}`);

  // Every call goes out at once: the client polls on a 1.2s tick, so running
  // them in sequence would cost a second each for no extra coverage.
  const api = client(child);
  const [search, excerpt, outline, note, refused] = await Promise.all([
    api.tool("search_workspace", { query: "attention" }),
    api.tool("get_source_excerpt", { sourceId: paperSource.sourceId }),
    api.tool("get_workspace_outline", {}),
    api.tool("propose_append_paper_note", {
      paperId: "paper-1", addition: "Worth revisiting for the ablation section.",
      sourceId: paperSource.sourceId, quoteExact: "attention entirely",
    }),
    api.tool("propose_create_vault_note", { title: "Denied", body: "Not in the grant." }),
  ]);

  assert.ok(Array.isArray(search.result) && search.result.length > 0, "search reached the real retrieval path");
  assert.match(JSON.stringify(excerpt.result), /recurrence/, "the excerpt came from the stub paper, decrypted in the browser");
  assert.ok(Array.isArray(outline.result) && outline.result.length === 2, "the outline lists exactly the granted sources");

  assert.equal((note.result as { status: string }).status, "requires_review", "a write is a proposal, never a write");
  assert.equal(saved.length, 1, "exactly one proposal reached the store");
  assert.equal(saved[0]!.kind, "append_paper_note");
  assert.equal(saved[0]!.evidence?.[0]?.paperId, "paper-1", "evidence survived the round trip");

  // The grant does not carry create_vault_note, so the policy refuses it in the
  // browser and the client is told, rather than being left to time out.
  assert.match(String(refused.error), /proposal_not_allowed/, `the client must be told why, not just that it failed: ${refused.error}`);
  assert.equal(saved.length, 1, "the refused call wrote nothing");

  assert.ok([...rows.values()].every((row) => row.status !== "pending"), "no row was left dangling");
  assert.ok(
    [...rows.values()].every((row) => JSON.stringify(row.request_enc).length > 0 && !JSON.stringify(row).includes("Worth revisiting")),
    "the relay only ever held ciphertext",
  );
  assert.deepEqual(stderr, [], "the MCP server logged nothing to stderr");
});

/** One client per child, memoised so every call shares the same reader. */
const clients = new WeakMap<ChildProcessWithoutNullStreams, Client>();
function client(child: ChildProcessWithoutNullStreams): Client {
  let existing = clients.get(child);
  if (!existing) { existing = new Client(child); clients.set(child, existing); }
  return existing;
}
