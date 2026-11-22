import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgrestSource } from "../infrastructure/postgrest-source";

test("every read method sends only GET or HEAD; the mark RPC is the one POST", async () => {
  const methods: string[] = [];
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
    if (method === "POST") return new Response(null, { status: 204 });
    return Response.json([]);
  };
  const source = new PostgrestSource({
    baseUrl: "https://data.example",
    userId: "u1",
    fetch: fetch as unknown as typeof globalThis.fetch,
    headers: {},
    pendingOutbox: async () => 0,
    signedUrl: async (bucket, path) => `https://dl.example/${bucket}/${path}`,
  });

  await source.listRows("logEntries");
  await source.listTrashed("logEntries");
  await source.countRows("logEntries");
  await source.pendingOutbox();
  await source.undecryptable("logEntries");
  await source.listBlobs();
  await source.fetchBlob({ bucket: "b", path: "p", sizeBytes: 1 });

  for (const method of methods) assert.ok(method === "GET" || method === "HEAD", `read sent ${method}`);

  assert.equal(methods.filter((m) => m === "POST").length, 0);
  await source.markExported097();
  assert.equal(methods.filter((m) => m === "POST").length, 1);
  assert.equal(methods.at(-1), "POST");
});
