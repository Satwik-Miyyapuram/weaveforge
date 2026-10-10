import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { unzipSync, strFromU8 } from "fflate";

import { CHANNELS } from "../src/channels";
import type { IpcSurface } from "../src/ipc-guard";
import { hashLocalApiToken } from "../src/local-api-server";
import type { LocalDbHost } from "../src/local-db-host";
import { registerMainLocalApi } from "../src/main-local-api";
import { mcpLaunch, mcpPaths, readMcpConnection, writeMcpConnection } from "../src/mcp-connect";
import { PreferenceStore } from "../src/preference-store";
import { SecretStore } from "../src/secret-store";
import type { VaultSession } from "../src/vault-handlers";

const BRIDGE = path.resolve(__dirname, "../../../plugins/weaveforge-research/mcp-server/index.mjs");

function home(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-"));
}

function memoryFile() {
  let contents: string | null = null;
  return { read: async () => contents, write: async (next: string) => void (contents = next) };
}

/** The handlers registerMainLocalApi installs, callable without Electron. */
function shell(dir: string, variant?: string) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcSurface = {
    handle: (channel, listener) => void handlers.set(channel, (...args) => listener({} as never, ...args)),
    on: () => {},
  };
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  };
  const secrets = new SecretStore(crypto, memoryFile());
  const preferences = new PreferenceStore(memoryFile());
  const paths = mcpPaths(dir, variant, BRIDGE);
  const opened: string[] = [];
  const api = registerMainLocalApi({
    ipc,
    vault: {} as VaultSession,
    localDb: {} as LocalDbHost,
    mainWindow: () => null,
    preferenceStore: () => preferences,
    secretStore: () => secrets,
    artifactRoot: path.join(dir, "artifacts"),
    mcpPaths: paths,
    execPath: "/apps/WeaveForge.exe",
    version: "9.9.9",
    open: { url: async (url) => void opened.push(url), path: async (file) => (opened.push(file), "") },
  });
  const call = async (channel: string, ...args: unknown[]) =>
    (await handlers.get(channel)!(...args)) as { ok: boolean; value?: any; message?: string };
  return { api, call, paths, secrets, opened };
}

test("mcp paths: the main app and WeaveForge Dev never share a token file", () => {
  const a = mcpPaths("/h", undefined, "/b.mjs");
  const b = mcpPaths("/h", "dev", "/b.mjs");
  assert.equal(a.file, path.join("/h", ".weaveforge", "mcp.json"));
  assert.equal(b.file, path.join("/h", ".weaveforge", "mcp-dev.json"));
  assert.notEqual(a.dir, b.dir);
  assert.deepEqual(mcpLaunch(a, "/x.exe").env, { ELECTRON_RUN_AS_NODE: "1" });
  assert.deepEqual(mcpLaunch(b, "/x.exe").env, { ELECTRON_RUN_AS_NODE: "1", WEAVEFORGE_MCP_FILE: b.file });
});

