import {
  ENTITY_DIRS,
  mcpReadResult,
  type UntrustedItem,
  type WorkspaceEntityType,
} from "@weaveforge/core";

import { searchVault, walkVault } from "./local-api";
import type { VaultSession } from "./vault-handlers";
import { readVaultFile } from "./vault-handlers";

/**
 * The folder as an MCP server, on the same loopback port.
 *
 * This is the local sibling of the relayed MCP in `ai-mcp-gateway.ts`, and it
 * is deliberately the smaller of the two: that one reaches the whole workspace
 * through a paired browser and can queue proposals; this one reads the folder
 * that is already on the disk, for an agent already running on the machine.
 * Nothing here writes. An agent that wants to change the workspace uses the
 * HTTP surface's `PUT`, where the user has at least chosen to open the door.
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
): Promise<unknown> {
  switch (name) {
    case "search_workspace": {
      const query = typeof params.query === "string" ? params.query : "";
      if (!query) throw new Error("A search needs a query.");
      const kind = kindOf(params);
      const hits = await searchVault(session, query, kind ? ENTITY_DIRS[kind] : "");
      return content(
        hits.map((hit) => ({ label: hit.filename, text: hit.matches.map((m) => m.context).join("\n") })),
      );
    }
    case "list_workspace": {
      const kind = kindOf(params);
      if (!kind) throw new Error("That is not a kind this workspace keeps.");
      const files: string[] = [];
      await walkVault(session, ENTITY_DIRS[kind], files);
      return content([{ label: ENTITY_DIRS[kind], text: files.join("\n") || "(nothing yet)" }]);
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
        return ok(id, await callTool(session, name, args));
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
