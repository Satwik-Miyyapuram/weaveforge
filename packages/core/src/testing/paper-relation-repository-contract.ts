/**
 * Shared CONTRACT test suite for IPaperRelationRepository.
 *
 * Every implementation (in-memory, Supabase, SQLite) must pass this — the basis
 * for Liskov substitutability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaperRelation } from "../features/relations/domain/paper-relation.js";
import type { IPaperRelationRepository } from "../features/relations/domain/paper-relation-repository.js";

function sampleEdge(overrides: Partial<PaperRelation> = {}): PaperRelation {
  return {
    id: overrides.id ?? "e1",
    fromPaper: overrides.fromPaper ?? "p1",
    toPaper: overrides.toPaper ?? "p2",
    relation: overrides.relation ?? "cites",
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
    note: overrides.note,
    ...overrides,
  };
}

export function runPaperRelationRepositoryContract(
  label: string,
  makeRepo: () => IPaperRelationRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEdge());
    assert.equal((await repo.getById("e1"))?.relation, "cites");
  });

  test(`[${label}] findEdge matches the directed, typed edge`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEdge({ id: "e1", fromPaper: "a", toPaper: "b", relation: "cites" }));
    assert.equal((await repo.findEdge("a", "b", "cites"))?.id, "e1");
    assert.equal(await repo.findEdge("b", "a", "cites"), null); // direction matters
    assert.equal(await repo.findEdge("a", "b", "extends"), null); // type matters
  });

  test(`[${label}] getGraph returns every edge`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEdge({ id: "e1" }));
    await repo.save(sampleEdge({ id: "e2", fromPaper: "p3", relation: "extends" }));
    assert.equal((await repo.getGraph()).length, 2);
  });

  test(`[${label}] relationsFor returns edges in both directions`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEdge({ id: "out", fromPaper: "x", toPaper: "y" }));
    await repo.save(sampleEdge({ id: "in", fromPaper: "z", toPaper: "x", relation: "extends" }));
    await repo.save(sampleEdge({ id: "other", fromPaper: "m", toPaper: "n", relation: "similar" }));
    const touching = await repo.relationsFor("x");
    assert.deepEqual(touching.map((r) => r.id).sort(), ["in", "out"]);
  });

  test(`[${label}] list filters by relation type`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEdge({ id: "e1", relation: "cites" }));
    await repo.save(sampleEdge({ id: "e2", fromPaper: "q", relation: "contradicts" }));
    const cites = await repo.list({ relation: "cites" });
    assert.equal(cites.length, 1);
    assert.equal(cites[0]?.id, "e1");
  });

  test(`[${label}] delete removes the edge`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEdge());
    await repo.delete("e1");
    assert.equal(await repo.getById("e1"), null);
  });
}
