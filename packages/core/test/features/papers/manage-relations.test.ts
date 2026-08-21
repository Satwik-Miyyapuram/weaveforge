import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddRelationUseCase,
  RemoveRelationUseCase,
  LinkCitationsUseCase,
  PaperRelationValidationError,
  type Paper,
  type PaperRelation,
  type IPaperRelationRepository,
  type ICitationSource,
} from "../../../src/index.js";
import type { PaperRef } from "../../../src/features/papers/application/metadata-source.js";

class InMemoryRelationRepo implements IPaperRelationRepository {
  readonly rows = new Map<string, PaperRelation>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(r: PaperRelation) {
    this.rows.set(r.id, r);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async getGraph() {
    return [...this.rows.values()];
  }
  async relationsFor(paperId: string) {
    return [...this.rows.values()].filter((r) => r.fromPaper === paperId || r.toPaper === paperId);
  }
  async findEdge(fromPaper: string, toPaper: string, relation: string) {
    return (
      [...this.rows.values()].find(
        (r) => r.fromPaper === fromPaper && r.toPaper === toPaper && r.relation === relation,
      ) ?? null
    );
  }
}

function makeAdd() {
  const repo = new InMemoryRelationRepo();
  let n = 0;
  const uc = new AddRelationUseCase({
    repository: repo,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `rel-${++n}` },
  });
  return { repo, uc };
}

test("AddRelation: creates a typed edge and defaults source to manual", async () => {
  const { uc } = makeAdd();
  const edge = await uc.add({ fromPaper: "a", toPaper: "b", relation: "cites" });
  assert.equal(edge.fromPaper, "a");
  assert.equal(edge.toPaper, "b");
  assert.equal(edge.relation, "cites");
  assert.equal(edge.source, "manual");
});

test("AddRelation: rejects self-edges, missing endpoints, unknown types", async () => {
  const { uc } = makeAdd();
  await assert.rejects(uc.add({ fromPaper: "a", toPaper: "a", relation: "cites" }), /cannot relate to itself/);
  await assert.rejects(uc.add({ fromPaper: "", toPaper: "b", relation: "cites" }), PaperRelationValidationError);
  await assert.rejects(uc.add({ fromPaper: "a", toPaper: "b", relation: "bogus" as never }), /Unknown relation/);
});

test("AddRelation: dedupes an identical directed, typed edge", async () => {
  const { repo, uc } = makeAdd();
  const first = await uc.add({ fromPaper: "a", toPaper: "b", relation: "cites" });
  const again = await uc.add({ fromPaper: "a", toPaper: "b", relation: "cites" });
  assert.equal(again.id, first.id);
  assert.equal(repo.rows.size, 1);
});

test("RemoveRelation: deletes by id", async () => {
  const { repo, uc } = makeAdd();
  const edge = await uc.add({ fromPaper: "a", toPaper: "b", relation: "cites" });
  await new RemoveRelationUseCase(repo).execute(edge.id);
  assert.equal(repo.rows.size, 0);
});

// --- LinkCitations -------------------------------------------------------

const paper = (over: Partial<Paper> & { id: string }): Paper =>
  ({
    id: over.id,
    title: over.id,
    authors: [],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as Paper;

class FakePapers {
  constructor(private readonly all: Paper[]) {}
  async findByArxivId(v: string) {
    return this.all.find((p) => p.arxivId === v) ?? null;
  }
  async findByDoi(v: string) {
    return this.all.find((p) => p.doi === v) ?? null;
  }
  async getById() {
    return null;
  }
  async list() {
    return this.all;
  }
  async save() {}
  async delete() {}
}

class FakeSource implements ICitationSource {
  readonly id = "fake";
  constructor(private readonly refs: PaperRef[]) {}
  supports(ref: PaperRef) {
    return ref.kind === "arxiv" || ref.kind === "doi";
  }
  async references() {
    return this.refs;
  }
}

test("LinkCitations.forPaper: creates cites edges to matched local papers, counts unmatched", async () => {
  const src = paper({ id: "src", arxivId: "2000.0001" });
  const target = paper({ id: "tgt", arxivId: "2000.0002" });
  const papers = new FakePapers([src, target]) as unknown as ConstructorParameters<typeof LinkCitationsUseCase>[1];
  const repo = new InMemoryRelationRepo();
  let n = 0;
  const add = new AddRelationUseCase({ repository: repo, clock: { nowIso: () => "t" }, ids: { newId: () => `rel-${++n}` } });
  const source = new FakeSource([
    { kind: "arxiv", value: "2000.0002" }, // matches target
    { kind: "arxiv", value: "9999.9999" }, // no local match
  ]);
  const uc = new LinkCitationsUseCase([source], papers, repo, add);

  const result = await uc.forPaper(src);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].toPaper, "tgt");
  assert.equal(result.created[0].relation, "cites");
  assert.equal(result.unmatched, 1);

  // Idempotent: a re-run creates no new edges.
  const again = await uc.forPaper(src);
  assert.equal(again.created.length, 0);
  assert.equal(repo.rows.size, 1);
});
