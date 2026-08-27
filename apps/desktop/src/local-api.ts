import { timingSafeEqual } from "node:crypto";

import { routeMcpRequest, type JsonRpcRequest, type SemanticRanker } from "./local-mcp";
import { routeSdkRequest, type SdkQuery } from "./local-sdk-api";
import type { VaultSession } from "./vault-handlers";
import { listVaultFiles, readVaultFile, removeVaultFile, writeVaultFile } from "./vault-handlers";

/**
 * The local HTTP surface, minus the socket.
 *
 * Route shapes follow `obsidian-local-rest-api` rather than anything of our
 * own: an API of our own design has no clients, and this one has clients
 * already written. Matching an existing shape costs about what inventing one
 * would.
 *
 * Everything here goes through `vault-handlers`, which means through
 * `NodeWorkspaceFs`, which means through `safeWorkspacePath`. The network
 * surface must not become the one path into the folder that skips the guard —
 * so it does not get its own filesystem access to skip it with.
 *
 * The socket lives in `main.ts`. What is worth testing is which requests are
 * answered and which are refused, and that is all in this file.
 */

export interface LocalApiRequest {
  method: string;
  /** Path and query, as `http` hands it over. */
  url: string;
  /** The `Authorization` header, verbatim, or undefined when absent. */
  authorization?: string;
  body?: string;
}

export interface LocalApiResponse {
  status: number;
  contentType: string;
  body: string;
}

const UNAUTHORIZED = "A bearer token is required.";
const NOT_FOUND = "No such route.";

/** How many files a search will read before it stops. */
const SEARCH_LIMIT = 2_000;
/** How much of a matching line comes back with each hit. */
const CONTEXT = 120;

function json(status: number, value: unknown): LocalApiResponse {
  return { status, contentType: "application/json", body: JSON.stringify(value) };
}

function fail(status: number, message: string): LocalApiResponse {
  return json(status, { errorCode: status, message });
}

/**
 * Whether the request carries the right token.
 *
 * Compared in constant time. The token is the only thing between a loopback
 * port and every file in the folder, and a comparison that returns early tells
 * an attacker on the same machine how much of a guess was right.
 */
export function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!expected) return false;
  const offered = /^Bearer (.+)$/.exec(header ?? "")?.[1];
  if (!offered) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every file under `dir`, depth-first, up to a cap. */
export async function walkVault(session: VaultSession, dir: string, out: string[]): Promise<void> {
  if (out.length >= SEARCH_LIMIT) return;
  const listed = await listVaultFiles(session, dir);
  if (!listed.ok) return;
  for (const entry of listed.value) {
    if (out.length >= SEARCH_LIMIT) return;
    if (entry.kind === "dir") await walkVault(session, entry.path, out);
    else out.push(entry.path);
  }
}

export interface VaultSearchHit {
  filename: string;
  matches: { context: string }[];
}

/**
 * Which markdown files under `dir` mention `query`, and the lines that did.
 *
 * Shared with the MCP surface rather than reimplemented there: two searches
 * over one folder would eventually disagree about what counts as a match, and
 * the one an agent uses is not the one a person would notice was wrong.
 */
export async function searchVault(
  session: VaultSession,
  query: string,
  dir = "",
): Promise<VaultSearchHit[]> {
  const files: string[] = [];
  await walkVault(session, dir, files);

  const needle = query.toLowerCase();
  const results: VaultSearchHit[] = [];
  for (const filename of files) {
    if (!filename.endsWith(".md")) continue;
    const read = await readVaultFile(session, filename);
    if (!read.ok || read.value === null) continue;
    const matches: { context: string }[] = [];
    for (const line of read.value.split(/\r?\n/)) {
      if (!line.toLowerCase().includes(needle)) continue;
      matches.push({ context: line.slice(0, CONTEXT) });
      // One file that mentions the word forty times is one result worth
      // showing, not forty; the client asked what matched, not how often.
      if (matches.length >= 5) break;
    }
    if (matches.length) results.push({ filename, matches });
  }
  return results;
}

async function simpleSearch(session: VaultSession, query: string): Promise<LocalApiResponse> {
  if (!query) return fail(400, "A search needs a query.");
  return json(200, await searchVault(session, query));
}

/**
 * Answer one request.
 *
 * `expected` is the install's token. It is passed in rather than read here so
 * that a caller with no token — the server before one has been generated —
 * cannot accidentally end up comparing against an empty string that matches.
 */
export async function routeLocalRequest(
  session: VaultSession,
  request: LocalApiRequest,
  expected: string,
  query?: SdkQuery,
  rank?: SemanticRanker,
): Promise<LocalApiResponse> {
  if (!tokenMatches(request.authorization, expected)) return fail(401, UNAUTHORIZED);

  const url = new URL(request.url, "http://127.0.0.1");
  const path = decodeURIComponent(url.pathname);

  // The Python SDK's routes, when this copy has a database to answer them
  // from. Without one — a shell that has never opened the local database — the
  // paths are simply not served, rather than served and failing.
  if (query) {
    const answered = await routeSdkRequest(query, request, url, path);
    if (answered) return answered;
  }

  if (path === "/mcp") {
    if (request.method !== "POST") return fail(405, "MCP is spoken over POST.");
    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(request.body ?? "") as JsonRpcRequest;
    } catch {
      return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Not JSON." } });
    }
    const answer = await routeMcpRequest(session, parsed, rank);
    // A notification is answered with no body at all, which is what a client
    // sending `notifications/initialized` waits for.
    return answer === null
      ? { status: 202, contentType: "application/json", body: "" }
      : json(200, answer);
  }

  if (path === "/search/simple/" && request.method === "POST") {
    return simpleSearch(session, url.searchParams.get("query") ?? "");
  }

  if (path.startsWith("/vault/")) {
    const relative = path.slice("/vault/".length);

    if (relative === "" || relative.endsWith("/")) {
      if (request.method !== "GET") return fail(405, "A directory is read, not written.");
      const listed = await listVaultFiles(session, relative.replace(/\/$/, ""));
      if (!listed.ok) return fail(400, listed.message);
      return json(200, {
        files: listed.value.map((entry) => (entry.kind === "dir" ? `${entry.path}/` : entry.path)),
      });
    }

    switch (request.method) {
      case "GET": {
        const read = await readVaultFile(session, relative);
        if (!read.ok) return fail(400, read.message);
        if (read.value === null) return fail(404, "No such file.");
        return { status: 200, contentType: "text/markdown", body: read.value };
      }
      case "PUT": {
        const written = await writeVaultFile(session, relative, request.body ?? "");
        return written.ok ? { status: 204, contentType: "text/plain", body: "" } : fail(400, written.message);
      }
      case "DELETE": {
        const removed = await removeVaultFile(session, relative);
        return removed.ok ? { status: 204, contentType: "text/plain", body: "" } : fail(400, removed.message);
      }
      default:
        return fail(405, "That method is not served here.");
    }
  }

  // Deliberately absent: the active note, and the command list. Both are the
  // running app's, not the shell's, and a shell that answered for them would
  // be guessing about a window it does not own.
  return fail(404, NOT_FOUND);
}
