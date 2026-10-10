#!/usr/bin/env node
// WeaveForge MCP bridge: stdio (one JSON-RPC message per line) to the desktop
// app's MCP endpoint on 127.0.0.1. No dependencies, nothing leaves this computer.
//
// Reads { url, token } from ~/.weaveforge/mcp.json on every request, so
// connecting or disconnecting in the app takes effect without a restart.
// Overrides: WEAVEFORGE_TOKEN, WEAVEFORGE_MCP_URL, WEAVEFORGE_MCP_FILE.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_URL = "http://127.0.0.1:27123/mcp";
const HOME_DIR = join(homedir(), ".weaveforge");
const CONFIG_FILE = process.env.WEAVEFORGE_MCP_FILE || join(HOME_DIR, "mcp.json");
// Beside the copy Connect made, else the default copy (a plugin install runs from its own folder).
const BESIDE = join(dirname(fileURLToPath(import.meta.url)), "tools.json");
const TOOLS_FILE = existsSync(BESIDE) ? BESIDE : join(HOME_DIR, "mcp", "tools.json");
const CONNECT_HINT = "Open WeaveForge, go to Settings → AI & MCP and press Connect.";
const CLOSED_HINT = "WeaveForge is not running. Open WeaveForge, then try again.";

function log(message) {
  process.stderr.write(`[weaveforge-mcp] ${message}\n`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Only plain http to this computer: the token must never travel further. */
function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function settings() {
  const file = readJson(CONFIG_FILE) ?? {};
  const url = process.env.WEAVEFORGE_MCP_URL || (typeof file.url === "string" ? file.url : DEFAULT_URL);
  const token = process.env.WEAVEFORGE_TOKEN || (typeof file.token === "string" ? file.token : "");
  return { url, token };
}

function reply(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function failure(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolError(id, text) {
  return reply(id, { isError: true, content: [{ type: "text", text }] });
}

/** What to answer when the app cannot be reached, so a client can still start. */
function offline(request, why) {
  const id = request.id ?? null;
  switch (request.method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "weaveforge-workspace", version: "1" },
      });
    case "ping":
      return reply(id, {});
    case "tools/list": {
      const cached = readJson(TOOLS_FILE);
      return reply(id, { tools: Array.isArray(cached?.tools) ? cached.tools : [] });
    }
    case "tools/call":
      return toolError(id, why);
    default:
      return failure(id, -32601, `No method named ${request.method ?? ""}.`);
  }
}

async function forward(request) {
  const isNotification = request.id === undefined || request.id === null;
  const { url, token } = settings();
  if (!isLoopbackUrl(url)) {
    log(`refusing ${url}: only http://127.0.0.1 is allowed`);
    return isNotification ? null : failure(request.id, -32000, "WeaveForge MCP only talks to 127.0.0.1.");
  }
  if (!token) return isNotification ? null : offline(request, `Not connected. ${CONNECT_HINT}`);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
    });
  } catch (error) {
    log(`cannot reach ${url}: ${error?.cause?.code ?? error?.message ?? error}`);
    return isNotification ? null : offline(request, CLOSED_HINT);
  }
  if (response.status === 401 || response.status === 403) {
    await response.text();
    return isNotification ? null : offline(request, `The saved token was refused. ${CONNECT_HINT}`);
  }
  const body = await response.text();
  if (isNotification || !body) return null;
  try {
    return JSON.parse(body);
  } catch {
    log(`unexpected answer (${response.status}): ${body.slice(0, 200)}`);
    return failure(request.id, -32000, `WeaveForge answered ${response.status}.`);
  }
}

function write(message) {
  if (message) process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
lines.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write(failure(null, -32700, "Not JSON."));
    return;
  }
  // In order, one at a time: clients match answers by id, but logs read better.
  queue = queue.then(() => forward(request).then(write, (error) => {
    log(error?.stack ?? String(error));
    if (request.id !== undefined && request.id !== null) write(failure(request.id, -32603, "Bridge error."));
  }));
});
lines.on("close", () => {
  void queue.then(() => process.exit(0));
});
