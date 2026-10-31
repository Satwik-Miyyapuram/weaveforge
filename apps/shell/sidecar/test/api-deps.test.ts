import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHANNELS } from "../../../desktop/src/channels";
import { registerMainLocalApi } from "../../../desktop/src/main-local-api";
import type { LocalDbHost } from "../../../desktop/src/local-db-host";
import { mcpPaths } from "../../../desktop/src/mcp-connect";
import {
  askOpen,
  askPreferences,
  askSecrets,
  RANK_EVENT,
  sidecarApiDeps,
  vaultRootHandler,
  wireIpc,
  wireWindow,
  type Handler,
} from "../src/api-deps";
import { newVaultSession } from "../../../desktop/src/vault-handlers";

function fakePeer(answer: (method: string, params?: unknown) => Promise<unknown>) {
  return {
    asks: [] as [string, unknown][],
    events: [] as [string, unknown][],
    answer,
    ask(method: string, params?: unknown) {
      this.asks.push([method, params]);
      return this.answer(method, params);
    },
    emit(event: string, params?: unknown) {
      this.events.push([event, params]);
    },
  };
}

test("wireIpc handle spreads the args and returns the listener result", async () => {
  const handlers: Record<string, Handler> = {};
  const ipc = wireIpc(handlers);
  ipc.handle("sum", async (_event, a, b) => ({ total: (a as number) + (b as number) }));
  assert.deepEqual(await handlers["ipc:sum"]!([2, 3]), { total: 5 });
});

test("wireIpc on calls the listener with the args and returns null", async () => {
  const handlers: Record<string, Handler> = {};
  const ipc = wireIpc(handlers);
  const seen: unknown[][] = [];
  ipc.on("ping", (_event, ...args) => {
    seen.push(args);
  });
  assert.equal(await handlers["ipc:ping"]!(["a", 2]), null);
  assert.deepEqual(seen, [["a", 2]]);
});

test("wireIpc refuses params that are not an argument list", async () => {
  const handlers: Record<string, Handler> = {};
  wireIpc(handlers).handle("x", async () => null);
  await assert.rejects(handlers["ipc:x"]!("nope"), /needs an argument list/);
  await assert.rejects(handlers["ipc:x"]!({ 0: 1 }), /needs an argument list/);
});

test("wireIpc listeners that read the event fail loudly", async () => {
  const handlers: Record<string, Handler> = {};
  wireIpc(handlers).handle("who", async (event) => event.sender);
  await assert.rejects(handlers["ipc:who"]!([]), { message: "the shell's IPC event has no fields" });
});

test("wireIpc listeners can await or log the event without it throwing", async () => {
  const handlers: Record<string, Handler> = {};
  wireIpc(handlers).handle("ok", async (event) => {
    await Promise.resolve(event);
    return JSON.stringify(event);
  });
  assert.equal(await handlers["ipc:ok"]!([]), "{}");
});

test("wireIpc refuses a channel registered twice", () => {
  const ipc = wireIpc({});
  ipc.handle("dup", async () => null);
  assert.throws(() => ipc.on("dup", () => undefined), /ipc:dup registered twice/);
});

test("askPreferences reads what the shell answers", async () => {
  for (const reply of [true, "x", null]) {
    const peer = fakePeer(async () => reply);
    assert.deepEqual(await askPreferences(peer).read("local-api"), { ok: true, value: reply });
    assert.deepEqual(peer.asks, [["pref.read", { name: "local-api" }]]);
  }
});

test("askPreferences read refuses a reply that is not a preference value", async () => {
  const peer = fakePeer(async () => ({}));
  assert.deepEqual(await askPreferences(peer).read("local-api"), { ok: false, message: "pref.read: bad reply" });
});

test("askPreferences read reports the shell's rejection", async () => {
  const peer = fakePeer(async () => {
    throw new Error("store down");
  });
  assert.deepEqual(await askPreferences(peer).read("local-api"), { ok: false, message: "store down" });
});

test("askPreferences write asks the shell and reports success", async () => {
  const peer = fakePeer(async () => null);
  assert.deepEqual(await askPreferences(peer).write("local-api", true), { ok: true, value: null });
  assert.deepEqual(peer.asks, [["pref.write", { name: "local-api", value: true }]]);
});

test("askPreferences write reports the shell's rejection", async () => {
  const peer = fakePeer(async () => {
    throw new Error("disk full");
  });
  assert.deepEqual(await askPreferences(peer).write("local-api", true), { ok: false, message: "disk full" });
});

test("askSecrets reads, writes and clears through the shell", async () => {
  const peer = fakePeer(async (method) => (method === "secret.read" ? "key" : null));
  const secrets = askSecrets(peer);
  assert.deepEqual(await secrets.read("ai-provider"), { ok: true, value: "key" });
  assert.deepEqual(await secrets.write("ai-provider", "key"), { ok: true, value: null });
  assert.deepEqual(await secrets.clear("ai-provider"), { ok: true, value: null });
  assert.deepEqual(peer.asks, [
    ["secret.read", { name: "ai-provider" }],
    ["secret.write", { name: "ai-provider", value: "key" }],
    ["secret.clear", { name: "ai-provider" }],
  ]);
});

