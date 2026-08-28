import {
  ENTITY_DIRS,
  WORKSPACE_META_DIR,
  mcpReadResult,
  type UntrustedItem,
  type WorkspaceEntityType,
} from "@weaveforge/core";

import { searchVault, walkVault } from "./local-api";
import type { VaultSession } from "./vault-handlers";
import { readVaultFile, writeVaultFile } from "./vault-handlers";

/**
 * The folder as an MCP server, on the same loopback port.
 *
 * This is the local sibling of the relayed MCP in `ai-mcp-gateway.ts`, and it
 * is deliberately the smaller of the two: that one reaches the whole workspace
 * through a paired browser and can queue proposals; this one reads the folder
 * that is already on the disk, for an agent already running on the machine.
 * Nothing here writes to anything the reader owns. The one tool that writes at
 * all leaves a proposal in `.weaveforge/proposals/`, which nothing reads back
 * automatically -- an agent can suggest a change to a report section, and a
 * person still has to open it and decide. An agent that wants to change the
 * workspace itself uses the HTTP surface's `PUT`, where the user has at least
 * chosen to open the door.
 *
 * What makes it worth having over a vault-backed server: papers, reading lists,
 * experiments and the logbook are separate kinds here, not folders that happen
 * to contain markdown, so `kind` is a real filter and an agent can ask "which
 * papers mention this" rather than "which files".
 *
 * Every result goes through `mcpReadResult`. The manifest says results from
 * this workspace are untrusted, and a result that skipped the wrapper would
 * quietly make that declaration false.
 */

/** JSON-RPC, the subset a streamable-HTTP MCP client actually sends. */
export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const PROTOCOL_VERSION = "2025-06-18";

/**
 * Reorders the files a word search found, best first.
 *
 * Given as an argument rather than built here: the encoder lives in the window,
 * which may not be open, and a server that could not answer without one would
 * be worse than a server that answers by word.
 */
export type SemanticRanker = (query: string, candidates: readonly string[]) => Promise<string[] | null>;

/** Apply a ranking, keeping anything it did not mention in its old place. */
function reorder<T extends { filename: string }>(hits: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return [...hits].sort(
    (a, b) => (rank.get(a.filename) ?? order.length) - (rank.get(b.filename) ?? order.length),
  );
}

/** What an agent may ask for, by kind. `all` is the absence of a filter. */
const KINDS = Object.keys(ENTITY_DIRS) as WorkspaceEntityType[];

