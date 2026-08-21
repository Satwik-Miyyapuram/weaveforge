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
import type { Clock, IdGenerator } from "../../../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

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
