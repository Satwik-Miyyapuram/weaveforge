#!/usr/bin/env node
/**
 * Drive the stdio MCP bridge the way a client does, with the app closed, and fail if it misbehaves.
 *
 * Pins two bugs found by hand: an unimplemented method got no reply (the client
 * waits forever), and one unparseable line killed the process mid-session.
 * Forwarding to a running app is covered by apps/desktop/test/mcp-bridge.test.ts.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listedTools } from "../apps/desktop/src/local-mcp.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const server = join(root, "plugins/weaveforge-research/mcp-server/index.mjs");

// Nothing bumps the client manifests on release, so a stale one is caught here.
const version = (file) => JSON.parse(readFileSync(join(root, file), "utf8")).version;
for (const file of ["plugins/weaveforge-research/.claude-plugin/plugin.json", "plugins/weaveforge-research/.codex-plugin/plugin.json", "gemini-extension.json"])
  if (version(file) !== version("package.json")) throw new Error(`${file} is version ${version(file)}, the app is ${version("package.json")}.`);

// A fresh home: no token, and the tool list Connect would have cached.
const home = mkdtempSync(join(tmpdir(), "wf-mcp-check-"));
mkdirSync(join(home, ".weaveforge", "mcp"), { recursive: true });
const tools = listedTools(true);
writeFileSync(join(home, ".weaveforge", "mcp", "tools.json"), JSON.stringify({ tools }));

const child = spawn(process.execPath, [server], {
  env: { ...process.env, HOME: home, USERPROFILE: home, WEAVEFORGE_MCP_FILE: join(home, "none.json") },
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
  for (const { name } of tools) check(names.includes(name), `tools/list offers ${name}`);
  check(names.includes("experiment_tracking_setup"), "tools/list offers experiment_tracking_setup");

  const call = await request({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_tags", arguments: {} } });
  check(call.result?.isError === true && /Connect/.test(call.result.content?.[0]?.text ?? ""), "tools/call without a token says to connect");
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