const TOOLS = [
  {
    name: "search_workspace",
    description:
      "Search the workspace folder for text. Optionally restrict to one kind: " +
      `${KINDS.join(", ")}.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for, case-insensitive." },
        kind: { type: "string", enum: KINDS, description: "Restrict to one kind of entry." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_workspace",
    description: "List the entries of one kind in the workspace folder.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: KINDS } },
      required: ["kind"],
    },
  },
  {
    name: "get_report_section",
    description: "Read one report section, by its id or a word from its title.",
    inputSchema: {
      type: "object",
      properties: { section: { type: "string", description: "The section's id, or part of its title." } },
      required: ["section"],
    },
  },
  {
    name: "list_experiments",
    description: "List the experiments in the workspace folder.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_experiment",
    description: "Read one experiment, by its id or a word from its title.",
    inputSchema: {
      type: "object",
      properties: { experiment: { type: "string" } },
      required: ["experiment"],
    },
  },
  {
    name: "get_paper",
    description: "Read one paper's entry, by its id or a word from its title.",
    inputSchema: {
      type: "object",
      properties: { paper: { type: "string" } },
      required: ["paper"],
    },
  },
  {
    name: "propose_report_edit",
    description:
      "Leave a suggested rewrite of a report section in .weaveforge/proposals/. " +
      "This never changes the section itself; a person opens the proposal and decides.",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", description: "The section's id, or part of its title." },
        proposal: { type: "string", description: "The suggested text." },
        rationale: { type: "string", description: "Why, in a sentence or two." },
      },
      required: ["section", "proposal"],
    },
  },
  {
    name: "read_entry",
    description: "Read one file from the workspace folder, by its path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
] as const;

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: JsonRpcResponse["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** A tool answer, fenced and bounded, in the shape MCP expects. */
function content(items: readonly UntrustedItem[]): unknown {
  const result = mcpReadResult(items);
  return {
    content: [{ type: "text", text: result.text }],
    // Repeated outside the text so a client that renders structured metadata
    // can show the same boundary the fence draws inside it.
    _meta: { nonce: result.nonce, omitted: result.omitted, truncated: result.truncated },
  };
}

/** Where a suggestion waits for a person, never mixed in with their own files. */
const PROPOSALS_DIR = `${WORKSPACE_META_DIR}/proposals`;

/** Sortable, filename-safe, and second-resolution, which is enough here. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * The one file a name refers to.
 *
 * Ids are exact and titles are not, so an id wins outright and a title has to
 * be unambiguous: two sections that both match "methods" is a question to ask
 * back, not a coin to flip.
 */
async function findEntry(
  session: VaultSession,
  kind: WorkspaceEntityType,
  needle: unknown,
): Promise<{ filename: string; text: string }> {
  const wanted = typeof needle === "string" ? needle.trim().toLowerCase() : "";
  if (!wanted) throw new Error("That needs an id or a title to look for.");

  const files: string[] = [];
  await walkVault(session, ENTITY_DIRS[kind], files);
  const candidates = files.filter((file) => file.toLowerCase().includes(wanted));
  if (!candidates.length) throw new Error(`Nothing in ${ENTITY_DIRS[kind]} matches '${wanted}'.`);
  if (candidates.length > 1) {
    throw new Error(`'${wanted}' matches ${candidates.length} of them: ${candidates.join(", ")}`);
  }

  const filename = candidates[0] as string;
  const read = await readVaultFile(session, filename);
  if (!read.ok) throw new Error(read.message);
  if (read.value === null) throw new Error(`${filename} is gone.`);
  return { filename, text: read.value };
}

async function oneEntry(
  session: VaultSession,
  kind: WorkspaceEntityType,
  needle: unknown,
): Promise<UntrustedItem> {
  const found = await findEntry(session, kind, needle);
  return { label: found.filename, text: found.text };
}

function kindOf(params: Record<string, unknown>): WorkspaceEntityType | null {
  const kind = params.kind;
  return typeof kind === "string" && (KINDS as string[]).includes(kind)
    ? (kind as WorkspaceEntityType)
    : null;
}

async function callTool(
  session: VaultSession,
  name: string,
  params: Record<string, unknown>,
  rank?: SemanticRanker,
): Promise<unknown> {
  switch (name) {
    case "search_workspace": {
      const query = typeof params.query === "string" ? params.query : "";
      if (!query) throw new Error("A search needs a query.");
      const kind = kindOf(params);
      const hits = await searchVault(session, query, kind ? ENTITY_DIRS[kind] : "");
      // Ranked by meaning when this copy has an encoder loaded, and left in
      // the order the word search found them when it does not. An agent asking
      // "what did I conclude about attrition" wants the note that says it in
      // other words, which a word search cannot offer.
      const ordered = rank ? await rank(query, hits.map((hit) => hit.filename)) : null;
      const ranked = ordered ? reorder(hits, ordered) : hits;
      return content(
        ranked.map((hit) => ({ label: hit.filename, text: hit.matches.map((m) => m.context).join("\n") })),
      );
    }
    case "list_workspace": {
      const kind = kindOf(params);
      if (!kind) throw new Error("That is not a kind this workspace keeps.");
      const files: string[] = [];
      await walkVault(session, ENTITY_DIRS[kind], files);
      return content([{ label: ENTITY_DIRS[kind], text: files.join("\n") || "(nothing yet)" }]);
    }
    case "get_report_section":
      return content([await oneEntry(session, "report_section", params.section)]);
    case "get_experiment":
      return content([await oneEntry(session, "experiment", params.experiment)]);
    case "get_paper":
      return content([await oneEntry(session, "paper", params.paper)]);
    case "list_experiments": {
      const files: string[] = [];
      await walkVault(session, ENTITY_DIRS.experiment, files);
      return content([{ label: ENTITY_DIRS.experiment, text: files.join("\n") || "(nothing yet)" }]);
    }
    case "propose_report_edit": {
      const proposal = typeof params.proposal === "string" ? params.proposal.trim() : "";
      if (!proposal) throw new Error("A proposal needs some text to propose.");
      const target = await findEntry(session, "report_section", params.section);
      const at = `${PROPOSALS_DIR}/${stamp()}--${target.filename.split("/").pop()}`;
      const rationale = typeof params.rationale === "string" ? params.rationale.trim() : "";
      const written = await writeVaultFile(
        session,
        at,
        [
          `# Proposed edit to ${target.filename}`,
          "",
          rationale ? `${rationale}\n` : "",
          "---",
          "",
          proposal,
          "",
        ].join("\n"),
      );
      if (!written.ok) throw new Error(written.message);
      // The path, and nothing of the proposal read back: the agent wrote it and
      // does not need to be told what it said.
      return content([{ label: "proposal", text: `Left at ${at}. Nothing else changed.` }]);
    }
    case "read_entry": {
      const at = typeof params.path === "string" ? params.path : "";
      const read = await readVaultFile(session, at);
      if (!read.ok) throw new Error(read.message);
      if (read.value === null) throw new Error("No such file.");
      return content([{ label: at, text: read.value }]);
    }
    default:
      throw new Error(`No tool named ${name}.`);
  }
}

/**
 * Answer one JSON-RPC request.
 *
 * A notification — a request with no id — is answered with null, and the
 * transport sends nothing back, which is what the protocol asks for.
 */
export async function routeMcpRequest(
  session: VaultSession,
  request: JsonRpcRequest,
  rank?: SemanticRanker,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const params = request.params ?? {};

  switch (request.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "weaveforge-workspace", version: "1" },
      });
    case "notifications/initialized":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      try {
        return ok(id, await callTool(session, name, args, rank));
      } catch (error) {
        // Reported as a tool error rather than a protocol one: the call was
        // well-formed and the answer is "no", which is a result the agent can
        // act on rather than a transport fault it should retry.
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : "That did not work." }],
        });
      }
    }
    default:
      return id === null ? null : err(id, -32601, `No method named ${request.method ?? ""}.`);
  }
}
