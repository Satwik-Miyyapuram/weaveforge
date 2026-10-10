import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const BRIDGE = resolve(__dirname, "../../../plugins/weaveforge-research/mcp-server/index.mjs");

/** Run the bridge over stdio: send each line, collect one answer per request with an id. */
async function runBridge(
  lines: unknown[],
  env: Record<string, string>,
  home: string,
): Promise<{ answers: Record<string, unknown>[]; stderr: string }> {
  const child = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, HOME: home, USERPROFILE: home, WEAVEFORGE_TOKEN: "", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  for (const line of lines) child.stdin.write(`${typeof line === "string" ? line : JSON.stringify(line)}\n`);
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  return { answers: stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)), stderr };
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "wf-bridge-"));
}

test("forwards JSON-RPC to the app with the saved token, and stays quiet on notifications", async () => {
  const seen: { auth?: string; body: unknown }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      seen.push({ auth: req.headers.authorization, body: parsed });
      if (parsed.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { echoed: parsed.method } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const home = tempHome();
  const file = join(home, "mcp.json");
  writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${port}/mcp`, token: "abc" }));
  try {
    const { answers } = await runBridge(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        "not json",
      ],
      { WEAVEFORGE_MCP_FILE: file },
      home,
    );
    assert.deepEqual(seen.map((s) => s.auth), ["Bearer abc", "Bearer abc", "Bearer abc"]);
    assert.deepEqual(answers, [
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Not JSON." } },
      { jsonrpc: "2.0", id: 1, result: { echoed: "initialize" } },
      { jsonrpc: "2.0", id: 2, result: { echoed: "tools/list" } },
    ]);
  } finally {
    server.close();
  }
});

test("with the app closed, starts from cached tools and says to open WeaveForge", async () => {
  const home = tempHome();
  mkdirSync(join(home, ".weaveforge", "mcp"), { recursive: true });
  writeFileSync(join(home, ".weaveforge", "mcp", "tools.json"), JSON.stringify({ tools: [{ name: "search_workspace" }] }));
  const file = join(home, "mcp.json");
  // Port 9 (discard) is closed on loopback: the connection is refused.
  writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:9/mcp", token: "abc" }));
  const { answers } = await runBridge(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_workspace", arguments: {} } },
    ],
    { WEAVEFORGE_MCP_FILE: file },
    home,
  );
  assert.equal((answers[0]!.result as { serverInfo: { name: string } }).serverInfo.name, "weaveforge-workspace");
  assert.deepEqual(answers[1]!.result, { tools: [{ name: "search_workspace" }] });
  const call = answers[2]!.result as { isError: boolean; content: { text: string }[] };
  assert.equal(call.isError, true);
  assert.match(call.content[0]!.text, /Open WeaveForge/);
});

test("without a token, tells the user to connect; never sends to a host off this computer", async () => {
  const home = tempHome();
  const missing = await runBridge(
    [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } }],
    { WEAVEFORGE_MCP_FILE: join(home, "none.json") },
    home,
  );
  assert.match((missing.answers[0]!.result as { content: { text: string }[] }).content[0]!.text, /Connect/);

  const remote = await runBridge(
    [{ jsonrpc: "2.0", id: 1, method: "tools/list" }],
    { WEAVEFORGE_MCP_FILE: join(home, "none.json"), WEAVEFORGE_MCP_URL: "https://example.com/mcp", WEAVEFORGE_TOKEN: "abc" },
    home,
  );
  assert.match((remote.answers[0]!.error as { message: string }).message, /127\.0\.0\.1/);
});
