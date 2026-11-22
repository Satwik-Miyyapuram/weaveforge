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
  const seen: string[] = [];
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: countingFetch({ project_integrations: 3, user_settings: 0, overleaf_connections: 0 }, seen),
  });
  assert.equal(await source.secretCount(), 3);
  assert.match(seen[0] ?? "", /\/project_integrations\?/);
  assert.match(seen[0] ?? "", /token=not\.is\.null/);
  assert.match(seen[0] ?? "", /projects\.user_id=eq\.u1/);
});

/** A fake PostgREST: each table's HEAD count comes from `totals`; `fail` names a table that answers 500. */
function countingFetch(totals: Record<string, number>, seen: string[], fail?: string): typeof fetch {
  return (async (url: string) => {
    seen.push(url);
    const table = new URL(url).pathname.split("/").pop() ?? "";
    if (table === fail) return new Response(null, { status: 500 });
    const total = totals[table];
    return new Response(null, {
      status: 200,
      headers: total === undefined ? {} : { "content-range": `0-0/${total}` },
    });
  }) as unknown as typeof fetch;
}

test("secrets: PostgrestSource sums the token rows of all three secret tables", async () => {
  const seen: string[] = [];
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: countingFetch({ project_integrations: 3, user_settings: 1, overleaf_connections: 2 }, seen),
  });
  assert.equal(await source.secretCount(), 6);
  assert.equal(seen.length, 3);
  assert.ok(seen.some((u) => /\/user_settings\?/.test(u) && /zotero_api_key=not\.is\.null/.test(u) && /user_id=eq\.u1/.test(u)));
  assert.ok(seen.some((u) => /\/overleaf_connections\?/.test(u) && /token_ciphertext=not\.is\.null/.test(u) && /user_id=eq\.u1/.test(u)));
});

test("secrets: PostgrestSource encodes the user id in every secret-table URL", async () => {
  const seen: string[] = [];
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u 1",
    headers: {},
    fetch: countingFetch({ project_integrations: 0, user_settings: 0, overleaf_connections: 0 }, seen),
  });
  await source.secretCount();
  assert.equal(seen.length, 3);
  for (const url of seen) assert.doesNotMatch(url, / /, url);
  assert.ok(seen.every((u) => /u%201/.test(u)), seen.join("\n"));
});

test("secrets: PostgrestSource reads a count with no total as unknown (Infinity), so the export refuses", async () => {
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal(await source.secretCount(), Number.POSITIVE_INFINITY);
});

test("secrets: PostgrestSource reads a failing secret-table count as unknown (Infinity)", async () => {
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: countingFetch({ project_integrations: 0, user_settings: 0, overleaf_connections: 0 }, [], "user_settings"),
  });
  assert.equal(await source.secretCount(), Number.POSITIVE_INFINITY);
});
