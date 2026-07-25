import assert from "node:assert/strict";
import test from "node:test";
import type { Paper } from "@thesis/core";
import { ZoteroExporter } from "../infrastructure/zotero-exporter";

const paper: Paper = { id: "paper-1", title: "Direct browser write", authors: ["Ada Lovelace"], status: "to_read", tags: [], metadata: {}, createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z" };

test("ZoteroExporter writes directly to Zotero without a Thesis Tracker proxy", async () => {
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
