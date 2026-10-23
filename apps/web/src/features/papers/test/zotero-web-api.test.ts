import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllZoteroItems, fetchZoteroItemKeys } from "../infrastructure/zotero-web-api";

interface Call { url: string }

/**
 * A stand-in for the Zotero items endpoint: honours `limit`/`start`, reports
 * `Total-Results`, and records each request.
 */
function mockZotero(total: number, opts: { totalHeader?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push({ url });

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
  return { fetchFn, calls };
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
  // 500 items = 5 pages: page 1 alone, then pages 2-5 together. Every later
  // page is held open on a gate, so concurrency is counted, not timed. The
  // gate opens after a few event-loop turns, which is long after a concurrent
  // paginator has dispatched its requests (that happens in microtasks), and
  // keeps a serial paginator from hanging the test.
  const base = mockZotero(500);
  let laterInFlight = 0;
  let inFlightWhenReleased = -1;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = () => {
      inFlightWhenReleased = laterInFlight;
      resolve();
    };
  });
  const turns = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
  };
  const fetchFn = (async (input: string | URL | Request) => {
    const start = Number(new URL(String(input)).searchParams.get("start") ?? 0);
    if (start > 0) {
      laterInFlight += 1;
      if (laterInFlight === 1) void turns(10).then(() => release?.());
      await gate;
    }
    return base.fetchFn(input);
  }) as unknown as typeof fetch;

  const items = await fetchAllZoteroItems(req(fetchFn));

  assert.equal(items.length, 500);
  assert.equal(laterInFlight, 4, "pages 2-5 each requested once");
  assert.equal(inFlightWhenReleased, 4, "pages 2-5 were all in flight before any finished");
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
