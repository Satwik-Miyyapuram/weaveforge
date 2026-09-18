import { test } from "node:test";
import assert from "node:assert/strict";
import { MetadataResolver, type IMetadataSource, type PaperMetadata, type PaperRef, type ParsedReference } from "@weaveforge/core";
import { InMemoryPaperRepository } from "@weaveforge/core/testing";
import { ReferenceLookupService, type ReferenceLookupCache, type ResolvedReference } from "../reference-lookup";

const paper = (fields: Record<string, unknown> = {}) =>
  ({ title: "T", authors: [], status: "to_read", ...fields }) as never;

class FakeSource implements IMetadataSource {
  readonly id: string;
  readonly calls: string[] = [];
  constructor(id: string, private readonly respond: (ref: PaperRef) => PaperMetadata) {
    this.id = id;
  }
  supports(ref: PaperRef) { return ref.kind === "bibliographic" || ref.kind === "doi"; }
  async fetch(ref: PaperRef) {
    this.calls.push(ref.kind);
    return this.respond(ref);
  }
}

const ref = (fields: Partial<ParsedReference> = {}): ParsedReference =>
  ({ index: 1, raw: "raw", page: 3, authors: [], ...fields });

function makeService(overrides: { cache?: ReferenceLookupCache } = {}) {
  const first = new FakeSource("first", () => paper({ title: "First result" }));
  const second = new FakeSource("second", () => paper({ title: "Second result", doi: "10.1/fallback" }));
  const papers = new InMemoryPaperRepository();
  const service = new ReferenceLookupService(new MetadataResolver([first, second]), papers, overrides.cache);
  return { first, second, papers, service };
}

test("resolves through the first source that supports a bibliographic ref", async () => {
  const { first, second, service } = makeService();
  const result = await service.resolve("p1", ref({ title: "A paper" }));
  assert.equal(result.status, "resolved");
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0);
});

test("falls back to the next source when the first has no match", async () => {
  const failing = new FakeSource("first", () => { throw new Error("no match"); });
  const second = new FakeSource("second", () => paper({ title: "Second result" }));
  const service = new ReferenceLookupService(new MetadataResolver([failing, second]), new InMemoryPaperRepository());
  const result = await service.resolve("p1", ref({ title: "A paper" }));
  assert.equal(result.status, "resolved");
  assert.equal(result.sourceId, "second");
  assert.equal(failing.calls.length, 1);
});

test("reports unresolved when every source fails", async () => {
  const failing = new FakeSource("first", () => { throw new Error("no match"); });
  const service = new ReferenceLookupService(new MetadataResolver([failing]), new InMemoryPaperRepository());
  assert.equal((await service.resolve("p1", ref({ title: "Missing" }))).status, "unresolved");
});

test("caches per (documentKey, refIndex) and reports library presence", async () => {
  const store = new Map<string, ResolvedReference>();
  const seen: string[] = [];
  const cache: ReferenceLookupCache = {
    get: (key) => { seen.push(key); return store.get(key); },
    set: (key, value) => void store.set(key, value),
  };
  const papers = new InMemoryPaperRepository();
  await papers.save(paper({ id: "lib-1", doi: "10.1/fallback" }));
  const service = new ReferenceLookupService(
    { resolveWithSource: async () => ({ metadata: paper({ title: "T", doi: "10.1/fallback" }), sourceId: "fake" }) },
    papers,
    cache,
  );
  const first = await service.resolve("p1", ref({ index: 7, title: "T", doi: "10.1/fallback" }));
  await service.resolve("p1", ref({ index: 7, title: "T", doi: "10.1/fallback" }));
  assert.deepEqual(seen, ["v3:p1:ref:7"]);
  assert.equal(first.status, "resolved");
  assert.equal(first.inLibrary?.id, "lib-1");
});
