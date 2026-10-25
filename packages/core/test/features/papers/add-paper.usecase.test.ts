import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";
import {
  AddPaperUseCase,
  ImportPaperUseCase,
} from "../../../src/features/papers/application/add-paper.use-case.js";
import {
  MetadataResolutionError,
  MetadataResolver,
  type IMetadataSource,
  type PaperRef,
} from "../../../src/features/papers/application/metadata-source.js";
import { fixedClock, seqIds } from "../../../src/testing/fakes.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");

test("addManual persists a new paper", async () => {
  const repo = new InMemoryPaperRepository();
  const uc = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const p = await uc.addManual({ title: "Latent ODEs" });
  assert.equal((await repo.getById(p.id))?.title, "Latent ODEs");
});

test("addManual dedupes by arxivId (returns existing, no duplicate)", async () => {
  const repo = new InMemoryPaperRepository();
  const uc = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const first = await uc.addManual({ title: "VAE", arxivId: "1312.6114" });
  const second = await uc.addManual({ title: "VAE dup", arxivId: "1312.6114" });
  assert.equal(second.id, first.id);
  assert.equal((await repo.list()).length, 1);
});

test("addManual dedupes by DOI regardless of url form / case", async () => {
  const repo = new InMemoryPaperRepository();
  const uc = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const first = await uc.addManual({ title: "Paper", doi: "10.1/AbC" });
  const second = await uc.addManual({
    title: "Paper again",
    doi: "https://doi.org/10.1/abc",
  });
  assert.equal(second.id, first.id);
});

// A fake metadata source proves the resolver/use-case wiring without network.
class FakeArxivSource implements IMetadataSource {
  readonly id = "arxiv";
  supports(ref: PaperRef) {
    return ref.kind === "arxiv";
  }
  async fetch(ref: PaperRef) {
    return { title: `Fetched ${ref.value}`, authors: ["Author A"] };
  }
}

test("ImportPaperUseCase resolves metadata and records the source id", async () => {
  const repo = new InMemoryPaperRepository();
  const add = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const resolver = new MetadataResolver([new FakeArxivSource()]);
  const importer = new ImportPaperUseCase(resolver, add);

  const p = await importer.fromRef({ kind: "arxiv", value: "2305.12345" });
  assert.equal(p.title, "Fetched 2305.12345");
  assert.equal(p.arxivId, "2305.12345"); // recorded for future dedupe
});

test("MetadataResolver throws when no source supports the ref", async () => {
  const resolver = new MetadataResolver([new FakeArxivSource()]);
  await assert.rejects(() => resolver.resolve({ kind: "doi", value: "10.1/x" }));
});

test("addManual treats an id-less paper with the same long title as a duplicate", async () => {
  const repo = new InMemoryPaperRepository();
  const uc = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const first = await uc.addManual({ title: "Attention Is All You Need: Transformers" });
  const second = await uc.addManual({ title: "attention is all you need — transformers.pdf" });
  assert.equal(second.id, first.id);
  assert.equal((await repo.list()).length, 1);
});

test("addManual never title-matches a paper that brings its own id, or a short title", async () => {
  const repo = new InMemoryPaperRepository();
  const uc = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  await uc.addManual({ title: "Attention Is All You Need: Transformers" });
  await uc.addManual({ title: "Attention Is All You Need: Transformers", doi: "10.1/xyz" });
  await uc.addManual({ title: "Notes" });
  await uc.addManual({ title: "Notes" });
  assert.equal((await repo.list()).length, 4);
});

test("add says whether it created the paper or found it already there", async () => {
  const repo = new InMemoryPaperRepository();
  const uc = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const first = await uc.add({ title: "VAE", arxivId: "1312.6114" });
  const again = await uc.add({ title: "VAE", arxivId: "1312.6114" });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.paper.id, first.paper.id);
});

test("importRef reports an import that matched a paper the library already had", async () => {
  const repo = new InMemoryPaperRepository();
  const add = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const importer = new ImportPaperUseCase(new MetadataResolver([new FakeArxivSource()]), add);
  const first = await importer.importRef({ kind: "arxiv", value: "1406.2661" });
  const again = await importer.importRef({ kind: "arxiv", value: "1406.2661" });
  assert.deepEqual([first.created, again.created], [true, false]);
});

// 03-07: the cascade used to drop each provider's error, so an outage read as
// "not found".
function down(id: string, message: string): IMetadataSource {
  return { id, supports: () => true, fetch: async () => { throw new Error(message); } };
}

test("a failed cascade keeps every provider's error", async () => {
  const resolver = new MetadataResolver([down("s2", "503 Service Unavailable"), down("crossref", "fetch failed")]);
  const ref: PaperRef = { kind: "bibliographic", value: "Attention is all you need" };
  await assert.rejects(resolver.resolve(ref), (err: unknown) => {
    assert.ok(err instanceof MetadataResolutionError);
    assert.deepEqual(err.failures, [
      { sourceId: "s2", message: "503 Service Unavailable" },
      { sourceId: "crossref", message: "fetch failed" },
    ]);
    assert.match(err.message, /s2: 503 Service Unavailable/);
    assert.match(err.message, /crossref: fetch failed/);
    return true;
  });
});

test("a cascaded identifier keeps errors too, and a non-Error throw still reads", async () => {
  const odd: IMetadataSource = { id: "odd", supports: () => true, fetch: async () => { throw "timeout"; } };
  const resolver = new MetadataResolver([odd, down("crossref", "404")], true);
  await assert.rejects(resolver.resolve({ kind: "doi", value: "10.1/x" }), (err: unknown) => {
    assert.ok(err instanceof MetadataResolutionError);
    assert.deepEqual(err.failures.map((f) => f.sourceId), ["odd", "crossref"]);
    assert.equal(err.failures[0]!.message, "timeout");
    return true;
  });
});

test("a later provider that answers hides the earlier errors", async () => {
  const ok: IMetadataSource = { id: "crossref", supports: () => true, fetch: async () => ({ title: "Found" }) as never };
  const resolver = new MetadataResolver([down("s2", "503"), ok]);
  const { sourceId } = await resolver.resolveWithSource({ kind: "bibliographic", value: "x" });
  assert.equal(sourceId, "crossref");
});

test("no supporting source is an error with no provider failures", async () => {
  const resolver = new MetadataResolver([]);
  await assert.rejects(resolver.resolve({ kind: "doi", value: "10.1/x" }), (err: unknown) => {
    assert.ok(err instanceof MetadataResolutionError);
    assert.deepEqual(err.failures, []);
    return true;
  });
});
