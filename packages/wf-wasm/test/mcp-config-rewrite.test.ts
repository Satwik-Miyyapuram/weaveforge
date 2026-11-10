import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { isElectronMcpEntry, mcpFileOf, rewriteMcpConfig } from "../src/mcp-config-rewrite.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const launch = {
  command: "/opt/weaveforge/node",
  args: ["/opt/weaveforge/mcp/weaveforge-mcp.mjs"],
  env: { NODE_ENV: "production" },
};

const oldEntry = {
  command: "/electron",
  args: ["/old/weaveforge-mcp.mjs"],
  env: { ELECTRON_RUN_AS_NODE: "1", KEEP: "x" },
};

test("an Electron bridge entry is recognised by its env and bridge arg", () => {
  assert.equal(isElectronMcpEntry(oldEntry), true);
  assert.equal(isElectronMcpEntry({ ...oldEntry, env: { ELECTRON_RUN_AS_NODE: "0" } }), false);
  assert.equal(isElectronMcpEntry({ command: "npx", args: ["x"] }), false);
});

test("mcpFileOf is the basename of the env's file, or mcp.json", () => {
  assert.equal(mcpFileOf({}), "mcp.json");
  assert.equal(mcpFileOf({ WEAVEFORGE_MCP_FILE: "/a/mcp-dev.json" }), "mcp-dev.json");
});

test("rewriteMcpConfig moves our entry to the launch and reports the change", () => {
  const config = { mcpServers: { weaveforge: oldEntry, other: { command: "npx" } } };
  const result = rewriteMcpConfig(config, "mcpServers", launch) as {
    changed: boolean;
    config: { mcpServers: Record<string, unknown> };
  };
  assert.equal(result.changed, true);
  assert.deepEqual(result.config.mcpServers.weaveforge, {
    command: "/opt/weaveforge/node",
    args: ["/opt/weaveforge/mcp/weaveforge-mcp.mjs"],
    env: { KEEP: "x", NODE_ENV: "production" },
  });
  assert.deepEqual(result.config.mcpServers.other, { command: "npx" });
});
