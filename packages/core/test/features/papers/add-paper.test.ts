import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddPaperUseCase,
  PaperValidationError,
} from "../../../src/index.js";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";

function makeUseCase() {
  const repo = new InMemoryPaperRepository();
  let n = 0;
  const uc = new AddPaperUseCase({
    repository: repo,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `paper-${++n}` },
  });
  return { repo, uc };
}

test("addManual: creates a paper with defaults and requires a title", async () => {
  const { uc } = makeUseCase();
  const paper = await uc.addManual({ title: "  Deep Nets  ", authors: ["A"] });
  assert.equal(paper.title, "Deep Nets");
  assert.equal(paper.status, "to_read");
  assert.deepEqual(paper.authors, ["A"]);
  await assert.rejects(uc.addManual({ title: " " }), PaperValidationError);
});

test("addManual: rejects an out-of-range rating", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(uc.addManual({ title: "x", rating: 6 }), /Rating must be between 1 and 5/);
});

test("addManual: dedupes by arXiv id, returning the existing paper", async () => {
  const { repo, uc } = makeUseCase();
  const first = await uc.addManual({ title: "First", arxivId: "1706.03762" });
  const again = await uc.addManual({ title: "Different title", arxivId: "1706.03762" });
  assert.equal(again.id, first.id);
  assert.equal((await repo.list()).length, 1);
});

test("addManual: dedupes by normalized DOI", async () => {
  const { repo, uc } = makeUseCase();
  const first = await uc.addManual({ title: "First", doi: "10.1000/xyz" });
  const again = await uc.addManual({ title: "Second", doi: "https://doi.org/10.1000/xyz" });
  assert.equal(again.id, first.id);
  assert.equal((await repo.list()).length, 1);
});

test("a paper with no id is matched by title through the narrow lookup, not by loading the library", async () => {
  const { repo, uc } = makeUseCase();
  const first = await uc.addManual({ title: "Attention Is All You Need" });
  repo.listSummaries = async () => {
    throw new Error("title dedupe must not load every paper");
  };

  const again = await uc.addManual({ title: "  attention is all you NEED. " });

  assert.equal(again.id, first.id);
  assert.equal((await repo.list()).length, 1);
});
