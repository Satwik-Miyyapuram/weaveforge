#!/usr/bin/env node
import crypto from "node:crypto";

const baseUrl = process.env.WEAVEFORGE_MCP_URL?.replace(/\/$/, "");
const token = process.env.WEAVEFORGE_MCP_TOKEN;
const sessionId = process.env.WEAVEFORGE_MCP_SESSION;
const secret = process.env.WEAVEFORGE_MCP_PAIRING_SECRET;
if (!baseUrl || !token || !sessionId || !secret) throw new Error("Set WEAVEFORGE_MCP_URL, WEAVEFORGE_MCP_TOKEN, WEAVEFORGE_MCP_SESSION, and WEAVEFORGE_MCP_PAIRING_SECRET.");

const tools = [
  { name: "search_workspace", description: "Search the user-approved WeaveForge sources.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "get_source_excerpt", description: "Read one user-approved source by source ID.", inputSchema: { type: "object", properties: { sourceId: { type: "string" } }, required: ["sourceId"] } },
  { name: "get_workspace_outline", description: "List sources approved for this live session.", inputSchema: { type: "object", properties: {} } },
  { name: "propose_zotero_import", description: "Draft a Zotero item for user review. It never writes to Zotero.", inputSchema: { type: "object", properties: { title: { type: "string" }, authors: { type: "array", items: { type: "string" } }, doi: { type: "string" }, url: { type: "string" }, year: { anyOf: [{ type: "string" }, { type: "number" }] }, abstract: { type: "string" } }, required: ["title"] } },
  { name: "propose_append_paper_note", description: "Draft an append-only addition to an approved paper note for user review. Pass sourceId (and optional quoteExact/page) so the review pane can show claim-level evidence.", inputSchema: { type: "object", properties: { paperId: { type: "string" }, addition: { type: "string" }, expectedRevision: { type: "string" }, sourceId: { type: "string", description: "Approved workspace sourceId the addition cites." }, quoteExact: { type: "string", description: "Exact cited sentence for jump-to-locus." }, quotePrefix: { type: "string" }, quoteSuffix: { type: "string" }, page: { type: "number", description: "0-based PDF page hint." } }, required: ["paperId", "addition"] } },
  { name: "propose_create_vault_note", description: "Draft a new vault note for user review.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, parentId: { type: "string" } }, required: ["title", "body"] } },
  { name: "propose_create_log_entry", description: "Draft a log entry for user review.", inputSchema: { type: "object", properties: { body: { type: "string" }, entryDate: { type: "string" }, kind: { enum: ["daily", "weekly"] } }, required: ["body"] } },
  { name: "propose_paper_update", description: "Draft permitted metadata changes to an approved paper for user review.", inputSchema: { type: "object", properties: { paperId: { type: "string" }, status: { enum: ["to_read", "reading", "read", "skimmed"] }, rating: { type: "number" }, tags: { type: "array", items: { type: "string" } }, expectedRevision: { type: "string" } }, required: ["paperId"] } },
  { name: "propose_paper_field_value", description: "Draft a custom-field (extraction-table cell) value for user review. Requires sourceId + quoteExact so /ai-review can show claim-level evidence. Never writes the cell until approved.", inputSchema: { type: "object", properties: { paperId: { type: "string" }, fieldId: { type: "string" }, value: { description: "string | number | string[] depending on field kind", anyOf: [{ type: "string" }, { type: "number" }, { type: "array", items: { type: "string" } }] }, listId: { type: "string" }, expectedRevision: { type: "string" }, sourceId: { type: "string", description: "Approved workspace sourceId the value cites." }, quoteExact: { type: "string", description: "Exact cited sentence for jump-to-locus." }, quotePrefix: { type: "string" }, quoteSuffix: { type: "string" }, page: { type: "number", description: "0-based PDF page hint." }, fieldName: { type: "string", description: "Human field label for the review card preview." } }, required: ["paperId", "fieldId", "value", "sourceId", "quoteExact"] } },
  { name: "propose_reading_list_change", description: "Draft adding one paper or vault note to an approved reading list for user review.", inputSchema: { type: "object", properties: { listId: { type: "string" }, paperId: { type: "string" }, vaultPageId: { type: "string" }, note: { type: "string" } }, required: ["listId"] } },
  { name: "propose_relation", description: "Draft a relation from an approved source paper to another paper for user review.", inputSchema: { type: "object", properties: { fromPaper: { type: "string" }, toPaper: { type: "string" }, relation: { enum: ["cites", "extends", "contradicts", "similar", "builds_on", "uses_method"] } }, required: ["fromPaper", "toPaper", "relation"] } },
  { name: "propose_milestone_follow_up", description: "Draft a milestone follow-up for user review.", inputSchema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, targetDate: { type: "string" } }, required: ["title"] } },
  { name: "propose_experiment_follow_up", description: "Draft an experiment follow-up for user review.", inputSchema: { type: "object", properties: { name: { type: "string" }, hypothesis: { type: "string" }, relatedPaper: { type: "string" } }, required: ["name"] } },
];
const key = crypto.pbkdf2Sync(secret, "weaveforge-mcp-v1", 100000, 32, "sha256");
function seal(value) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", key, iv); const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]); return { iv: iv.toString("base64"), ciphertext: Buffer.concat([data, c.getAuthTag()]).toString("base64") }; }
function open(envelope) { const raw = Buffer.from(envelope.ciphertext, "base64"); const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64")); d.setAuthTag(raw.subarray(-16)); return JSON.parse(Buffer.concat([d.update(raw.subarray(0, -16)), d.final()]).toString("utf8")); }
async function relay(command) { const post = await fetch(`${baseUrl}/api/mcp/relay`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, envelope: seal(command) }) }); if (!post.ok) throw new Error(`Relay unavailable (${post.status})`); const id = (await post.json()).request.id; for (let i = 0; i < 75; i++) { await new Promise((r) => setTimeout(r, 1200)); const poll = await fetch(`${baseUrl}/api/mcp/relay?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }); if (!poll.ok) throw new Error(`Relay poll failed (${poll.status})`); const request = (await poll.json()).request; if (request.status === "complete") { const value = open(request.response_enc); if (value && typeof value === "object" && typeof value.weaveforgeError === "string") throw new Error(value.weaveforgeError); return value; } if (request.status !== "pending" && request.status !== "claimed") throw new Error(`Relay ${request.status}`); } throw new Error("Timed out waiting for the unlocked WeaveForge browser."); }
function write(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
let input = "";
process.stdin.setEncoding("utf8");
// One JSON-RPC message per line. A line that does not parse is answered with
// a parse error and skipped: it used to be parsed outside the try below, so a
// single malformed byte on stdin threw out of the "data" handler and killed
// the whole server, taking a working session with it.
process.stdin.on("data", (chunk) => {
  input += chunk;
  let line;
  while ((line = input.indexOf("\n")) >= 0) {
    const raw = input.slice(0, line);
    input = input.slice(line + 1);
    if (!raw.trim()) continue;
    let message;
    try { message = JSON.parse(raw); } catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    void handle(message);
  }
});
async function handle(message) {
  // A notification carries no id and takes no reply — including the
  // `notifications/initialized` every client sends right after the handshake.
  const isRequest = message.id !== undefined && message.id !== null;
  try {
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "weaveforge-research", version: "0.1.0" } };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list") result = { tools };
    else if (message.method === "tools/call") result = { content: [{ type: "text", text: JSON.stringify(await relay({ tool: message.params.name, arguments: message.params.arguments ?? {} })) }] };
    // Anything else gets a real "method not found". Staying silent here left a
    // client that asked for, say, resources/list waiting on a reply that was
    // never coming, which reads as a hung connection rather than a decline.
    else if (isRequest) return write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
    else return;
    if (isRequest) write({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    if (isRequest) write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
  }
}
