import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchTypedPdfToCache } from "../application/resolve-paper-pdf-for-reader.js";

/**
 * 22-05: a proxy error is a failed fetch, not "the source is not a PDF".
 * Both cases return before the cache is written, so `indexedDB` only has to
 * exist; the desktop bridge stub means the proxy needs no access token.
 */
function stubEnv(res: { ok: boolean; status: number; body: number[] }) {
  const g = globalThis as Record<string, unknown>;
  const saved = { fetch: g.fetch, window: g.window, indexedDB: g.indexedDB };
  g.indexedDB = {};
  g.window = { weaveforge: { fetchTitle: () => undefined } };
  g.fetch = async () => ({ ok: res.ok, status: res.status, arrayBuffer: async () => new Uint8Array(res.body).buffer });
  return () => Object.assign(g, saved);
}

const ARXIV = "https://arxiv.org/pdf/2101.00001";

test("a proxy error on an allowlisted address reports failed (22-05)", async () => {
  const restore = stubEnv({ ok: false, status: 403, body: [] });
  try {
    assert.deepEqual(await fetchTypedPdfToCache("p1", ARXIV), { ok: false, reason: "failed" });
  } finally {
    restore();
  }
});

test("bytes that are not a PDF still report not-pdf (22-05)", async () => {
  const restore = stubEnv({ ok: true, status: 200, body: [0x3c, 0x68, 0x74, 0x6d, 0x6c] });
  try {
    assert.deepEqual(await fetchTypedPdfToCache("p1", ARXIV), { ok: false, reason: "not-pdf" });
  } finally {
    restore();
  }
});
