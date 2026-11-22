import assert from "node:assert/strict";
import { test } from "node:test";
import { MIGRATION_KINDS } from "../domain/report";
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
    notes: "vault_pages",
    papers: "papers",
    tags: "tags",
    paperFields: "paper_fields",
    relations: "paper_relations",
    readingLists: "reading_lists",
    screening: "screening_decisions",
    logEntries: "log_entries",
    milestones: "milestones",
    experiments: "experiments",
    metrics: "experiment_metrics",
    reportSections: "report_sections",
    annotations: "reader_annotations",
    annotationPins: "annotation_pins",
    libraryPins: "library_pins",
    comments: "comments",
    settings: "user_settings",
    aiProposals: "ai_proposals",
    blobs: "blob_objects",
  });
  assert.deepEqual(
    toCamelRow({ id: 1, created_at: "t", log_entry_id: 7, nested: { created_at: "keep" } }),
    { id: 1, createdAt: "t", logEntryId: 7, nested: { created_at: "keep" } },
  );
});

test("every exporter kind is either mapped to a table or is file-only (ink)", () => {
  for (const kind of MIGRATION_KINDS) {
    if (kind === "ink") continue; // strokes are files, never a server table
    assert.ok(
      Object.prototype.hasOwnProperty.call(TABLE_BY_KIND, kind),
      `kind ${kind} has no entry in TABLE_BY_KIND`,
    );
  }
});

test("listRows on the file-only ink kind returns no rows and makes no request", async () => {
  const { fetch, calls } = fakeFetch(() => new Response("[]", { status: 200 }));
  const rows = await sourceWith(fetch).listRows("ink");
  assert.deepEqual(rows, []);
  assert.equal(calls.length, 0);
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

test("markExported calls rpc/mark_exported_097 with POST and no body, only when called", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  const source = sourceWith(fetch);
  assert.equal(calls.length, 0);
  await source.markExported(NOW);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.method, "POST");
  assert.equal(call.url, `${BASE}/rpc/mark_exported_097`);
  assert.ok(!call.body, "no body: the server function sets the row for auth.uid()");
});

test("markExported throws on non-2xx", async () => {
  const { fetch } = fakeFetch(() => new Response("nope", { status: 403 }));
  await assert.rejects(() => sourceWith(fetch).markExported(NOW), /403/);
});

test("listBlobs still throws so the run goes incomplete (no server sha256 to check against)", async () => {
  const { fetch } = fakeFetch(() => Response.json([]));
  const source = sourceWith(fetch);
  await assert.rejects(() => source.listBlobs(), /blob listing not implemented: export incomplete/);
});

test("fetchBlob downloads the bytes through the signed URL", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const { fetch, calls } = fakeFetch(() => new Response(bytes));
  const signed: string[] = [];
  const source = sourceWith(fetch, {
    signedUrl: async (bucket: string, path: string) => {
      signed.push(`${bucket}/${path}`);
      return "https://blobs.example.test/signed/abc";
    },
  });
  const got = await source.fetchBlob({ bucket: "ink", path: "p/1.png", sha256: "s" });
  assert.deepEqual(Array.from(got), [1, 2, 3, 4]);
  assert.deepEqual(signed, ["ink/p/1.png"]);
  assert.equal(calls[0]?.url, "https://blobs.example.test/signed/abc");
});

test("fetchBlob throws on a non-2xx download, without the body", async () => {
  const { fetch } = fakeFetch(() => new Response("secret body", { status: 403 }));
  const source = sourceWith(fetch, { signedUrl: async () => "https://blobs.example.test/x" });
  await assert.rejects(
    () => source.fetchBlob({ bucket: "ink", path: "p", sha256: "s" }),
    (err: Error) => /HTTP 403/.test(err.message) && !err.message.includes("secret body"),
  );
});

test("fetchBlob with no signed URL throws", async () => {
  const { fetch } = fakeFetch(() => new Response(new Uint8Array([1])));
  const missing = sourceWith(fetch, { signedUrl: async () => null });
  await assert.rejects(() => missing.fetchBlob({ bucket: "ink", path: "p", sha256: "s" }), /no signed url/);
  const unwired = sourceWith(fetch);
  await assert.rejects(() => unwired.fetchBlob({ bucket: "ink", path: "p", sha256: "s" }), /signedUrl not wired/);
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
