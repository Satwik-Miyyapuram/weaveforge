import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { Paper } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { BackendConfig } from "@/backend/parts";
import { wireBrowserFiles } from "@/container/browser-file-backend";
import { PostgrestSource } from "../infrastructure/postgrest-source";

before(async () => {
  await loadTestCore();
});

const BASE = "https://api.example.test/rest";

/** Answers every PostgREST read with an empty array and records each URL. */
function recordingFetch(): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fake = async (input: string | URL | Request): Promise<Response> => {
    urls.push(String(input));
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fake as typeof fetch, urls };
}

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

test("export reads pass: the web-export source lists personal rows over PostgREST", async () => {
  const net = recordingFetch();
  const source = new PostgrestSource({
    baseUrl: BASE,
    userId: "11111111-2222-3333-4444-555555555555",
    fetch: net.fetch,
    headers: { apikey: "test-key" },
  });
  const rows = await source.listRows("papers");
  assert.deepEqual(rows, []);
  assert.ok(net.urls.some((u) => u.includes("/papers")), "the export read must reach PostgREST");
});

test("app writes are refused in files mode while the export source still reads", async () => {
  const wire = await wireBrowserFiles(new MemoryWorkspaceFs());
  const backend = wire(config, { projectId: null }, () => null);

  // The app's personal write goes through the guarded server client: refused before any request.
  const appNet = recordingFetch();
  const realFetch = globalThis.fetch;
  globalThis.fetch = appNet.fetch;
  try {
    // paper_tags is personal and not allowlisted, so the guarded server db refuses it before any request.
    await assert.rejects(
      async () => backend.db.from("paper_tags").insert({}),
      /not allowed on the org server/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(appNet.urls, [], "a refused app write must not reach the network");

  // The export source is a separate reader: it still lists rows.
  const exportNet = recordingFetch();
  const source = new PostgrestSource({
    baseUrl: BASE,
    userId: "11111111-2222-3333-4444-555555555555",
    fetch: exportNet.fetch,
    headers: { apikey: "test-key" },
  });
  await source.listRows("papers");
  assert.ok(exportNet.urls.length > 0, "the export read must still reach PostgREST");
});

test("source probe: the only send() outside request() is markExported097, and every read is GET or HEAD", () => {
  const src = readFileSync(fileURLToPath(new URL("../infrastructure/postgrest-source.ts", import.meta.url)), "utf8");
  const sendCalls = src.split("this.send(").length - 1;
  const markAt = src.indexOf("async markExported097");
  assert.ok(markAt > 0, "markExported097 must exist");
  // One send() in request() (before markExported097), one in markExported097 itself.
  assert.equal(sendCalls, 2, "send() must have exactly two call sites: request() and markExported097()");
  assert.equal(src.slice(0, markAt).split("this.send(").length - 1, 1, "only request() may call send() before markExported097");
  const requests = src.split("this.request(").length - 1;
  const methods = [...src.matchAll(/this\.request\(\s*\w+,\s*\{\s*method: "(\w+)"/g)].map((m) => m[1]);
  assert.equal(methods.length, requests, "every this.request() call must pass a literal method");
  for (const method of methods) assert.ok(method === "GET" || method === "HEAD", `read-only source uses ${method}`);
});
