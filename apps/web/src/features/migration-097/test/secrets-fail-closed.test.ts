import { onlyReportPath } from "./own-report";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";
import { PostgrestSource } from "../infrastructure/postgrest-source";
import { settingsSecretNames } from "../domain/secret-tables";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];
const L1 = { id: "l1", text: "from the database" };

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

/** A server whose secret providers are given; `marks` records every server marker call. */
function server(secretProviders: () => Promise<string[]>, marks: string[]): ServerSource {
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
    secretProviders,
  } as unknown as ServerSource;
}

test("secrets: a source that cannot say which providers hold secrets refuses, and writes no data", async () => {
  const marks: string[] = [];
  const sink = new MemorySink();
  const source = server(async () => {
    throw new Error("count failed");
  }, marks);
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source, sink, now: NOW });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "keys: unreadable"));
  assert.deepEqual(marks, [], "no server marker when the secrets cannot be read");
  assert.equal((await sink.list()).some((p) => p.startsWith("logEntries/")), false, "a refused run writes no data");
  assert.equal(JSON.parse(await sink.readText(await onlyReportPath(sink))).state, "incomplete");
});

test("secrets: no providers with secrets runs without a mover and verifies, reconnecting nothing", async () => {
  const marks: string[] = [];
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => [], marks),
    sink: new MemorySink(),
    now: NOW,
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.reconnectProviders, []);
  assert.deepEqual(marks, ["mark"]);
});

test("secrets: the run still names every provider that holds a secret for reconnect", async () => {
  const marks: string[] = [];
  const sink = new MemorySink();
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => ["zotero"], marks),
    sink,
    now: NOW,
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.reconnectProviders, ["zotero"]);
  assert.deepEqual(JSON.parse(await sink.readText(await onlyReportPath(sink))).reconnectProviders, ["zotero"]);
  assert.deepEqual(marks, ["mark"]);
});

test("secrets: a failing secret check refuses the run and writes no server marker (fail closed)", async () => {
  const marks: string[] = [];
  const sink = new MemorySink();
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => {
      throw new Error("secret check failed");
    }, marks),
    sink,
    now: NOW,
  });
  assert.notEqual(result.state, "verified", "a run whose secrets cannot be read is never verified");
  assert.ok(result.run.missing.some((m) => m.reason === "keys: unreadable"));
  assert.deepEqual(marks, [], "no server marker when the secrets cannot be read");
});

test("secrets: a provider with a secret does not block the export; it is named for reconnect and the run verifies", async () => {
  const marks: string[] = [];
  const sink = new MemorySink();
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => ["zotero", "overleaf"], marks),
    sink,
    now: NOW,
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.reconnectProviders, ["zotero", "overleaf"]);
  assert.deepEqual(marks, ["mark"]);
  assert.deepEqual(JSON.parse(await sink.readText(await onlyReportPath(sink))).reconnectProviders, ["zotero", "overleaf"]);
});

test("secrets: a web run with a mover runs it once after verify and still names the provider with a secret", async () => {
  const marks: string[] = [];
  let moved = 0;
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => ["zotero"], marks),
    sink: new MemorySink(),
    now: NOW,
    moveSecrets: async () => {
      moved++;
    },
  });
  assert.equal(result.state, "verified");
  assert.equal(moved, 1);
  assert.deepEqual(result.reconnectProviders, ["zotero"]);
});

test("secrets: PostgrestSource names each provider whose table has a secret row", async () => {
  const seen: string[] = [];
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: countingFetch({ project_integrations: 3, user_settings: 0, overleaf_connections: 0 }, seen),
  });
  assert.deepEqual(await source.secretProviders(), ["project integrations"]);
  assert.match(seen[0] ?? "", /\/project_integrations\?/);
  assert.match(seen[0] ?? "", /token=not\.is\.null/);
  assert.match(seen[0] ?? "", /projects\.user_id=eq\.u1/);
});

