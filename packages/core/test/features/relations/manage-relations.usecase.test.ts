import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperRelationRepository } from "../../../src/testing/in-memory-paper-relation-repository.js";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";
import {
  AddRelationUseCase,
  LinkCitationsUseCase,
} from "../../../src/features/relations/application/manage-relations.use-case.js";
import type { ICitationSource } from "../../../src/features/relations/application/citation-source.js";
import type { PaperRef } from "../../../src/features/papers/application/metadata-source.js";
import { createPaper } from "../../../src/features/papers/domain/paper.js";
import { fixedClock, seqIds } from "../../../src/testing/fakes.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");

test("AddRelationUseCase rejects self-edges", async () => {
  const repo = new InMemoryPaperRelationRepository();
  const uc = new AddRelationUseCase({ repository: repo, clock, ids: seqIds() });
  await assert.rejects(() =>
    uc.add({ fromPaper: "p1", toPaper: "p1", relation: "cites" }),
  );
});

test("AddRelationUseCase dedupes identical directed/typed edges", async () => {
  const repo = new InMemoryPaperRelationRepository();
  const uc = new AddRelationUseCase({ repository: repo, clock, ids: seqIds() });
  const first = await uc.add({ fromPaper: "a", toPaper: "b", relation: "cites" });
  const second = await uc.add({ fromPaper: "a", toPaper: "b", relation: "cites" });
  assert.equal(second.id, first.id);
  assert.equal((await repo.getGraph()).length, 1);
});

// A fake citation source returns fixed references without network.
class FakeCitationSource implements ICitationSource {
  readonly id = "fake";
  constructor(private readonly refs: PaperRef[]) {}
  supports(ref: PaperRef) {
    return ref.kind === "arxiv";
  }
  async references(): Promise<PaperRef[]> {
    return this.refs;
  }
}

test("LinkCitationsUseCase creates cites edges only for local matches", async () => {
  const papers = new InMemoryPaperRepository();
  const ids = seqIds();
  // The citing paper, plus one cited paper that exists locally.
  const citing = createPaper({ title: "Citing", arxivId: "2300.0001" }, { clock, ids });
  const citedLocal = createPaper({ title: "Cited", arxivId: "1312.6114" }, { clock, ids });
  await papers.save(citing);
  await papers.save(citedLocal);

  const relations = new InMemoryPaperRelationRepository();
  const add = new AddRelationUseCase({ repository: relations, clock, ids });
  const source = new FakeCitationSource([
    { kind: "arxiv", value: "1312.6114" }, // matches citedLocal
    { kind: "arxiv", value: "9999.9999" }, // no local paper
  ]);
  const link = new LinkCitationsUseCase([source], papers, relations, add);

  const result = await link.forPaper(citing);
  assert.equal(result.created.length, 1);
  assert.equal(result.unmatched, 1);
  const edge = (await relations.getGraph())[0];
  assert.equal(edge?.fromPaper, citing.id);
  assert.equal(edge?.toPaper, citedLocal.id);
  assert.equal(edge?.relation, "cites");
  assert.equal(edge?.source, "auto");

  // Re-running must not re-report already-present edges.
  const again = await link.forPaper(citing);
  assert.equal(again.created.length, 0);
  assert.equal((await relations.getGraph()).length, 1);
});

test("LinkCitationsUseCase no-ops for a paper without arxiv/doi", async () => {
  const papers = new InMemoryPaperRepository();
  const ids = seqIds();
  const bare = createPaper({ title: "No ids" }, { clock, ids });
  const relations = new InMemoryPaperRelationRepository();
  const add = new AddRelationUseCase({ repository: relations, clock, ids });
  const link = new LinkCitationsUseCase(
    [new FakeCitationSource([{ kind: "arxiv", value: "1312.6114" }])],
    papers,
    relations,
    add,
  );
  const result = await link.forPaper(bare);
  assert.equal(result.created.length, 0);
  assert.equal(result.unmatched, 0);
});

