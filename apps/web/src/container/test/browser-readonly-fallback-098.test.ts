import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { BackendConfig } from "../../backend/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireBackend } from "../parts";
import { READ_ONLY_MESSAGE, ReadOnlyError } from "../read-only-repositories";
import { chooseBrowserStart } from "../browser-readonly-fallback-098";

const WIRING = { wiring: true, close: async () => {} } as never;

before(async () => {
  await loadTestCore();
});

/**
 * Item 6. A marker that is present but whose files fail to open starts read-only with the retry
 * banner, never on the writable server backend. A failed marker write (P1) keeps the next start
 * read-only too, so no user write reaches the server while the files are not proven.
 */

test("(item6) marker present, files fail to open: the start is read-only, not the server", () => {
  assert.deepEqual(chooseBrowserStart({ state: "failed" }, false), { mode: "read-only" });
});

test("(item6) marker present and files open: the start uses the files wiring", () => {
  assert.deepEqual(chooseBrowserStart({ state: "opened", wiring: WIRING }, false), {
    mode: "files",
    wiring: WIRING,
  });
});

test("(P1-1) no marker but a switch was pending (markExported097 ran, marker write failed): read-only", () => {
  assert.deepEqual(chooseBrowserStart({ state: "absent" }, true), { mode: "read-only" });
});

test("(0.9.8) no marker and nothing pending: read-only until the export verifies", () => {
  assert.deepEqual(chooseBrowserStart({ state: "absent" }, false), { mode: "read-only" });
});

test("(0.9.8) read-only server backend: no personal read, AI read or realtime reaches the server", async () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response("[]", { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const config = {
      provider: "postgrest",
      supabaseUrl: "http://127.0.0.1:9",
      supabaseAnonKey: "test-anon-key",
      dataUrl: "http://127.0.0.1:9",
    } as unknown as BackendConfig;
    const backend = wireBackend(config, { projectId: "p-1" }, () => "p-1", { readOnlyServer: true });
    await assert.rejects(() => Promise.resolve().then(() => backend.paperRepository.list()));
    await assert.rejects(() => Promise.resolve().then(() => backend.aiProposalStore.listPending()));
    assert.throws(() => (backend.db as unknown as { from(t: string): unknown }).from("papers"));
    assert.equal(backend.filesMode, true, "no project channel and only org CRDT types");
    assert.deepEqual(seen, [], "no request reached the server");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("(0.9.8) read-only server backend: no realtime channel and no blob read reach the server", async () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response("[]", { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const config = {
      provider: "postgrest",
      supabaseUrl: "http://127.0.0.1:9",
      supabaseAnonKey: "test-anon-key",
      dataUrl: "http://127.0.0.1:9",
    } as unknown as BackendConfig;
    const backend = wireBackend(config, { projectId: "p-1" }, () => "p-1", { readOnlyServer: true });
    const db = backend.db as unknown as {
      channel(topic: string): unknown;
      storage: { from(bucket: string): { createSignedUrls(p: string[], s: number): unknown; download(p: string): unknown } };
    };
    assert.throws(() => db.channel("crdt:note:n-1"), ReadOnlyError);
    const bucket = db.storage.from("paper-images");
    await assert.rejects(() => Promise.resolve().then(() => bucket.createSignedUrls(["p-1/a.webp"], 60)), ReadOnlyError);
    await assert.rejects(() => Promise.resolve().then(() => bucket.download("p-1/a.webp")), ReadOnlyError);
    assert.deepEqual(seen, [], "no request reached the server");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("(item6) read-only server backend: a write throws ReadOnlyError and never reaches fetch", async () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response("[]", { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const config = {
      provider: "postgrest",
      supabaseUrl: "http://127.0.0.1:9",
      supabaseAnonKey: "test-anon-key",
      dataUrl: "http://127.0.0.1:9",
    } as unknown as BackendConfig;
    const backend = wireBackend(config, { projectId: null }, () => null, { readOnlyServer: true });
    const note = {
      id: "n-1",
      title: "t",
      body: "b",
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await assert.rejects(
      () => Promise.resolve().then(() => backend.rawVaultPageRepository.save(note)),
      (err: unknown) => err instanceof ReadOnlyError && err.message === READ_ONLY_MESSAGE,
    );
    assert.deepEqual(seen, [], "no request reached the server");
  } finally {
    globalThis.fetch = realFetch;
  }
});
