import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllZoteroItems, fetchZoteroItemKeys } from "../infrastructure/zotero-web-api";

interface Call { url: string; at: number }

/**
 * A stand-in for the Zotero items endpoint: honours `limit`/`start`, reports
 * `Total-Results`, and records when each request was made so concurrency is
 * observable.
 */
function mockZotero(total: number, opts: { totalHeader?: boolean; latencyMs?: number } = {}) {
  const calls: Call[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push({ url, at: Date.now() });
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    inFlight -= 1;

    const parsed = new URL(url);
    const limit = Number(parsed.searchParams.get("limit") ?? 25);
    const start = Number(parsed.searchParams.get("start") ?? 0);
    const page = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({
      key: `K${start + i}`,
    }));
    const headers = new Headers();
    if (opts.totalHeader !== false) headers.set("Total-Results", String(total));
    return new Response(JSON.stringify(page), { status: 200, headers });
  }) as unknown as typeof fetch;
  return { fetchFn, calls, peak: () => peakInFlight };
}

const req = (fetchFn: typeof fetch) => ({
  baseUrl: "https://api.zotero.org/users/1",
  headers: { "Zotero-API-Key": "k" },
  fetchFn,
});

test("zotero paginator: returns every item across pages, in order", async () => {
  const m = mockZotero(250);
  const items = await fetchAllZoteroItems<{ key: string }>(req(m.fetchFn));
  assert.equal(items.length, 250);
  assert.equal(items[0]!.key, "K0");
  assert.equal(items[249]!.key, "K249");
  // Order matters: a shuffled library would reshuffle the reader's annotations.
  assert.deepEqual(
    items.map((i) => i.key),
    Array.from({ length: 250 }, (_, i) => `K${i}`),
  );
});

test("zotero paginator: pages after the first overlap in time", async () => {
  // 500 items = 5 pages. Serially that is 5 x 50ms; concurrently far less.
  const m = mockZotero(500, { latencyMs: 50 });
  const started = Date.now();
  await fetchAllZoteroItems(req(m.fetchFn));
  const elapsed = Date.now() - started;

  assert.ok(m.peak() > 1, `expected concurrent requests, peak was ${m.peak()}`);
  assert.ok(elapsed < 5 * 50, `expected overlap, took ${elapsed}ms`);
});

test("zotero paginator: one page needs exactly one request", async () => {
  const m = mockZotero(40);
  const items = await fetchAllZoteroItems(req(m.fetchFn));
  assert.equal(items.length, 40);
  assert.equal(m.calls.length, 1, "a short first page already proves there is no more");
});

test("zotero paginator: an exactly-full single page does not over-fetch", async () => {
  const m = mockZotero(100);
  const items = await fetchAllZoteroItems(req(m.fetchFn));
  assert.equal(items.length, 100);
  // Total-Results says 100, so the second page is known to be empty without asking.
  assert.equal(m.calls.length, 1);
});

test("zotero paginator: falls back to serial walking without Total-Results", async () => {
  const m = mockZotero(250, { totalHeader: false });
  const items = await fetchAllZoteroItems(req(m.fetchFn));
  assert.equal(items.length, 250);
  // 3 full-ish pages + the short one that ends the walk.
  assert.equal(m.calls.length, 3);
});

test("zotero paginator: retries a 429 and then succeeds", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("slow down", { status: 429, headers: { "Retry-After": "0" } });
    }
    return new Response(JSON.stringify([{ key: "A" }]), {
      status: 200,
      headers: { "Total-Results": "1" },
    });
  }) as unknown as typeof fetch;

  const items = await fetchAllZoteroItems<{ key: string }>(req(fetchFn));
  assert.deepEqual(items, [{ key: "A" }]);
  assert.equal(calls, 2);
});

test("zotero paginator: surfaces a hard failure with the status", async () => {
  const fetchFn = (async () =>
    new Response("nope", { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchAllZoteroItems({ ...req(fetchFn), label: "annotation" }),
    /Zotero annotation fetch failed \(403\)/,
  );
});

test("zotero keys: parses the newline list and skips blanks", async () => {
  const fetchFn = (async (input: string | URL | Request) => {
    assert.match(String(input), /format=keys/);
    assert.match(String(input), /collection=COL1/);
    return new Response("AAA\nBBB\n\nCCC\n", { status: 200 });
  }) as unknown as typeof fetch;

  const keys = await fetchZoteroItemKeys({
    ...req(fetchFn),
    params: { collection: "COL1" },
  });
  assert.deepEqual([...keys].sort(), ["AAA", "BBB", "CCC"]);
});
