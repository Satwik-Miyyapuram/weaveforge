import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutboxEntry } from "../domain/outbox";
import { PostgrestTransport } from "../infra/postgrest-transport";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function harness(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body == null ? undefined : JSON.parse(String(init.body)),
    });
    const next = queue.shift() ?? { status: 200, body: [] };
    return {
      status: next.status,
      text: async () => (next.body === undefined ? "" : JSON.stringify(next.body)),
    };
  }) as unknown as typeof fetch;
  const transport = new PostgrestTransport({
    baseUrl: "https://api.test/rest/v1",
    apiKey: "anon",
    accessToken: async () => "jwt",
    fetchImpl,
  });
  return { transport, calls };
}

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    seq: 1,
    opId: "op-1",
    table: "projects",
    rowId: "11111111-1111-4111-8111-111111111111",
    op: "update",
    payload: { name: "Renamed" },
    baseVersion: 3,
    attempts: 0,
    lastError: null,
    ...overrides,
  } as OutboxEntry;
}

test("an update is guarded by the version it was based on", async () => {
  const { transport, calls } = harness([{ status: 200, body: [{ id: "x" }] }]);
  const outcome = await transport.send(entry());
  assert.deepEqual(outcome, { status: "accepted" });
  assert.equal(calls[0]!.method, "PATCH");
  assert.match(calls[0]!.url, /row_version=eq\.3/);
  assert.equal(calls[0]!.headers.authorization, "Bearer jwt");
});

test("a guarded write that matched no row is a conflict, with the server's version", async () => {
  const { transport, calls } = harness([
    { status: 200, body: [] },
    { status: 200, body: [{ row_version: 7 }] },
  ]);
  assert.deepEqual(await transport.send(entry()), { status: "conflict", serverVersion: 7 });
  assert.equal(calls[1]!.method, "GET");
});

test("an op with no base version is sent unguarded, not guarded on zero", async () => {
  // `row_version=eq.0` matches nothing — no live row is at version 0 — so the
  // write would come back as a conflict, the conflict row would record 0 as
  // "the server's version", and the re-queued attempt would guard on 0 again.
  // An op that can never drain, in a queue that never looks at it twice.
  const { transport, calls } = harness([{ status: 200, body: [{ id: "x" }] }]);
  const outcome = await transport.send(entry({ baseVersion: null }));

  assert.deepEqual(outcome, { status: "accepted" });
  assert.match(calls[0]!.url, /id=eq\./);
  assert.doesNotMatch(calls[0]!.url, /row_version/);
});

test("a conflict whose server version cannot be read reports unknown, not zero", async () => {
  // The value is persisted and re-queued as `baseVersion`, so a fabricated 0
  // here is the same phantom guard by another route.
  const { transport } = harness([
    { status: 200, body: [] },
    { status: 500, body: { message: "upstream" } },
  ]);
  assert.deepEqual(await transport.send(entry()), { status: "conflict", serverVersion: null });
});

test("a delete removes the row, guarded by its version", async () => {
  const { transport, calls } = harness([{ status: 200, body: [{ id: "x" }] }]);
  assert.deepEqual(await transport.send(entry({ op: "delete" })), { status: "accepted" });
  assert.equal(calls[0]!.method, "DELETE");
  assert.match(calls[0]!.url, /row_version=eq\.3/);
  assert.equal(calls[0]!.body, undefined);
});

test("a delete of a row the server no longer has is done, not a conflict", async () => {
  const { transport, calls } = harness([
    { status: 200, body: [] },
    { status: 200, body: [] },
  ]);
  assert.deepEqual(await transport.send(entry({ op: "delete" })), { status: "accepted" });
  assert.equal(calls[1]!.method, "GET");
});

test("a delete of a row someone edited since is a conflict", async () => {
  const { transport } = harness([
    { status: 200, body: [] },
    { status: 200, body: [{ id: "x" }] },
    { status: 200, body: [{ row_version: 5 }] },
  ]);
  assert.deepEqual(await transport.send(entry({ op: "delete" })), {
    status: "conflict",
    serverVersion: 5,
  });
});

test("a server error leaves the op owed rather than refused", async () => {
  const { transport } = harness([{ status: 503, body: { message: "upstream" } }]);
  assert.deepEqual(await transport.send(entry()), { status: "offline" });
});

test("an expired session is offline too, so the op survives the refresh", async () => {
  const { transport } = harness([{ status: 401, body: { message: "JWT expired" } }]);
  assert.deepEqual(await transport.send(entry()), { status: "offline" });
});

test("a request the server will never accept is refused, with its message", async () => {
  const { transport } = harness([{ status: 400, body: { message: "invalid input syntax" } }]);
  assert.deepEqual(await transport.send(entry()), {
    status: "refused",
    reason: "invalid input syntax",
  });
});

test("a thrown fetch is offline, not a refusal", async () => {
  const transport = new PostgrestTransport({
    baseUrl: "https://api.test/rest/v1",
    apiKey: "anon",
    accessToken: async () => null,
    fetchImpl: (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch,
  });
  assert.deepEqual(await transport.send(entry()), { status: "offline" });
});

test("the feed is read through the RPC and mapped to changes", async () => {
  const { transport, calls } = harness([
    {
      status: 200,
      body: [
        {
          table_name: "projects",
          row_id: "11111111-1111-4111-8111-111111111111",
          server_seq: 12,
          deleted_at: null,
          row_version: 2,
          row_data: { id: "11111111-1111-4111-8111-111111111111", name: "P" },
        },
      ],
    },
  ]);
  const changes = await transport.changesSince(4, 100);
  assert.equal(calls[0]!.url, "https://api.test/rest/v1/rpc/sync_changes");
  assert.deepEqual(calls[0]!.body, { p_since: 4, p_limit: 100 });
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.serverSeq, 12);
  assert.deepEqual(changes[0]!.row, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "P",
  });
});

test("a failing feed throws, so the watermark is never moved on a guess", async () => {
  const { transport } = harness([{ status: 500, body: { message: "boom" } }]);
  await assert.rejects(() => transport.changesSince(0, 10), /boom/);
});
