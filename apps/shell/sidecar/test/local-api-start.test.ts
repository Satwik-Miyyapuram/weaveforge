import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LocalDbHost } from "../../../desktop/src/local-db-host";
import { startLocalApi, type LocalApiStartOptions } from "../src/local-api-start";
import type { Handlers } from "../src/wire";

// The Electron entry the app wrote for the prod MCP file.
const OLD = {
  command: "C:\\Program Files\\WeaveForge\\WeaveForge.exe",
  args: ["C:\\Users\\u\\.weaveforge\\mcp\\weaveforge-mcp.mjs"],
  env: { ELECTRON_RUN_AS_NODE: "1", KEEP: "x" },
  type: "stdio",
};

function fakePeer(answer: (method: string, params?: unknown) => Promise<unknown>) {
  return {
    asks: [] as [string, unknown][],
    ask(method: string, params?: unknown) {
      this.asks.push([method, params]);
      return answer(method, params);
    },
    emit() {},
  };
}

const quiet = async (method: string) => (method === "pref.read" ? false : null);

function tmpHome(t: { after(fn: () => void): void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-local-api-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function options(
  home: string,
  peer: ReturnType<typeof fakePeer>,
  logs: string[],
  extra: Partial<LocalApiStartOptions> = {},
): LocalApiStartOptions {
  return {
    peer,
    localDb: {} as LocalDbHost,
    artifactRoot: path.join(home, "artifacts"),
    bridge: path.join(home, "bridge.mjs"),
    version: "0.0.0",
    home,
    platform: "linux",
    appData: undefined,
    execPath: "/app/node",
    log: (line) => logs.push(line),
    ...extra,
  };
}

function writeCursor(home: string, text: string): string {
  fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
  const file = path.join(home, ".cursor", "mcp.json");
  fs.writeFileSync(file, text);
  return file;
}

test("merged handlers contain every base handler and the local API's", async (t) => {
  const home = tmpHome(t);
  const base: Handlers = { query: async () => 1 };
  const start = startLocalApi(base, options(home, fakePeer(quiet), []));
  assert.equal(start.handlers.query, base.query);
  assert.equal(typeof start.handlers["ipc:weaveforge:local-api-state"], "function");
  assert.equal(typeof start.handlers["vault.root"], "function");
  await start.ready;
  await start.close();
});

test("a base handler with a local API name throws synchronously", (t) => {
  const home = tmpHome(t);
  const base: Handlers = { "vault.root": async () => null };
  assert.throws(() => startLocalApi(base, options(home, fakePeer(quiet), [])), /handler vault\.root registered twice/);
});

test("ready resolves after asking for the local-api preference", async (t) => {
  const home = tmpHome(t);
  const peer = fakePeer(quiet);
  const start = startLocalApi({}, options(home, peer, []));
  assert.ok(start.ready instanceof Promise);
  await start.ready;
  assert.deepEqual(peer.asks[0], ["pref.read", { name: "local-api" }]);
  await start.close();
});

// The preference store reads a failed ask as "off", so the door stays shut without a log line.
test("ready still resolves when the preference read throws, and reads nothing past it", async (t) => {
  const home = tmpHome(t);
  const logs: string[] = [];
  const peer = fakePeer(async () => {
    throw new Error("store down");
  });
  const start = startLocalApi({}, options(home, peer, logs));
  await assert.doesNotReject(start.ready);
  assert.deepEqual(
    peer.asks.map(([method]) => method),
    ["pref.read"],
  );
  assert.equal(logs.some((l) => l.startsWith("[local-api]")), false, logs.join("\n"));
  await start.close();
});

test("without a bridge: no asks, no rewrite, one [local-api] line", async (t) => {
  const home = tmpHome(t);
  const logs: string[] = [];
  const text = JSON.stringify({ mcpServers: { wf: OLD } });
  const file = writeCursor(home, text);
  const peer = fakePeer(quiet);
  const o = options(home, peer, logs);
  delete o.bridge;
  const start = startLocalApi({}, o);
  await start.ready;
  await start.close();

  assert.deepEqual(peer.asks, []);
  assert.equal(fs.readFileSync(file, "utf8"), text);
  assert.deepEqual(logs, ["[local-api] not started: no --bridge"]);
});

test("close before resume settles: ready skips the rewrite", async (t) => {
  const home = tmpHome(t);
  const logs: string[] = [];
  const text = JSON.stringify({ mcpServers: { wf: OLD } });
  const file = writeCursor(home, text);
  let answerPref: (value: unknown) => void = () => undefined;
  const pending = new Promise<unknown>((resolve) => {
    answerPref = resolve;
  });
  const peer = fakePeer((method) => (method === "pref.read" ? pending : quiet(method)));
  const start = startLocalApi({}, options(home, peer, logs));
  await start.close();
  answerPref(false);
  await start.ready;

  assert.equal(fs.readFileSync(file, "utf8"), text);
  assert.equal(logs.some((l) => l.startsWith("[mcp]")), false, logs.join("\n"));
});

test("prod rewrites the Electron entry in the Cursor config and keeps a backup", async (t) => {
  const home = tmpHome(t);
  const logs: string[] = [];
  const file = writeCursor(home, JSON.stringify({ mcpServers: { wf: OLD } }));
  const start = startLocalApi({}, options(home, fakePeer(quiet), logs));
  await start.ready;
  await start.close();

  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    mcpServers: {
      wf: {
        command: "/app/node",
        args: [path.join(home, ".weaveforge", "mcp", "weaveforge-mcp.mjs")],
        env: { KEEP: "x" },
        type: "stdio",
      },
    },
  });
  assert.equal(fs.readFileSync(`${file}.weaveforge.bak`, "utf8"), JSON.stringify({ mcpServers: { wf: OLD } }));
  assert.ok(logs.some((l) => l.startsWith("[mcp] moved editor entries:")), logs.join("\n"));
});

test("dev leaves the editor configs byte-identical and logs no [mcp] line", async (t) => {
  const home = tmpHome(t);
  const logs: string[] = [];
  const text = JSON.stringify({ mcpServers: { wf: OLD } });
  const file = writeCursor(home, text);
  const start = startLocalApi({}, options(home, fakePeer(quiet), logs, { homeVariant: "dev" }));
  await start.ready;
  await start.close();

  assert.equal(fs.readFileSync(file, "utf8"), text);
  assert.equal(fs.existsSync(`${file}.weaveforge.bak`), false);
  assert.equal(logs.some((l) => l.startsWith("[mcp]")), false);
});

test("prod leaves a JSONC Cursor config byte-identical and reports it as skipped", async (t) => {
  const home = tmpHome(t);
  const logs: string[] = [];
  const text = `// user config\n{ "mcpServers": { "wf": ${JSON.stringify(OLD)} } }\n`;
  const file = writeCursor(home, text);
  const start = startLocalApi({}, options(home, fakePeer(quiet), logs));
  await start.ready;
  await start.close();

  assert.equal(fs.readFileSync(file, "utf8"), text);
  assert.ok(logs.some((l) => l.startsWith("[mcp] could not update (left as is):")), logs.join("\n"));
});

test("close resolves twice in a row without throwing", async (t) => {
  const home = tmpHome(t);
  const start = startLocalApi({}, options(home, fakePeer(quiet), []));
  await start.ready;
  await start.close();
  await assert.doesNotReject(start.close());
});
