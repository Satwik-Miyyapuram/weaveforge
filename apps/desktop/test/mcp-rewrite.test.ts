import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isElectronEntry,
  mcpClientConfigs,
  rewriteMcpClientConfigs,
  rewriteMcpConfig,
  rewriteMcpConfigFile,
} from "../src/mcp-rewrite";

const HOME = path.join("/home", "u");
const LAUNCH = {
  command: "/app/node",
  args: ["/home/u/.weaveforge/mcp/weaveforge-mcp.mjs"],
  env: { WEAVEFORGE_MCP_FILE: "/home/u/.weaveforge/mcp-dev.json" },
};
const OLD = {
  command: "C:\\Program Files\\WeaveForge\\WeaveForge.exe",
  args: ["C:\\Users\\u\\.weaveforge\\mcp\\weaveforge-mcp.mjs"],
  env: { ELECTRON_RUN_AS_NODE: "1", KEEP: "x" },
  type: "stdio",
};
const REWRITTEN = {
  command: "/app/node",
  args: [LAUNCH.args[0]],
  env: { KEEP: "x", WEAVEFORGE_MCP_FILE: LAUNCH.env.WEAVEFORGE_MCP_FILE },
  type: "stdio",
};

test("mcpClientConfigs lists Cursor then the VS Code user config per OS", () => {
  const cursor = { file: path.join(HOME, ".cursor", "mcp.json"), key: "mcpServers" };

  assert.deepEqual(mcpClientConfigs(HOME, "win32", "C:\\AD"), [
    cursor,
    { file: path.join("C:\\AD", "Code", "User", "mcp.json"), key: "servers" },
  ]);
  assert.deepEqual(mcpClientConfigs(HOME, "win32", undefined), [
    cursor,
    { file: path.join(HOME, "AppData", "Roaming", "Code", "User", "mcp.json"), key: "servers" },
  ]);
  assert.deepEqual(mcpClientConfigs(HOME, "darwin", undefined), [
    cursor,
    {
      file: path.join(HOME, "Library", "Application Support", "Code", "User", "mcp.json"),
      key: "servers",
    },
  ]);
  assert.deepEqual(mcpClientConfigs(HOME, "linux", undefined), [
    cursor,
    { file: path.join(HOME, ".config", "Code", "User", "mcp.json"), key: "servers" },
  ]);
});

test("isElectronEntry matches only the Electron app's bridge entries", () => {
  assert.equal(isElectronEntry(OLD), true);
  assert.equal(
    isElectronEntry({
      command: "x",
      args: ["/home/u/.weaveforge/mcp/weaveforge-mcp.mjs"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    }),
    true,
  );

  assert.equal(isElectronEntry({ command: "x", args: [OLD.args[0]], env: { KEEP: "x" } }), false);
  assert.equal(
    isElectronEntry({ command: "x", args: [OLD.args[0]], env: { ELECTRON_RUN_AS_NODE: "0" } }),
    false,
  );
  assert.equal(isElectronEntry({ command: "x", args: [], env: { ELECTRON_RUN_AS_NODE: "1" } }), false);
  assert.equal(
    isElectronEntry({ command: "x", args: ["/x/index.mjs"], env: { ELECTRON_RUN_AS_NODE: "1" } }),
    false,
  );
  assert.equal(
    isElectronEntry({
      command: "x",
      args: ["/x/weaveforge-mcp.mjs.bak"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    }),
    false,
  );
  assert.equal(isElectronEntry(null), false);
  assert.equal(isElectronEntry([OLD]), false);
  assert.equal(isElectronEntry("weaveforge-mcp.mjs"), false);
});

test("rewriteMcpConfig moves our entry to the bundled node and leaves others alone", () => {
  const other = { command: "npx", args: ["x"] };
  const input = { mcpServers: { wf: OLD, other }, theme: "dark" };
  const before = structuredClone(input);

  const result = rewriteMcpConfig(input, "mcpServers", LAUNCH);

  assert.equal(result.changed, true);
  assert.deepEqual(result.config, {
    mcpServers: { wf: REWRITTEN, other },
    theme: "dark",
  });
  assert.deepEqual(input, before);
});

test("rewriteMcpConfig returns the same reference when nothing to rewrite", () => {
  const inputs: unknown[] = [null, [], {}, { mcpServers: [] }];
  for (const input of inputs) {
    const result = rewriteMcpConfig(input, "mcpServers", LAUNCH);
    assert.equal(result.changed, false);
    assert.equal(result.config, input);
  }
});

test("rewriteMcpConfig honours the servers key and ignores mcpServers", () => {
  const input = { servers: { wf: OLD }, mcpServers: { wf: OLD } };

  const result = rewriteMcpConfig(input, "servers", LAUNCH);

  assert.equal(result.changed, true);
  assert.deepEqual(result.config, {
    servers: { wf: REWRITTEN },
    mcpServers: { wf: OLD },
  });
});

test("rewriteMcpConfigFile rewrites a real file and removes its tmp file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { wf: OLD } }));

    const changed = await rewriteMcpConfigFile({ file, key: "mcpServers" }, LAUNCH);

    assert.equal(changed, true);
    const text = fs.readFileSync(file, "utf8");
    assert.deepEqual(JSON.parse(text), { mcpServers: { wf: REWRITTEN } });
    assert.equal(text.endsWith("\n"), true);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteMcpConfigFile leaves missing, invalid and unrelated files alone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const missing = path.join(dir, "missing.json");
    assert.equal(await rewriteMcpConfigFile({ file: missing, key: "mcpServers" }, LAUNCH), false);
    assert.equal(fs.existsSync(missing), false);

    const invalid = path.join(dir, "invalid.json");
    fs.writeFileSync(invalid, "{not json");
    assert.equal(await rewriteMcpConfigFile({ file: invalid, key: "mcpServers" }, LAUNCH), false);
    assert.equal(fs.readFileSync(invalid, "utf8"), "{not json");

    const unrelated = path.join(dir, "unrelated.json");
    const unrelatedText = JSON.stringify({ mcpServers: { other: { command: "npx", args: ["x"] } } });
    fs.writeFileSync(unrelated, unrelatedText);
    assert.equal(await rewriteMcpConfigFile({ file: unrelated, key: "mcpServers" }, LAUNCH), false);
    assert.equal(fs.readFileSync(unrelated, "utf8"), unrelatedText);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteMcpClientConfigs returns only the changed files, in order", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const a = path.join(dir, "a.json");
    const b = path.join(dir, "b.json");
    const c = path.join(dir, "c.json");
    fs.writeFileSync(a, JSON.stringify({ mcpServers: { wf: OLD } }));
    fs.writeFileSync(b, JSON.stringify({ mcpServers: { other: { command: "npx", args: ["x"] } } }));
    fs.writeFileSync(c, JSON.stringify({ servers: { wf: OLD } }));

    const changed = await rewriteMcpClientConfigs(
      [
        { file: a, key: "mcpServers" },
        { file: b, key: "mcpServers" },
        { file: c, key: "servers" },
      ],
      LAUNCH,
    );

    assert.deepEqual(changed, [a, c]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