test("keys: with secrets and no mover, the result and report carry provider names only, never a secret value", async () => {
  // The secret value is held by the source, never returned through ServerSource: the export gets names only.
  const SECRET = "sk-live-do-not-leak-7731";
  const marks: string[] = [];
  const sink = new MemorySink();
  const result = await runWebExport({
    runDeviceId: "dev-test",
    kinds: KINDS,
    codec,
    source: server(async () => ["zotero"], marks),
    sink,
    now: NOW,
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.reconnectProviders, ["zotero"]);
  assert.equal(JSON.stringify(result).includes(SECRET), false, "result holds no secret value");
  const report = await sink.readText(await onlyReportPath(sink));
  assert.equal(report.includes(SECRET), false, "report holds no secret value");
  assert.deepEqual(JSON.parse(report).reconnectProviders, ["zotero"]);
  assert.deepEqual(marks, ["mark"]);
});

/**
 * A fake PostgREST: each table's HEAD count comes from `totals`; `fail` names a table that answers 500.
 * user_settings is read with a GET, answered with `settings` (the user's rows).
 */
function countingFetch(totals: Record<string, number>, seen: string[], fail?: string, settings: unknown = []): typeof fetch {
  return (async (url: string) => {
    seen.push(url);
    const table = new URL(url).pathname.split("/").pop() ?? "";
    if (table === fail) return new Response(null, { status: 500 });
    if (table === "user_settings") return new Response(JSON.stringify(settings), { status: 200 });
    const total = totals[table];
    return new Response(null, {
      status: 200,
      headers: total === undefined ? {} : { "content-range": `0-0/${total}` },
    });
  }) as unknown as typeof fetch;
}

test("secrets: PostgrestSource names every provider whose secret table has rows", async () => {
  const seen: string[] = [];
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: countingFetch({ project_integrations: 3, overleaf_connections: 2 }, seen, undefined, [{ zotero_api_key: "zk" }]),
  });
  assert.deepEqual(await source.secretProviders(), ["project integrations", "zotero", "overleaf"]);
  assert.equal(seen.length, 3);
  const settingsUrl = seen.find((u) => /\/user_settings\?/.test(u)) ?? "";
  assert.match(settingsUrl, /select=credentials_enc,zotero_api_key,semantic_scholar_key,integrations/);
  assert.match(settingsUrl, /user_id=eq\.u1/);
  assert.ok(seen.some((u) => /\/overleaf_connections\?/.test(u) && /token_ciphertext=not\.is\.null/.test(u) && /user_id=eq\.u1/.test(u)));
});

test("secrets: user_settings is named for a sealed envelope, a Semantic Scholar key or an integration secret, not only a Zotero key", async () => {
  const source = (settings: unknown) =>
    new PostgrestSource({
      baseUrl: "https://api.example.test",
      userId: "u1",
      headers: {},
      fetch: countingFetch({ project_integrations: 0, overleaf_connections: 0 }, [], undefined, settings),
    });
  // 0069 clears zotero_api_key once the envelope is written, so the envelope alone must count.
  assert.deepEqual(await source([{ credentials_enc: "v1.abc", zotero_api_key: null }]).secretProviders(), ["sealed credentials"]);
  assert.deepEqual(await source([{ semantic_scholar_key: "ss" }]).secretProviders(), ["semantic scholar"]);
  assert.deepEqual(await source([{ integrations: { github: { pat: "p" } } }]).secretProviders(), ["github"]);
  assert.deepEqual(await source([{ credentials_enc: "", zotero_api_key: "  ", integrations: {} }]).secretProviders(), []);
  assert.deepEqual(await source([]).secretProviders(), []);
});

test("secrets: a user_settings read that is not a row list rejects, so the export refuses", async () => {
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: countingFetch({ project_integrations: 0, overleaf_connections: 0 }, [], undefined, { message: "odd" }),
  });
  await assert.rejects(source.secretProviders());
});

test("settingsSecretNames names every secret source in a settings row, never a value", () => {
  assert.deepEqual(
    settingsSecretNames({
      credentials_enc: "v1.sealed",
      zotero_api_key: "zk-value",
      semantic_scholar_key: "ss-value",
      integrations: { github: { pat: "p" }, custom: { a: "x" }, deep: { nested: { token: "t" } }, blank: { pat: " " }, empty: {}, bad: "x" },
    }),
    // A bare scalar provider value ("bad") is a credential too: named for reconnect, never archived.
    ["sealed credentials", "zotero", "semantic scholar", "github", "custom", "deep", "bad"],
  );
  assert.deepEqual(settingsSecretNames({}), []);
  assert.deepEqual(settingsSecretNames({ credentials_enc: null, zotero_api_key: "", semantic_scholar_key: " ", integrations: null }), []);
  // A non-object bag is stripped from disk too, so it must be named, never silently lost.
  assert.deepEqual(settingsSecretNames({ integrations: "tok" }), ["integrations"]);
  assert.deepEqual(settingsSecretNames({ integrations: ["tok"] }), ["integrations"]);
  assert.deepEqual(settingsSecretNames({ integrations: [" "] }), []);
});

test("secrets: PostgrestSource encodes the user id in every secret-table URL", async () => {
  const seen: string[] = [];
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u 1",
    headers: {},
    fetch: countingFetch({ project_integrations: 0, user_settings: 0, overleaf_connections: 0 }, seen),
  });
  assert.deepEqual(await source.secretProviders(), []);
  assert.equal(seen.length, 3);
  for (const url of seen) assert.doesNotMatch(url, / /, url);
  assert.ok(seen.every((u) => /u%201/.test(u)), seen.join("\n"));
});

test("secrets: PostgrestSource rejects a count with no total, so the export refuses rather than reading zero", async () => {
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
  });
  await assert.rejects(source.secretProviders());
});

test("secrets: PostgrestSource rejects when a secret-table count fails, so the export refuses", async () => {
  const source = new PostgrestSource({
    baseUrl: "https://api.example.test",
    userId: "u1",
    headers: {},
    fetch: countingFetch({ project_integrations: 0, user_settings: 0, overleaf_connections: 0 }, [], "user_settings"),
  });
  await assert.rejects(source.secretProviders());
});
