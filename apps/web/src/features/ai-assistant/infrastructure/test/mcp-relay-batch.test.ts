import assert from "node:assert/strict";
import test from "node:test";
import nodeCrypto from "node:crypto";
import type { AiAccessSettings } from "@weaveforge/core";
import { handleRelayBatch } from "../mcp-browser-relay";
import type { McpToolHost, RelayBatchDeps } from "../mcp-browser-relay";

const settings = {
  enabled: true, disclosureAcceptedAt: "2026-01-01T00:00:00.000Z",
  readCategories: ["paper_metadata"], proposalKinds: [],
} as AiAccessSettings;

/**
 * The wire format, derived here rather than imported.
 *
 * The local MCP server seals envelopes with these exact parameters and has no
 * other way to agree on them; deriving the key independently is what makes this
 * a test of the format and not a test of one shared helper calling itself.
 */
const SALT = "weaveforge-mcp-v1";
async function sessionKeyFor(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode(SALT), iterations: 100_000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const unb64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

async function seal(key: CryptoKey, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: b64(iv), ciphertext: b64(new Uint8Array(data)) };
}
async function open(key: CryptoKey, envelope: { iv: string; ciphertext: string }) {
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(data)) as unknown;
}

const host = {
  async searchWorkspace(input: { query: string }) { return [{ source: { sourceId: "s-1" }, text: `found ${input.query}` }]; },
  async getSourceExcerpt() { return null; },
  async getWorkspaceOutline() { return []; },
  async proposeDraft() { throw new Error("not used here"); },
  async proposeZoteroImport() { throw new Error("not used here"); },
} as unknown as McpToolHost;

interface Harness {
  deps: RelayBatchDeps;
  patches: Record<string, unknown>[];
  slept: number[];
  key: CryptoKey;
}

async function harness(options: { patchOk?: (body: Record<string, unknown>, call: number) => boolean | "throw"; live?: () => boolean } = {}): Promise<Harness> {
  const key = await sessionKeyFor("pairing-secret");
  const patches: Record<string, unknown>[] = [];
  const slept: number[] = [];
  return {
    key, patches, slept,
    deps: {
      sessionId: "session-1",
      getSettings: () => settings,
      sessionKey: Promise.resolve(key),
      host: () => host,
      live: options.live ?? (() => true),
      async patch(body) {
        patches.push(body);
        const verdict = options.patchOk?.(body, patches.length) ?? true;
        if (verdict === "throw") throw new Error("network down");
        return verdict;
      },
      async sleep(ms) { slept.push(ms); },
    },
  };
}

const row = (id: string, request_enc: { iv: string; ciphertext: string }) =>
  ({ id, request_enc, expires_at: "2026-01-01T00:05:00.000Z" });

test("a sealed call is opened, run, and answered with a sealed result", async () => {
  const h = await harness();
  const request = await seal(h.key, { tool: "search_workspace", arguments: { query: "attention" } });
  await handleRelayBatch(h.deps, [row("r-1", request)]);

  assert.equal(h.patches.length, 1);
  assert.equal(h.patches[0]!.id, "r-1");
  const envelope = h.patches[0]!.envelope as { iv: string; ciphertext: string };
  assert.ok(envelope?.ciphertext, "the relay must only ever see an envelope");
  assert.deepEqual(await open(h.key, envelope), [{ source: { sourceId: "s-1" }, text: "found attention" }]);
});

test("the relay never sees plaintext, even for a call it cannot open", async () => {
  const h = await harness();
  const wrongKey = await sessionKeyFor("a-different-secret");
  const request = await seal(wrongKey, { tool: "search_workspace", arguments: { query: "attention" } });
  await handleRelayBatch(h.deps, [row("r-1", request)]);

  // Undecryptable, so it is cancelled rather than left for another tab to retry.
  assert.deepEqual(h.patches, [{ id: "r-1", status: "cancelled" }]);
});

test("a refused tool call is answered with the refusal, not cancelled", async () => {
  // Cancelling told the caller only that the call went nowhere. The reason is
  // the user's own policy, not a secret, and without it the model cannot tell
  // "not allowed" from "the browser went away" and retries the same call.
  const h = await harness();
  const request = await seal(h.key, { tool: "rm_minus_rf", arguments: {} });
  await handleRelayBatch(h.deps, [row("r-1", request)]);

  assert.equal(h.patches.length, 1);
  assert.equal(h.patches[0]!.status, undefined, "a refusal is delivered, not cancelled");
  assert.deepEqual(await open(h.key, h.patches[0]!.envelope as { iv: string; ciphertext: string }), {
    weaveforgeError: "This MCP tool is not enabled for this deployment.",
  });
});

