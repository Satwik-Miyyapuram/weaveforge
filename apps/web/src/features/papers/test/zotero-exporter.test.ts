import assert from "node:assert/strict";
import test from "node:test";
import type { Paper } from "@weaveforge/core";
import { ZoteroExporter } from "../infrastructure/zotero-exporter";

const paper: Paper = { id: "paper-1", title: "Direct browser write", authors: ["Ada Lovelace"], status: "to_read", tags: [], metadata: {}, createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z" };

test("ZoteroExporter writes directly to Zotero without a WeaveForge proxy", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const exporter = new ZoteroExporter(
    async () => ({ apiKey: "secret", library: "users/42" }),
    async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ successful: { 0: { key: "ZOTERO01" } } }), { status: 200 });
    },
  );
  assert.equal(await exporter.save(paper), "ZOTERO01");
  assert.equal(request?.url, "https://api.zotero.org/users/42/items");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("Zotero-API-Key"), "secret");
  assert.equal(headers.get("X-Zotero-Key"), null);
  assert.ok(headers.get("Zotero-Write-Token"));
});

function removeHarness(deleteStatuses: number[], versions = ["7", "9"]) {
  const calls: { method: string; ifVersion: string | null }[] = [];
  let reads = 0;
  let deletes = 0;
  const exporter = new ZoteroExporter(
    async () => ({ apiKey: "secret", library: "users/42" }),
    async (_url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, ifVersion: new Headers(init?.headers).get("If-Unmodified-Since-Version") });
      if (method === "GET") {
        return new Response("{}", { status: 200, headers: { "Last-Modified-Version": versions[reads++] ?? "0" } });
      }
      return new Response(null, { status: deleteStatuses[deletes++] ?? 204 });
    },
  );
  return { exporter, calls };
}

test("ZoteroExporter.remove sends the item's version so Zotero accepts the delete", async () => {
  const { exporter, calls } = removeHarness([204]);
  await exporter.remove("ZOTERO01");
  assert.deepEqual(calls, [
    { method: "GET", ifVersion: null },
    { method: "DELETE", ifVersion: "7" },
  ]);
});

test("ZoteroExporter.remove rereads the version once when the item changed underneath it", async () => {
  const { exporter, calls } = removeHarness([412, 204]);
  await exporter.remove("ZOTERO01");
  assert.deepEqual(calls.map((c) => `${c.method}:${c.ifVersion ?? ""}`), ["GET:", "DELETE:7", "GET:", "DELETE:9"]);
});

test("ZoteroExporter.remove does not report a twice-refused delete as done", async () => {
  const { exporter } = removeHarness([412, 412]);
  await assert.rejects(exporter.remove("ZOTERO01"), /412/);
});

test("ZoteroExporter.remove treats an item already gone as removed", async () => {
  const exporter = new ZoteroExporter(
    async () => ({ apiKey: "secret", library: "users/42" }),
    async () => new Response(null, { status: 404 }),
  );
  await exporter.remove("GONE0001");
});
