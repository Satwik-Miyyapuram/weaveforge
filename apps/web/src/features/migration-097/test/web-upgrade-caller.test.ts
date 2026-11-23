import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebUpgrade } from "../application/run-web-upgrade";
import type { FileCodec, Row } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

class TrackingSink extends MemorySink {
  readonly removed: string[] = [];
  override async remove(path: string): Promise<void> {
    this.removed.push(path);
    return super.remove(path);
  }
}

/** PostgREST stand-in: HEAD counts per secret table, empty listings, and a record of every request. */
function fakePostgrest(secretTotals: Record<string, number>, calls: { method: string; url: string }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const table = new URL(url).pathname.split("/").pop() ?? "";
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-range": `0-0/${secretTotals[table] ?? 0}` } });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "POST" || method === "PATCH") return new Response("{}", { status: 200 });
    return new Response("[]", { status: 200, headers: { "content-range": "*/0" } });
  }) as unknown as typeof fetch;
}

test("web upgrade: the PostgREST source names the reconnect providers, and the run deletes nothing", async () => {
  const calls: { method: string; url: string }[] = [];
  const sink = new TrackingSink();
  const result = await runWebUpgrade({
    server: {
      baseUrl: "https://api.example.test",
      userId: "u1",
      headers: {},
      fetch: fakePostgrest({ user_settings: 1 }, calls),
      pendingOutbox: async () => 0,
    },
    kinds: KINDS,
    codec,
    sink,
    now: NOW,
    runDeviceId: "web-me-0001",
  });

  assert.deepEqual(result.reconnectProviders, ["zotero"], "only the provider name reaches the result");
  assert.equal(result.state, "verified");
  assert.equal(calls.some((c) => c.method === "DELETE"), false, "no server row is deleted");
  assert.equal(sink.removed.some((p) => p.startsWith("logEntries/")), false, "no exported file is removed");
});