test("delivery is retried with backoff, and a dispatched call is never cancelled", async () => {
  const h = await harness({ patchOk: (_body, call) => (call === 1 ? false : call === 2 ? "throw" : true) });
  const request = await seal(h.key, { tool: "search_workspace", arguments: { query: "attention" } });
  await handleRelayBatch(h.deps, [row("r-1", request)]);

  assert.equal(h.patches.length, 3, "three attempts, then it lands");
  assert.deepEqual(h.slept, [250, 500], "backoff grows and is not slept after the last attempt");
  assert.ok(h.patches.every((body) => body.status !== "cancelled"), "a call whose side effects ran must never be cancelled");
});

test("delivery that never lands leaves the row claimed rather than cancelling it", async () => {
  const h = await harness({ patchOk: () => false });
  const request = await seal(h.key, { tool: "search_workspace", arguments: { query: "attention" } });
  await handleRelayBatch(h.deps, [row("r-1", request)]);

  assert.equal(h.patches.length, 3, "it gives up after three attempts");
  assert.ok(h.patches.every((body) => body.status !== "cancelled"));
});

test("when the grant goes away mid-batch, the rest of the batch is cancelled", async () => {
  let calls = 0;
  const h = await harness({ live: () => ++calls <= 1 });
  const request = await seal(h.key, { tool: "search_workspace", arguments: { query: "attention" } });
  await handleRelayBatch(h.deps, [row("r-1", request), row("r-2", request), row("r-3", request)]);

  assert.equal(h.patches[0]!.id, "r-1", "the first was already dispatched and is answered");
  assert.ok(h.patches[0]!.envelope);
  assert.deepEqual(h.patches.slice(1), [
    { id: "r-2", status: "cancelled" },
    { id: "r-3", status: "cancelled" },
  ], "claimed rows are never requeued, so the remainder must be released");
});

test("a batch is refused outright when the session is already gone", async () => {
  const h = await harness({ live: () => false });
  const request = await seal(h.key, { tool: "search_workspace", arguments: { query: "attention" } });
  await handleRelayBatch(h.deps, [row("r-1", request), row("r-2", request)]);
  assert.deepEqual(h.patches, [{ id: "r-1", status: "cancelled" }, { id: "r-2", status: "cancelled" }]);
});

test("one bad row does not stop the rest of the batch", async () => {
  const h = await harness();
  const good = await seal(h.key, { tool: "search_workspace", arguments: { query: "attention" } });
  const bad = await seal(h.key, { tool: "not_a_tool", arguments: {} });
  await handleRelayBatch(h.deps, [row("r-1", bad), row("r-2", good)]);

  assert.equal(h.patches[0]!.id, "r-1");
  assert.ok(h.patches[0]!.envelope, "the bad row gets its refusal");
  assert.equal(h.patches[1]!.id, "r-2");
  assert.ok(h.patches[1]!.envelope, "the healthy row still gets its answer");
});

test("an envelope sealed exactly as the local MCP server seals it opens here, and its answer opens there", async () => {
  // Mirrors plugins/weaveforge-research/mcp-server/index.mjs: node crypto on one
  // side, WebCrypto on the other. The two have to agree about the salt, the
  // iteration count, the 12-byte IV and where GCM keeps its tag — nothing in
  // either file makes that agreement fail loudly, so it is asserted here.
  const nodeKey = nodeCrypto.pbkdf2Sync("pairing-secret", SALT, 100_000, 32, "sha256");
  const nodeSeal = (value: unknown) => {
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", nodeKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { iv: iv.toString("base64"), ciphertext: Buffer.concat([data, cipher.getAuthTag()]).toString("base64") };
  };
  const nodeOpen = (envelope: { iv: string; ciphertext: string }) => {
    const raw = Buffer.from(envelope.ciphertext, "base64");
    const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", nodeKey, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(raw.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(0, -16)), decipher.final()]).toString("utf8")) as unknown;
  };

  const h = await harness();
  await handleRelayBatch(h.deps, [row("r-1", nodeSeal({ tool: "search_workspace", arguments: { query: "attention" } }))]);
  assert.deepEqual(nodeOpen(h.patches[0]!.envelope as { iv: string; ciphertext: string }), [
    { source: { sourceId: "s-1" }, text: "found attention" },
  ]);
});

test("a cancel that itself fails does not take the batch down with it", async () => {
  const h = await harness({ patchOk: (body) => (body.status === "cancelled" ? "throw" : true) });
  const bad = await seal(await sessionKeyFor("a-different-secret"), { tool: "not_a_tool", arguments: {} });
  const good = await seal(h.key, { tool: "search_workspace", arguments: { query: "attention" } });
  await assert.doesNotReject(() => handleRelayBatch(h.deps, [row("r-1", bad), row("r-2", good)]));
  assert.ok(h.patches[1]!.envelope);
});
