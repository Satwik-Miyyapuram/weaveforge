import assert from "node:assert/strict";
import test from "node:test";
import type { ReaderAnnotation } from "@weaveforge/core";
import { ZoteroApiAnnotationWriteBack } from "../infrastructure/zotero-annotation-write-back";

const CREDS = async () => ({ apiKey: "key-123", library: "users/42" });

function ann(over: Partial<ReaderAnnotation> = {}): ReaderAnnotation {
  return {
    id: "local-1",
    origin: "local",
    zoteroKey: null,
    type: "highlight",
    color: "#ffd400",
    text: "quoted",
    comment: "",
    tags: [],
    anchor: { zoteroPosition: { pageIndex: 2, rects: [[1, 2, 3, 4]] } },
    sortIndex: "00002|000000|00080",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(
  calls: Call[],
  reply: (call: Call) => { status?: number; body?: unknown; version?: string },
): typeof fetch {
  return (async (url: unknown, init: RequestInit = {}) => {
    const call: Call = {
      url: String(url),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = reply(call);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => (h === "Last-Modified-Version" ? r.version ?? null : null) },
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? ""),
    };
  }) as unknown as typeof fetch;
}

test("push is a dry run unless the caller explicitly opts in", async () => {
  // Mutating a real research library must never be a side effect of rendering.
  const calls: Call[] = [];
  const client = new ZoteroApiAnnotationWriteBack(CREDS, stub(calls, () => ({})));
  const result = await client.push("ATTACH01", [ann()]);
  assert.equal(result.dryRun, true);
  assert.equal(result.payloads.length, 1);
  assert.deepEqual(result.results, []);
  assert.equal(calls.length, 0, "a dry run must not touch the network");
});

test("a dry run still builds the payload Zotero would receive", async () => {
  const client = new ZoteroApiAnnotationWriteBack(CREDS, stub([], () => ({})));
  const { payloads } = await client.push("ATTACH01", [ann({ tags: ["method"] })]);
  assert.deepEqual(payloads[0], {
    itemType: "annotation",
    parentItem: "ATTACH01",
    annotationType: "highlight",
    annotationText: "quoted",
    annotationComment: "",
    annotationColor: "#ffd400",
    annotationSortIndex: "00002|000000|00080",
    annotationPosition: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
    tags: [{ tag: "method" }],
  });
});

test("a live push creates new annotations and returns their Zotero keys", async () => {
  const calls: Call[] = [];
  const client = new ZoteroApiAnnotationWriteBack(
    CREDS,
    stub(calls, () => ({ body: { successful: { "0": { key: "ZKEY01", version: 55 } } }, version: "55" })),
  );
  const result = await client.push("ATTACH01", [ann()], { live: true });

  assert.equal(result.dryRun, false);
  assert.deepEqual(result.results, [
    { id: "local-1", outcome: "created", zoteroKey: "ZKEY01", zoteroVersion: 55 },
  ]);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://api.zotero.org/users/42/items");
  assert.equal(calls[0]!.headers["Zotero-API-Key"], "key-123");
  assert.equal(calls[0]!.headers["Zotero-API-Version"], "3");
  // Idempotency: a retried create must not duplicate the highlight.
  assert.match(calls[0]!.headers["Zotero-Write-Token"] ?? "", /^[0-9a-f]{32}$/);
});

test("an existing annotation is PATCHed with its version guard", async () => {
  const calls: Call[] = [];
  const client = new ZoteroApiAnnotationWriteBack(
    CREDS,
    stub(calls, () => ({ status: 204, version: "88" })),
  );
  const result = await client.push(
    "ATTACH01",
    [ann({ zoteroKey: "ZKEY01", zoteroVersion: 87 })],
    { live: true },
  );

  assert.equal(calls[0]!.method, "PATCH");
  assert.equal(calls[0]!.url, "https://api.zotero.org/users/42/items/ZKEY01");
  assert.equal(calls[0]!.headers["If-Unmodified-Since-Version"], "87");
  assert.deepEqual(result.results, [
    { id: "local-1", outcome: "updated", zoteroKey: "ZKEY01", zoteroVersion: 88 },
  ]);
});

test("a 412 is reported as a conflict, never as a successful overwrite", async () => {
  // This is the whole point of the version guard: an edit made in Zotero
  // desktop since our last sync must not be silently clobbered.
  const client = new ZoteroApiAnnotationWriteBack(CREDS, stub([], () => ({ status: 412 })));
  const result = await client.push(
    "ATTACH01",
    [ann({ zoteroKey: "ZKEY01", zoteroVersion: 5 })],
    { live: true },
  );
  assert.equal(result.results[0]!.outcome, "conflict");
  assert.match(result.results[0]!.reason ?? "", /changed in Zotero/);
});

test("a rejected item is reported per annotation rather than failing the batch", async () => {
  const client = new ZoteroApiAnnotationWriteBack(
    CREDS,
    stub([], () => ({
      body: {
        successful: { "0": { key: "OK1", version: 9 } },
        failed: { "1": { code: 400, message: "invalid annotationPosition" } },
      },
      version: "9",
    })),
  );
  const result = await client.push(
    "ATTACH01",
    [ann({ id: "a" }), ann({ id: "b" })],
    { live: true },
  );
  assert.deepEqual(
    result.results.map((r) => [r.id, r.outcome]),
    [["a", "created"], ["b", "failed"]],
  );
  assert.match(result.results[1]!.reason ?? "", /invalid annotationPosition/);
});

test("an HTTP failure marks every annotation in the batch failed, not created", async () => {
  const client = new ZoteroApiAnnotationWriteBack(
    CREDS,
    stub([], () => ({ status: 500, body: "upstream boom" })),
  );
  const result = await client.push("ATTACH01", [ann({ id: "a" }), ann({ id: "b" })], { live: true });
  assert.deepEqual(result.results.map((r) => r.outcome), ["failed", "failed"]);
});

test("a live push without credentials refuses instead of silently dry-running", async () => {
  const calls: Call[] = [];
  const client = new ZoteroApiAnnotationWriteBack(async () => ({}), stub(calls, () => ({})));
  await assert.rejects(
    () => client.push("ATTACH01", [ann()], { live: true }),
    /Zotero is not configured/,
  );
  assert.equal(calls.length, 0);
});

test("a live push without an attachment key refuses", async () => {
  // Annotations anchor to the stored PDF, not the bibliographic item; an empty
  // key would have Zotero reject every row after the request was already sent.
  const client = new ZoteroApiAnnotationWriteBack(CREDS, stub([], () => ({})));
  await assert.rejects(
    () => client.push("  ", [ann()], { live: true }),
    /attachment key is required/,
  );
});

test("creates and updates in one push are routed to the right verbs", async () => {
  const calls: Call[] = [];
  const client = new ZoteroApiAnnotationWriteBack(
    CREDS,
    stub(calls, (c) =>
      c.method === "POST"
        ? { body: { successful: { "0": { key: "NEW1", version: 12 } } }, version: "12" }
        : { status: 204, version: "12" },
    ),
  );
  const result = await client.push(
    "ATTACH01",
    [ann({ id: "new" }), ann({ id: "old", zoteroKey: "ZOLD", zoteroVersion: 11 })],
    { live: true },
  );
  assert.deepEqual(
    result.results.map((r) => [r.id, r.outcome]).sort(),
    [["new", "created"], ["old", "updated"]],
  );
  assert.deepEqual(calls.map((c) => c.method).sort(), ["PATCH", "POST"]);
});
