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
  ({ index: 1, raw: "raw", page: 3, x: 40, y: 600, authors: [], ...fields });

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
  assert.deepEqual(seen, ["v5:p1:ref:7"]);
  assert.equal(first.status, "resolved");
  assert.equal(first.inLibrary?.id, "lib-1");
});

test("a reference with no DOI or arXiv id is in the library when its title is", async () => {
  // The add step dedupes id-less papers by title; the popover must agree, or
  // it offers "Add to library" for a paper the add step says is already there.
  const papers = new InMemoryPaperRepository();
  await papers.save(paper({ id: "lib-2", title: "Understanding the difficulty of training deep feedforward neural networks" }));
  const service = new ReferenceLookupService(
    { resolveWithSource: async () => ({ metadata: paper({ title: "Understanding the Difficulty of Training Deep Feedforward Neural Networks." }), sourceId: "fake" }) },
    papers,
  );
  const result = await service.resolve("p1", ref({ title: "Understanding the difficulty" }));
  assert.equal(result.status === "resolved" && result.inLibrary?.id, "lib-2");
});

test("a reference with a DOI is not matched by title alone", async () => {
  // Two editions share a title but not a DOI; the add step keeps them apart.
  const papers = new InMemoryPaperRepository();
  await papers.save(paper({ id: "lib-3", title: "Understanding the difficulty of training deep feedforward neural networks" }));
  const service = new ReferenceLookupService(
    { resolveWithSource: async () => ({ metadata: paper({ title: "Understanding the difficulty of training deep feedforward neural networks", doi: "10.9/other" }), sourceId: "fake" }) },
    papers,
  );
  const result = await service.resolve("p1", ref({ title: "x" }));
  assert.equal(result.status === "resolved" && result.inLibrary, undefined);
});

test("a miss is not written to the disk cache, so a later session retries it", async () => {
  // A miss may be a dropped connection or a title the parser has since learned
  // to read; caching it for 30 days kept the entry unresolved after both.
  const store = new Map<string, ResolvedReference>();
  const cache: ReferenceLookupCache = { get: (key) => store.get(key), set: (key, value) => void store.set(key, value) };
  const failing = new FakeSource("first", () => { throw new Error("offline"); });
  const service = new ReferenceLookupService(new MetadataResolver([failing]), new InMemoryPaperRepository(), cache);
  assert.equal((await service.resolve("p1", ref({ title: "Missing" }))).status, "unresolved");
  assert.equal(store.size, 0);
});