test("mcp connect: the copied bridge answers tools/list from the tools.json beside it, app closed", async () => {
  const dir = home();
  const paths = mcpPaths(dir, "dev", BRIDGE);
  const tools = [{ name: "only_here", inputSchema: { type: "object" } }];
  await writeMcpConnection(paths, { url: "http://127.0.0.1:9/mcp", apiUrl: "http://127.0.0.1:9", token: "t", tokenId: "i" }, tools);
  const launch = mcpLaunch(paths, process.execPath);
  const out = execFileSync(launch.command, launch.args, {
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`,
    env: { ...process.env, ...launch.env, HOME: dir, USERPROFILE: dir },
  }).toString();
  assert.deepEqual(JSON.parse(out).result.tools, tools);
});

test("mcp connect: one AI clients token, reused, written to the file, revoked on disconnect", async (t) => {
  const dir = home();
  const { api, call, paths } = shell(dir, "dev");
  t.after(() => api.close());

  const first = await call(CHANNELS.mcpConnect);
  assert.equal(first.ok, true, first.message);
  const saved = await readMcpConnection(paths.file);
  assert.ok(saved);
  assert.deepEqual(saved && { url: saved.url, apiUrl: saved.apiUrl }, {
    url: "http://127.0.0.1:27123/mcp",
    apiUrl: "http://127.0.0.1:27123",
  });
  const tokens = first.value.tokens as { id: string; name: string; permissions: string[] }[];
  assert.deepEqual(tokens.map((x) => [x.name, x.permissions]), [["AI clients", ["mcp:read", "mcp:suggest", "experiments"]]]);
  assert.equal(tokens[0]?.id, saved!.tokenId);
  assert.ok(!JSON.stringify(first.value).includes(saved!.token), "the token never goes to the page");
  assert.equal(first.value.mcp.connected, true);
  assert.equal(first.value.mcp.launch.env.WEAVEFORGE_MCP_FILE, paths.file);
  assert.ok(fs.existsSync(path.join(paths.dir, "weaveforge-mcp.mjs")));
  const listed = JSON.parse(fs.readFileSync(path.join(paths.dir, "tools.json"), "utf8")).tools as { name: string }[];
  assert.ok(listed.some((x) => x.name === "experiment_tracking_setup"));
  if (process.platform !== "win32") assert.equal(fs.statSync(paths.file).mode & 0o777, 0o600);

  const again = await call(CHANNELS.mcpConnect);
  assert.equal(again.value.tokens.length, 1, "Connect twice keeps one token");
  assert.equal((await readMcpConnection(paths.file))!.token, saved!.token);

  const off = await call(CHANNELS.mcpDisconnect);
  assert.deepEqual(off.value.tokens, []);
  assert.equal(off.value.mcp.connected, false);
  assert.equal(fs.existsSync(paths.file), false);
});

test("mcp connect: revoking the AI clients token in Access tokens deletes the file", async (t) => {
  const { api, call, paths } = shell(home());
  t.after(() => api.close());
  const on = await call(CHANNELS.mcpConnect);
  await call(CHANNELS.localApiTokenRevoke, on.value.mcp.tokenId);
  assert.equal(fs.existsSync(paths.file), false);
});

test("mcp connect: a file whose token is no longer live is replaced, not trusted", async (t) => {
  const { api, call, paths } = shell(home());
  t.after(() => api.close());
  await writeMcpConnection(paths, { url: "u", apiUrl: "a", token: "stale", tokenId: "gone" }, []);
  const state = await call(CHANNELS.localApiState);
  assert.equal(state.value.mcp.connected, false);
  const on = await call(CHANNELS.mcpConnect);
  const saved = await readMcpConnection(paths.file);
  assert.notEqual(saved!.token, "stale");
  assert.equal(on.value.tokens.length, 1);
  assert.equal(hashLocalApiToken(saved!.token).length, 64);
});

test("mcp connect: refused when five tokens are already live", async (t) => {
  const { api, call, paths } = shell(home());
  t.after(() => api.close());
  for (let i = 0; i < 5; i++)
    await call(CHANNELS.localApiTokenCreate, { name: `t${i}`, permissions: ["rest:read"], expiresAt: null });
  const refused = await call(CHANNELS.mcpConnect);
  assert.equal(refused.ok, false);
  assert.match(refused.message!, /Revoke one/);
  assert.equal(fs.existsSync(paths.file), false);
});

test("mcp open client: install links and the .mcpb carry the launch, built here, not by the page", async (t) => {
  const { api, call, paths, opened } = shell(home(), "dev");
  t.after(() => api.close());
  assert.equal((await call(CHANNELS.mcpOpenClient, "cursor")).message, "Connect first.");
  assert.equal((await call(CHANNELS.mcpOpenClient, "https://evil.example")).message, "Unknown client.");
  assert.deepEqual(opened, []);

  await call(CHANNELS.mcpConnect);
  const launch = mcpLaunch(paths, "/apps/WeaveForge.exe");
  for (const client of ["cursor", "vscode", "claude-desktop"]) assert.equal((await call(CHANNELS.mcpOpenClient, client)).ok, true);
  const [cursor = "", vscode = "", mcpb = ""] = opened;

  const cursorUrl = new URL(cursor);
  assert.equal(cursorUrl.protocol, "cursor:");
  assert.equal(cursorUrl.searchParams.get("name"), "weaveforge");
  assert.deepEqual(JSON.parse(Buffer.from(cursorUrl.searchParams.get("config")!, "base64").toString()), launch);

  assert.ok(vscode.startsWith("vscode:mcp/install?"));
  assert.deepEqual(JSON.parse(decodeURIComponent(vscode.slice("vscode:mcp/install?".length))), { name: "weaveforge", ...launch });

  const files = unzipSync(fs.readFileSync(mcpb));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
  assert.equal(manifest.version, "9.9.9");
  assert.deepEqual(manifest.server.mcp_config, {
    command: "node",
    args: ["${__dirname}/server/index.mjs"],
    env: { WEAVEFORGE_MCP_FILE: paths.file },
  });
  assert.equal(strFromU8(files["server/index.mjs"]!), fs.readFileSync(BRIDGE, "utf8"));
  assert.ok(JSON.parse(strFromU8(files["server/tools.json"]!)).tools.length > 0);
  assert.ok(!strFromU8(files["manifest.json"]!).includes((await readMcpConnection(paths.file))!.token), "no token in the bundle");
});

test("mcp connect: port taken by another program says so instead of looking connected", async (t) => {
  const blocker = await new Promise<net.Server | null>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(null)); // already held elsewhere: same case
    s.listen(27123, "127.0.0.1", () => resolve(s));
  });
  const { api, call, paths } = shell(home());
  t.after(async () => {
    await api.close();
    blocker?.close();
  });
  const on = await call(CHANNELS.mcpConnect);
  assert.equal(on.ok, true);
  assert.equal(on.value.enabled, false);
  assert.match(on.value.reason, /Another program is using port 27123/);
  assert.ok(fs.existsSync(paths.file), "the token file is still written for when the port frees");
  const later = await call(CHANNELS.localApiState);
  assert.match(later.value.reason, /Another program is using port 27123/, "reopening Settings still says why");
});