test("askSecrets read refuses a reply that is not a secret", async () => {
  const peer = fakePeer(async () => 42);
  assert.deepEqual(await askSecrets(peer).read("ai-provider"), { ok: false, message: "secret.read: bad reply" });
});

test("askSecrets reports the shell's rejection on clear", async () => {
  const peer = fakePeer(async () => {
    throw new Error("locked");
  });
  assert.deepEqual(await askSecrets(peer).clear("ai-provider"), { ok: false, message: "locked" });
});

test("askOpen url forwards the ask and lets a rejection through", async () => {
  const ok = fakePeer(async () => null);
  await askOpen(ok).url("https://example.org");
  assert.deepEqual(ok.asks, [["open.url", { url: "https://example.org" }]]);

  const refused = fakePeer(async () => {
    throw new Error("no browser");
  });
  await assert.rejects(askOpen(refused).url("https://example.org"), { message: "no browser" });
});

test("askOpen path returns empty on success and the message on rejection", async () => {
  assert.equal(await askOpen(fakePeer(async () => null)).path("/a/b.pdf"), "");
  const refused = fakePeer(async () => {
    throw new Error("path not allowed");
  });
  assert.equal(await askOpen(refused).path("/a/b.pdf"), "path not allowed");
  assert.deepEqual(refused.asks, [["open.path", { path: "/a/b.pdf" }]]);
});

test("wireWindow emits semantic rank requests as events", () => {
  const peer = fakePeer(async () => null);
  const win = wireWindow(peer);
  assert.equal(win.isDestroyed(), false);
  win.webContents.send(CHANNELS.semanticRank, "id1", "q", ["a"]);
  // The shell's allowlist name, not the Electron channel.
  assert.deepEqual(peer.events, [[RANK_EVENT, ["id1", "q", ["a"]]]]);
  assert.equal(RANK_EVENT, "semanticRank");
});

test("wireWindow ignores other channels", () => {
  const peer = fakePeer(async () => null);
  wireWindow(peer).webContents.send(CHANNELS.semanticRanked, "x");
  assert.deepEqual(peer.events, []);
});

test("vaultRootHandler adopts a path and clears on null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-api-deps-"));
  try {
    const session = newVaultSession();
    const handler = vaultRootHandler(session);
    assert.equal(await handler({ path: dir, state: "empty" }), null);
    assert.deepEqual(session.root, { path: dir, state: "empty" });
    assert.notEqual(session.fs, null);

    assert.equal(await handler({ path: null }), null);
    assert.equal(session.root, null);
    assert.equal(session.fs, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("vaultRootHandler refuses params without a path", async () => {
  const handler = vaultRootHandler(newVaultSession());
  for (const bad of [{}, "x"]) {
    await assert.rejects(handler(bad), /vault\.root needs/);
  }
});

test("vaultRootHandler refuses a relative path and keeps the session root", async () => {
  const session = newVaultSession();
  const handler = vaultRootHandler(session);
  await assert.rejects(handler({ path: "relative/dir", state: "empty" }), {
    message: "vault.root needs { path, state } with an absolute path",
  });
  assert.equal(session.root, null);
  assert.equal(session.fs, null);
});

test("vaultRootHandler accepts an absolute path in the existing state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-api-deps-"));
  try {
    const session = newVaultSession();
    assert.equal(await vaultRootHandler(session)({ path: dir, state: "existing" }), null);
    assert.deepEqual(session.root, { path: dir, state: "existing" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sidecarApiDeps builds deps registerMainLocalApi accepts", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-api-deps-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const peer = fakePeer(async (method) => {
    if (method === "pref.read") return false;
    if (method === "secret.read") return null;
    return null;
  });
  const { deps, handlers } = sidecarApiDeps({
    peer,
    localDb: {} as unknown as LocalDbHost,
    artifactRoot: tmp,
    mcpPaths: mcpPaths(tmp, undefined, path.join(tmp, "bridge.mjs")),
    execPath: "/usr/bin/node",
    version: "1.2.3",
  });
  assert.equal(deps.electron, false);
  assert.equal(deps.execPath, "/usr/bin/node");
  assert.equal(typeof handlers["vault.root"], "function");

  const api = registerMainLocalApi(deps);
  t.after(() => api.close());
  const state = await handlers["ipc:" + CHANNELS.localApiState]!([]);
  const snap = state as { ok: boolean; value: { enabled: boolean; mcp: { launch: { command: string; env: object } } } };
  assert.equal(snap.ok, true);
  assert.equal(snap.value.enabled, false);
  assert.equal(snap.value.mcp.launch.command, "/usr/bin/node");
  assert.deepEqual(snap.value.mcp.launch.env, {});
  assert.deepEqual(peer.asks[0], ["pref.read", { name: "local-api" }]);
});
