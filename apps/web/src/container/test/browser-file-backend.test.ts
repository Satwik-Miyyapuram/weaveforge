import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Paper } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { BackendConfig } from "@/backend/parts";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { wireBrowserFiles } from "../browser-file-backend";

before(async () => {
  await loadTestCore();
});

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

function paper(): Paper {
  return {
    id: "p-1",
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Records every request URL. Installed after a backend is built, so construction traffic is not counted. */
function spyNetwork() {
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    throw new Error("spied network");
  }) as typeof fetch;
  return { urls, restore: () => (globalThis.fetch = real) };
}

async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // The spy refuses every request; only the recorded URLs matter.
  }
}

test("control: without the overlay a personal write reaches PostgREST", async () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    await quietly(() => wired.paperRepository.save(paper()));
    assert.ok(spy.urls.length > 0, "the spy must see PostgREST traffic, or the test proves nothing");
  } finally {
    spy.restore();
    wired.dispose();
  }
});

test("with the browser file overlay, a personal round trip makes zero network calls", async () => {
  const fs = new MemoryWorkspaceFs();
  const wire = await wireBrowserFiles(fs);
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    await backend.paperRepository.save(paper());
    const listed = await backend.paperRepository.list();
    assert.deepEqual(
      listed.map((p) => p.id),
      ["p-1"],
    );
    assert.deepEqual(spy.urls, []);
  } finally {
    spy.restore();
    backend.dispose();
  }
});

test("with the overlay, org and sharing reads still go to PostgREST", async () => {
  const fs = new MemoryWorkspaceFs();
  const wire = await wireBrowserFiles(fs);
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    await quietly(async () => {
      await backend.db.from("share_links").select("*");
    });
    assert.ok(
      spy.urls.some((url) => url.includes("share_links")),
      "org data must keep its PostgREST path",
    );
  } finally {
    spy.restore();
    backend.dispose();
  }
});
