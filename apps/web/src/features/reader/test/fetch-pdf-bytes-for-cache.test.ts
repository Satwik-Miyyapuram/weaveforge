import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPdfBytesForCache } from "../application/resolve-paper-pdf-for-reader.js";

const TOKEN = "test-access-token";
const withToken = async () => TOKEN;
const withoutToken = async () => null;

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(calls: FetchCall[], ok = true) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(input), headers: init?.headers ?? {} });
    return {
      ok,
      arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
    };
  }) as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("an allowlisted publisher URL is fetched through the same-origin proxy", async () => {
  // Fetching arxiv.org directly is blocked by CORS, so seeding the byte cache
  // failed silently for every source the ladder can actually resolve — the
  // cache step of the ladder was dead weight.
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls);
  try {
    const bytes = await fetchPdfBytesForCache("https://arxiv.org/pdf/2401.00001", withToken);
    assert.ok(bytes, "bytes must come back");
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0]!.url.startsWith("/api/pdf-proxy?"),
      `expected the proxy, got ${calls[0]!.url}`,
    );
    assert.equal(calls[0]!.headers.Authorization, `Bearer ${TOKEN}`);
  } finally {
    restore();
  }
});

test("a same-origin URL is fetched as-is, without a bearer token", async () => {
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls);
  try {
    await fetchPdfBytesForCache("/local/paper.pdf", withToken);
    assert.equal(calls[0]!.url, "/local/paper.pdf");
    assert.deepEqual(calls[0]!.headers, {});
  } finally {
    restore();
  }
});

test("an unallowlisted host is not fetched at all", async () => {
  // The proxy will not forward it and CORS would reject a direct request, so
  // spending a round-trip on it only burns the user's bandwidth.
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls);
  try {
    assert.equal(await fetchPdfBytesForCache("https://example.com/paper.pdf", withToken), null);
    assert.equal(calls.length, 0, "no request should be made");
  } finally {
    restore();
  }
});

test("a non-ok response yields null rather than caching an error page", async () => {
  // A 404 body cached under the paper id would be served to pdf.js forever.
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls, false);
  try {
    assert.equal(await fetchPdfBytesForCache("https://arxiv.org/pdf/2401.00001", withToken), null);
  } finally {
    restore();
  }
});

test("a missing access token skips the proxy fetch", async () => {
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls);
  try {
    assert.equal(
      await fetchPdfBytesForCache("https://arxiv.org/pdf/2401.00001", withoutToken),
      null,
    );
    assert.equal(calls.length, 0, "an unauthenticated proxy call would only 401");
  } finally {
    restore();
  }
});

test("an empty body is not cached", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  })) as unknown as typeof globalThis.fetch;
  try {
    assert.equal(await fetchPdfBytesForCache("/local/paper.pdf", withToken), null);
  } finally {
    globalThis.fetch = original;
  }
});
