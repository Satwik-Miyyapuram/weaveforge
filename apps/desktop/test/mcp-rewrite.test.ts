import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isElectronEntry,
  mcpClientConfigs,
  mcpFileOf,
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
const PROD_LAUNCH = {
  command: "/app/node",
  args: ["/home/u/.weaveforge/mcp/weaveforge-mcp.mjs"],
  env: {},
};
const OLD = {
  command: "C:\\Program Files\\WeaveForge\\WeaveForge.exe",
  args: ["C:\\Users\\u\\.weaveforge\\mcp\\weaveforge-mcp.mjs"],
  env: { ELECTRON_RUN_AS_NODE: "1", KEEP: "x" },
  type: "stdio",
};
// An Electron entry from the dev build: its MCP file is mcp-dev.json.
const DEV_OLD = {
  ...OLD,
  env: { ELECTRON_RUN_AS_NODE: "1", KEEP: "x", WEAVEFORGE_MCP_FILE: LAUNCH.env.WEAVEFORGE_MCP_FILE },
};
const REWRITTEN = {
  command: "/app/node",
  args: [LAUNCH.args[0]],
  env: { KEEP: "x", WEAVEFORGE_MCP_FILE: LAUNCH.env.WEAVEFORGE_MCP_FILE },
  type: "stdio",
};
const PROD_REWRITTEN = {
  command: "/app/node",
  args: [PROD_LAUNCH.args[0]],
  env: { KEEP: "x" },
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

test("mcpFileOf returns the MCP file basename, or mcp.json when none is set", () => {
  assert.equal(mcpFileOf(undefined), "mcp.json");
  assert.equal(mcpFileOf(null), "mcp.json");
  assert.equal(mcpFileOf("mcp-dev.json"), "mcp.json");
  assert.equal(mcpFileOf({}), "mcp.json");
  assert.equal(mcpFileOf({ WEAVEFORGE_MCP_FILE: "" }), "mcp.json");
  assert.equal(mcpFileOf({ WEAVEFORGE_MCP_FILE: 5 }), "mcp.json");
  assert.equal(mcpFileOf({ WEAVEFORGE_MCP_FILE: path.join("/a", "mcp-dev.json") }), "mcp-dev.json");
});

test("rewriteMcpConfig moves our entry to the bundled node and leaves others alone", () => {
  const other = { command: "npx", args: ["x"] };
  const input = { mcpServers: { wf: DEV_OLD, other }, theme: "dark" };
  const before = structuredClone(input);

  const result = rewriteMcpConfig(input, "mcpServers", LAUNCH);

  assert.equal(result.changed, true);
  assert.deepEqual(result.config, {
    mcpServers: { wf: REWRITTEN, other },
    theme: "dark",
  });
  assert.deepEqual(input, before);
});

test("rewriteMcpConfig rewrites a prod entry on a prod launch and leaves a dev entry", () => {
  const input = { mcpServers: { prod: OLD, dev: DEV_OLD } };

  const result = rewriteMcpConfig(input, "mcpServers", PROD_LAUNCH);

  assert.equal(result.changed, true);
  assert.deepEqual(result.config, {
    mcpServers: { prod: PROD_REWRITTEN, dev: DEV_OLD },
  });
});

test("rewriteMcpConfig rewrites a dev entry on a dev launch and leaves a prod entry", () => {
  const input = { mcpServers: { prod: OLD, dev: DEV_OLD } };

  const result = rewriteMcpConfig(input, "mcpServers", LAUNCH);

  assert.equal(result.changed, true);
  assert.deepEqual(result.config, {
    mcpServers: { prod: OLD, dev: REWRITTEN },
  });
});

test("rewriteMcpConfig leaves a prod entry unchanged on a dev launch", () => {
  const input = { mcpServers: { wf: OLD } };

  const result = rewriteMcpConfig(input, "mcpServers", LAUNCH);

  assert.equal(result.changed, false);
  assert.equal(result.config, input);
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
  const input = { servers: { wf: DEV_OLD }, mcpServers: { wf: DEV_OLD } };

  const result = rewriteMcpConfig(input, "servers", LAUNCH);

  assert.equal(result.changed, true);
  assert.deepEqual(result.config, {
    servers: { wf: REWRITTEN },
    mcpServers: { wf: DEV_OLD },
  });
});

test("rewriteMcpConfigFile rewrites a real file and leaves no tmp file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { wf: DEV_OLD } }));

    const outcome = await rewriteMcpConfigFile({ file, key: "mcpServers" }, LAUNCH);

    assert.equal(outcome, "changed");
    const text = fs.readFileSync(file, "utf8");
    assert.deepEqual(JSON.parse(text), { mcpServers: { wf: REWRITTEN } });
    assert.equal(text.endsWith("\n"), true);
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteMcpConfigFile keeps the original text in a .weaveforge.bak and never overwrites it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const file = path.join(dir, "mcp.json");
    const bak = `${file}.weaveforge.bak`;
    const first = JSON.stringify({ mcpServers: { wf: DEV_OLD } });
    fs.writeFileSync(file, first);

    assert.equal(await rewriteMcpConfigFile({ file, key: "mcpServers" }, LAUNCH), "changed");
    assert.equal(fs.readFileSync(bak, "utf8"), first);

    const second = JSON.stringify({ mcpServers: { wf: DEV_OLD, extra: DEV_OLD } });
    fs.writeFileSync(file, second);

    assert.equal(await rewriteMcpConfigFile({ file, key: "mcpServers" }, LAUNCH), "changed");
    assert.equal(fs.readFileSync(bak, "utf8"), first);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteMcpConfigFile leaves missing, invalid and unrelated files alone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const missing = path.join(dir, "missing.json");
    assert.equal(await rewriteMcpConfigFile({ file: missing, key: "mcpServers" }, LAUNCH), "unchanged");
    assert.equal(fs.existsSync(missing), false);

    const invalid = path.join(dir, "invalid.json");
    fs.writeFileSync(invalid, "{not json");
    assert.equal(await rewriteMcpConfigFile({ file: invalid, key: "mcpServers" }, LAUNCH), "skipped");
    assert.equal(fs.readFileSync(invalid, "utf8"), "{not json");

    const unrelated = path.join(dir, "unrelated.json");
    const unrelatedText = JSON.stringify({ mcpServers: { other: { command: "npx", args: ["x"] } } });
    fs.writeFileSync(unrelated, unrelatedText);
    assert.equal(await rewriteMcpConfigFile({ file: unrelated, key: "mcpServers" }, LAUNCH), "unchanged");
    assert.equal(fs.readFileSync(unrelated, "utf8"), unrelatedText);
    assert.equal(fs.existsSync(`${unrelated}.weaveforge.bak`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteMcpClientConfigs reports JSONC files as skipped and leaves them byte-identical", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const jsonc = path.join(dir, "mcp.json");
    const text = `// user config\n{ "servers": { "wf": ${JSON.stringify(DEV_OLD)} } }\n`;
    fs.writeFileSync(jsonc, text);

    const result = await rewriteMcpClientConfigs([{ file: jsonc, key: "servers" }], LAUNCH);

    assert.deepEqual(result, { changed: [], skipped: [jsonc] });
    assert.equal(fs.readFileSync(jsonc, "utf8"), text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteMcpClientConfigs skips a missing file and reports it in neither list", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const missing = path.join(dir, "missing.json");

    const result = await rewriteMcpClientConfigs([{ file: missing, key: "mcpServers" }], LAUNCH);

    assert.deepEqual(result, { changed: [], skipped: [] });
    assert.equal(fs.existsSync(missing), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteMcpClientConfigs returns the changed files, in order", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mcp-rw-"));
  try {
    const a = path.join(dir, "a.json");
    const b = path.join(dir, "b.json");
    const c = path.join(dir, "c.json");
    fs.writeFileSync(a, JSON.stringify({ mcpServers: { wf: DEV_OLD } }));
    fs.writeFileSync(b, JSON.stringify({ mcpServers: { other: { command: "npx", args: ["x"] } } }));
    fs.writeFileSync(c, JSON.stringify({ servers: { wf: DEV_OLD } }));

    const result = await rewriteMcpClientConfigs(
      [
        { file: a, key: "mcpServers" },
        { file: b, key: "mcpServers" },
        { file: c, key: "servers" },
      ],
      LAUNCH,
    );

    assert.deepEqual(result, { changed: [a, c], skipped: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
