import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddPaperUseCase,
  PaperValidationError,
  type Paper,
  type IPaperRepository,
} from "../src/index.js";

class InMemoryPaperRepo implements IPaperRepository {
  readonly rows = new Map<string, Paper>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(p: Paper) {
    this.rows.set(p.id, p);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async findByArxivId(arxivId: string) {
    return [...this.rows.values()].find((p) => p.arxivId === arxivId) ?? null;
  }
  async findByDoi(doi: string) {
    return [...this.rows.values()].find((p) => p.doi === doi) ?? null;
  }
}

function makeUseCase() {
  const repo = new InMemoryPaperRepo();
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
  assert.equal(repo.rows.size, 1);
});

test("addManual: dedupes by normalized DOI", async () => {
  const { repo, uc } = makeUseCase();
  const first = await uc.addManual({ title: "First", doi: "10.1000/xyz" });
  const again = await uc.addManual({ title: "Second", doi: "https://doi.org/10.1000/xyz" });
  assert.equal(again.id, first.id);
  assert.equal(repo.rows.size, 1);
});
