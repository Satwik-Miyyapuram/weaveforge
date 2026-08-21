import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";
import {
  AddPaperUseCase,
  ImportPaperUseCase,
} from "../../../src/features/papers/application/add-paper.use-case.js";
import {
  MetadataResolver,
  type IMetadataSource,
  type PaperRef,
} from "../../../src/features/papers/application/metadata-source.js";
import type { Clock, IdGenerator } from "../../../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

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