/** Counts edge lookups so a test can see how many queries a link run makes. */
class CountingRelations extends InMemoryPaperRelationRepository {
  findEdgeCalls = 0;
  override async findEdge(...args: Parameters<InMemoryPaperRelationRepository["findEdge"]>) {
    this.findEdgeCalls += 1;
    return super.findEdge(...args);
  }
}

test("forPaper: one edge lookup per new edge, none for edges already present (04-23)", async () => {
  const papers = new InMemoryPaperRepository();
  const ids = seqIds();
  const citing = createPaper({ title: "Citing", arxivId: "2300.0001" }, { clock, ids });
  const x = createPaper({ title: "X", arxivId: "2300.0002" }, { clock, ids });
  const y = createPaper({ title: "Y", doi: "10.1/Y" }, { clock, ids });
  for (const p of [citing, x, y]) await papers.save(p);
  const relations = new CountingRelations();
  const add = new AddRelationUseCase({ repository: relations, clock, ids });
  // An edge the other way must not count as already linked.
  await add.add({ fromPaper: x.id, toPaper: citing.id, relation: "cites", source: "auto" });
  relations.findEdgeCalls = 0;
  const source = new FakeCitationSource([
    { kind: "arxiv", value: "2300.0002" },
    { kind: "doi", value: "10.1/y" },
    { kind: "arxiv", value: "2300.0002" }, // listed twice by the source
    { kind: "arxiv", value: "2300.0001" }, // cites itself
  ]);
  const link = new LinkCitationsUseCase([source], papers, relations, add);

  const first = await link.forPaper(citing);
  assert.deepEqual(first.created.map((e) => e.toPaper), [x.id, y.id]);
  assert.equal(first.unmatched, 1);
  assert.equal(relations.findEdgeCalls, 2, "only add()'s own check");

  relations.findEdgeCalls = 0;
  const again = await link.forPaper(citing);
  assert.equal(again.created.length, 0);
  assert.equal(relations.findEdgeCalls, 0);
  assert.equal((await relations.getGraph()).length, 3);
});

async function threePapers() {
  const papers = new InMemoryPaperRepository();
  const ids = seqIds();
  const a = createPaper({ title: "A", arxivId: "2301.0001" }, { clock, ids });
  const b = createPaper({ title: "B", arxivId: "2301.0002" }, { clock, ids });
  const c = createPaper({ title: "C", arxivId: "2301.0003" }, { clock, ids });
  for (const p of [a, b, c]) await papers.save(p);
  const relations = new InMemoryPaperRelationRepository();
  const add = new AddRelationUseCase({ repository: relations, clock, ids });
  return { papers, relations, add, a, b, c };
}

test("forAll: one paper's reference fetch throwing still links the others (04-24)", async () => {
  const { papers, relations, add, a, b, c } = await threePapers();
  const source: ICitationSource = {
    id: "fake",
    supports: (ref) => ref.kind === "arxiv",
    async references(ref) {
      if (ref.value === a.arxivId) throw new Error("S2 429");
      return [{ kind: "arxiv", value: c.arxivId! }];
    },
  };
  const link = new LinkCitationsUseCase([source], papers, relations, add);
  const result = await link.forAll([a, b, c]);
  assert.deepEqual(
    result.created.map((e) => [e.fromPaper, e.toPaper]),
    [[b.id, c.id]],
  );
  assert.equal(result.failed, 1);
});

test("forAll: one paper's edge write throwing still links the others (04-24)", async () => {
  const { papers, relations, add, a, b, c } = await threePapers();
  const realAdd = add.add.bind(add);
  add.add = async (input) => {
    if (input.fromPaper === a.id) throw new Error("write failed");
    return realAdd(input);
  };
  const link = new LinkCitationsUseCase(
    [new FakeCitationSource([{ kind: "arxiv", value: c.arxivId! }])],
    papers,
    relations,
    add,
  );
  const result = await link.forAll([a, b, c]);
  assert.deepEqual(
    result.created.map((e) => [e.fromPaper, e.toPaper]),
    [[b.id, c.id]],
  );
  assert.equal(result.failed, 1);
});
