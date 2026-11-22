import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { REPORT_PATH } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";
import { PostgrestSource } from "../infrastructure/postgrest-source";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];
const L1 = { id: "l1", text: "from the database" };

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

/** A server whose secret count is given; `marks` records every server marker call. */
function server(secretCount: () => Promise<number>, marks: string[]): ServerSource {
  return {
    listRows: async () => [L1],
    countRows: async () => 1,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {
      marks.push("mark");
    },
    secretCount,
  } as unknown as ServerSource;
}

test("secrets: a source that cannot count its secrets is treated as holding some, so no mover refuses", async () => {
  const marks: string[] = [];
  const sink = new MemorySink();
  const source = server(async () => {
    throw new Error("count failed");
  }, marks);
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "keys: no mover"));
  assert.deepEqual(marks, [], "no server marker without a mover");
  assert.equal((await sink.list()).some((p) => p.startsWith("logEntries/")), false, "a refused run writes no data");
  assert.equal(JSON.parse(await sink.readText(REPORT_PATH)).state, "incomplete");
});

test("secrets: a count of zero runs without a mover and verifies", async () => {
  const marks: string[] = [];
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => 0, marks),
    sink: new MemorySink(),
    now: NOW,
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(marks, ["mark"]);
});

test("secrets: a count above zero with no mover refuses", async () => {
  const marks: string[] = [];
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => 3, marks),
    sink: new MemorySink(),
    now: NOW,
  });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "keys: no mover"));
  assert.deepEqual(marks, []);
});

test("secrets: a count above zero with a mover runs the mover once after verify", async () => {
  const marks: string[] = [];
  let moved = 0;
  const result = await runWebExport({ runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => 2, marks),
    sink: new MemorySink(),
    now: NOW,
    moveSecrets: async () => {
      moved++;
    },
  });
  assert.equal(result.state, "verified");
  assert.equal(moved, 1);
});

test("secrets: PostgrestSource counts integration rows with a token, through the owning project", async () => {
  const seen: { url: string; method: string }[] = [];
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: (async (url: string, init: { method: string }) => {
      seen.push({ url, method: init.method });
      return new Response(null, { status: 200, headers: { "content-range": "0-0/3" } });
    }) as unknown as typeof fetch,
  });
  assert.equal(await source.secretCount(), 3);
  assert.equal(seen[0]?.method, "HEAD");
  assert.match(seen[0]?.url ?? "", /\/project_integrations\?/);
  assert.match(seen[0]?.url ?? "", /token=not\.is\.null/);
  assert.match(seen[0]?.url ?? "", /projects\.user_id=eq\.u1/);
});

test("secrets: PostgrestSource throws when the count has no total, so the count reads as unknown", async () => {
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
  });
  await assert.rejects(() => source.secretCount(), /no total/);
});
