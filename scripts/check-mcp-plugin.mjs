#!/usr/bin/env node
/**
 * Drive the stdio MCP server the way a client does, and fail if it misbehaves.
 *
 * Nothing else exercises `plugins/weaveforge-research/mcp-server/index.mjs` — it
 * is outside every workspace, so no unit test imports it and no typecheck sees
 * it. Both bugs this check pins down were found by connecting to it by hand:
 * a request for an unimplemented method got no reply at all (the client waits
 * forever on a connection that looks alive), and one unparseable line on stdin
 * threw out of the "data" handler and killed the process mid-session.
 *
 * No relay is involved. `tools/call` is deliberately not exercised here; it
 * needs an unlocked browser at the other end, which is what the E2E suite is
 * for. Everything below is protocol behaviour the server owns on its own.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAiToolNames } from "./lib/ai-tool-names.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const server = join(root, "plugins/weaveforge-research/mcp-server/index.mjs");

const child = spawn(process.execPath, [server], {
  // The server refuses to start without a full connection config. These are
  // never used: nothing here reaches the relay.
  env: {
    ...process.env,
    WEAVEFORGE_MCP_URL: "http://127.0.0.1:1",
    WEAVEFORGE_MCP_TOKEN: "unused",
    WEAVEFORGE_MCP_SESSION: "unused",
    WEAVEFORGE_MCP_PAIRING_SECRET: "unused",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const pending = new Map();
let stdout = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  let end;
  while ((end = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, end);
    stdout = stdout.slice(end + 1);
    if (line.trim()) pending.get(JSON.parse(line).id)?.(JSON.parse(line));
  }
});

/** Send one message; resolve with the reply, or reject if none arrives. */
function request(message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No reply to ${message.method} within ${timeoutMs}ms.`)),
      timeoutMs,
    );
    pending.set(message.id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

try {
  const init = await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  check(typeof init.result?.protocolVersion === "string", "initialize returns a protocolVersion");
  check(init.result?.capabilities?.tools !== undefined, "initialize advertises the tools capability");

  const listed = await request({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = (listed.result?.tools ?? []).map((tool) => tool.name);
  for (const name of readAiToolNames(root)) {
    check(names.includes(name), `tools/list offers ${name}`);
  }
  check(
    (listed.result?.tools ?? []).every((tool) => tool.description && tool.inputSchema),
    "every listed tool has a description and an input schema",
  );

  check((await request({ jsonrpc: "2.0", id: 3, method: "ping" })).result !== undefined, "ping is answered");

  const unknown = await request({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  check(unknown.error?.code === -32601, "an unimplemented method answers -32601 rather than nothing");

  // A notification takes no reply, and a bad line must not be fatal. Neither
  // is directly observable, so both are proved by what still works after.
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  child.stdin.write("{ not json\n");
  const after = await request({ jsonrpc: "2.0", id: 5, method: "tools/list" });
  check(Array.isArray(after.result?.tools), "the server survives a notification and an unparseable line");
} catch (error) {
  failures.push(error.message);
} finally {
  child.kill();
}

if (failures.length) {
  console.error("FAIL: MCP plugin server");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("check:mcp-plugin passed");
