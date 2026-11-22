import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgrestSource, TABLE_BY_KIND, toCamelRow } from "../infrastructure/postgrest-source";

const BASE = "https://api.example.test/rest";
const USER = "11111111-2222-3333-4444-555555555555";
const NOW = "2026-11-22T00:00:00.000Z";

type Call = { url: string; method: string; headers: Headers; body?: string };

// Fake fetch: records each call and answers via the handler. Injected, never global.
function fakeFetch(handler: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fake as typeof fetch, calls };
}

function sourceWith(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}): PostgrestSource {
  return new PostgrestSource({
    baseUrl: BASE,
    userId: USER,
    fetch: fetchImpl,
    headers: { apikey: "test-key" },
    ...extra,
  } as ConstructorParameters<typeof PostgrestSource>[0]);
}

test("table map covers every kind and snake_case rows convert to camelCase", () => {
  assert.deepEqual(TABLE_BY_KIND, {
    logEntries: "log_entries",
    reportSections: "report_sections",
    readingLists: "reading_lists",
    paperFields: "paper_fields",
    annotationPins: "annotation_pins",
    libraryPins: "library_pins",
    aiProposals: "ai_proposals",
  });
  assert.deepEqual(
    toCamelRow({ id: 1, created_at: "t", log_entry_id: 7, nested: { created_at: "keep" } }),
    { id: 1, createdAt: "t", logEntryId: 7, nested: { created_at: "keep" } },
  );
});

test("listRows pages past 1000 rows until an empty page", async () => {
  const offsets: number[] = [];
  const { fetch } = fakeFetch((call) => {
    const u = new URL(call.url);
    const offset = Number(u.searchParams.get("offset"));
    offsets.push(offset);
    const size = offset === 0 ? 1000 : offset === 1000 ? 250 : 0;
    const rows = Array.from({ length: size }, (_, i) => ({ id: offset + i, created_at: "t" }));
    return Response.json(rows);
  });
  const rows = await sourceWith(fetch).listRows("logEntries");
  assert.equal(rows.length, 1250);
  assert.deepEqual(offsets, [0, 1000, 2000]);
  assert.equal(rows.at(-1)?.id, 1249);
  assert.equal(rows[0]?.createdAt, "t");
});

test("listRows builds the filtered, ordered PostgREST URL", async () => {
  const { fetch, calls } = fakeFetch(() => Response.json([]));
  await sourceWith(fetch).listRows("readingLists");
  const call = calls[0];
  assert.ok(call);
  assert.equal(
    call.url,
    `${BASE}/reading_lists?user_id=eq.${USER}&deleted_at=is.null&order=id.asc&limit=1000&offset=0`,
  );
  assert.equal(call.method, "GET");
  assert.equal(call.headers.get("apikey"), "test-key");
});

test("countRows sends HEAD with count=exact and reads the total after the slash", async () => {
  const { fetch, calls } = fakeFetch(
    () => new Response(null, { status: 200, headers: { "content-range": "0-0/4242" } }),
  );
  assert.equal(await sourceWith(fetch).countRows("paperFields"), 4242);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.method, "HEAD");
  assert.equal(call.headers.get("prefer"), "count=exact");
  assert.equal(call.url, `${BASE}/paper_fields?user_id=eq.${USER}&deleted_at=is.null`);
});

test("countRows throws when content-range has no total", async () => {
  const { fetch } = fakeFetch(() => new Response(null, { status: 200 }));
  await assert.rejects(() => sourceWith(fetch).countRows("logEntries"), /content-range/);
});

test("markExported sends PATCH only when called, with URL and body", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  const source = sourceWith(fetch);
  assert.equal(calls.length, 0);
  await source.markExported(NOW);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.method, "PATCH");
  assert.equal(call.url, `${BASE}/profiles?user_id=eq.${USER}`);
  assert.equal(call.headers.get("content-type"), "application/json");
  assert.equal(call.headers.get("prefer"), "return=minimal");
  assert.equal(call.body, JSON.stringify({ exported_097_at: NOW }));
});

test("markExported throws on non-2xx", async () => {
  const { fetch } = fakeFetch(() => new Response("nope", { status: 403 }));
  await assert.rejects(() => sourceWith(fetch).markExported(NOW), /403/);
});

test("listBlobs and fetchBlob throw so the run goes incomplete", async () => {
  const { fetch } = fakeFetch(() => Response.json([]));
  const source = sourceWith(fetch);
  const msg = "blob listing not implemented: export incomplete";
  await assert.rejects(() => source.listBlobs(), new RegExp(msg));
  await assert.rejects(
    () => source.fetchBlob({ bucket: "b", path: "p", sha256: "s" }),
    new RegExp(msg),
  );
});

test("non-2xx GET throws with status and table, never the body", async () => {
  const { fetch } = fakeFetch(
    () => new Response("SECRET-BODY-TEXT", { status: 500, headers: { "x-secret": "hdr-value" } }),
  );
  await assert.rejects(
    () => sourceWith(fetch).listRows("logEntries"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /500/);
      assert.match(err.message, /log_entries/);
      assert.doesNotMatch(err.message, /SECRET-BODY-TEXT|hdr-value/);
      return true;
    },
  );
});

test("pendingOutbox and undecryptable default to not wired, injected values pass through", async () => {
  const { fetch } = fakeFetch(() => Response.json([]));
  const bare = sourceWith(fetch);
  await assert.rejects(() => bare.pendingOutbox(), /not wired/);
  await assert.rejects(() => bare.undecryptable("logEntries"), /not wired/);
  const wired = sourceWith(fetch, {
    pendingOutbox: async () => 3,
    undecryptable: async (kind: string) => (kind === "logEntries" ? 2 : 0),
  });
  assert.equal(await wired.pendingOutbox(), 3);
  assert.equal(await wired.undecryptable("logEntries"), 2);
});
