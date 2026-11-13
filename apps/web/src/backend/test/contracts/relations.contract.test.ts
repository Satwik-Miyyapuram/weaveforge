// contract-repos: paper_relations, citation_alert_tracks
import assert from "node:assert/strict";
import test from "node:test";
import type {
  ICitationAlertTrackRepository,
  IPaperRelationRepository,
  PaperRelation,
  Paper,
} from "@weaveforge/core";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, sessionFor, type Db } from "./harness";

/**
 * The `IPaperRelationRepository` and `ICitationAlertTrackRepository` contracts,
 * end to end: Rust plans each query, the TS sender runs it against PGlite with
 * the real `paper_relations` / `citation_alert_tracks` migrations and RLS.
 * Ported from the deleted `paper-relation-repository-contract.ts` and
 * `citation-alert-track-repository-contract.ts` suites.
 */

async function setup(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const client = clientFor(db, userId);
  const project = projectFor(projectId);
  return {
    papers: rustPaperRepository(client, project),
    edges: rustRepository<IPaperRelationRepository>(
      client,
      "paper_relations",
      ["getById", "list", "getGraph", "relationsFor", "findEdge", "save", "delete"],
      projectUserCtx(project),
    ),
    tracks: rustRepository<ICitationAlertTrackRepository>(
      client,
      "citation_alert_tracks",
      ["track", "untrack", "listForProject", "getByPaperId", "save"],
      projectUserCtx(project, sessionFor(userId)),
    ),
  };
}

type Repos = Awaited<ReturnType<typeof setup>>;

function samplePaper(overrides: Partial<Paper> = {}): Paper {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    title: "Auto-Encoding Variational Bayes",
    authors: ["Kingma", "Welling"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seedPaper(r: Repos): Promise<string> {
  const paper = samplePaper();
  await r.papers.save(paper);
  return paper.id;
}

function sampleEdge(overrides: Partial<PaperRelation> = {}): PaperRelation {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    fromPaper: overrides.fromPaper!,
    toPaper: overrides.toPaper!,
    relation: overrides.relation ?? "cites",
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
    note: overrides.note,
    ...overrides,
  };
}

test("save then getById returns the entity", async () => {
  const r = await setup(await testDb());
  const edge = sampleEdge({ fromPaper: await seedPaper(r), toPaper: await seedPaper(r) });
  await r.edges.save(edge);
  assert.equal((await r.edges.getById(edge.id))?.relation, "cites");
});

test("findEdge matches the directed, typed edge", async () => {
  const r = await setup(await testDb());
  const a = await seedPaper(r);
  const b = await seedPaper(r);
  const edge = sampleEdge({ fromPaper: a, toPaper: b, relation: "cites" });
  await r.edges.save(edge);
  assert.equal((await r.edges.findEdge(a, b, "cites"))?.id, edge.id);
  assert.equal(await r.edges.findEdge(b, a, "cites"), null); // direction matters
  assert.equal(await r.edges.findEdge(a, b, "extends"), null); // type matters
});

test("getGraph returns every edge", async () => {
  const r = await setup(await testDb());
  const p1 = await seedPaper(r);
  const p2 = await seedPaper(r);
  const p3 = await seedPaper(r);
  await r.edges.save(sampleEdge({ fromPaper: p1, toPaper: p2 }));
  await r.edges.save(sampleEdge({ fromPaper: p3, toPaper: p2, relation: "extends" }));
  assert.equal((await r.edges.getGraph()).length, 2);
});

test("relationsFor returns edges in both directions", async () => {
  const r = await setup(await testDb());
  const x = await seedPaper(r);
  const y = await seedPaper(r);
  const z = await seedPaper(r);
  const m = await seedPaper(r);
  const n = await seedPaper(r);
  const out = sampleEdge({ fromPaper: x, toPaper: y });
  const inbound = sampleEdge({ fromPaper: z, toPaper: x, relation: "extends" });
  const other = sampleEdge({ fromPaper: m, toPaper: n, relation: "similar" });
  await r.edges.save(out);
  await r.edges.save(inbound);
  await r.edges.save(other);
  const touching = await r.edges.relationsFor(x);
  assert.deepEqual(touching.map((e) => e.id).sort(), [inbound.id, out.id].sort());
});

test("list filters by relation type", async () => {
  const r = await setup(await testDb());
  const p1 = await seedPaper(r);
  const p2 = await seedPaper(r);
  const q = await seedPaper(r);
  const cites = sampleEdge({ fromPaper: p1, toPaper: p2, relation: "cites" });
  await r.edges.save(cites);
  await r.edges.save(sampleEdge({ fromPaper: q, toPaper: p2, relation: "contradicts" }));
  const found = await r.edges.list({ relation: "cites" });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.id, cites.id);
});

test("delete removes the edge", async () => {
  const r = await setup(await testDb());
  const edge = sampleEdge({ fromPaper: await seedPaper(r), toPaper: await seedPaper(r) });
  await r.edges.save(edge);
  await r.edges.delete(edge.id);
  assert.equal(await r.edges.getById(edge.id), null);
});

test("track then getByPaperId round-trips", async () => {
  const r = await setup(await testDb());
  const paperId = await seedPaper(r);
  const track = await r.tracks.track({
    paperId,
    seenCitingIds: ["s2-a"],
    lastCheckedAt: "2026-07-01T00:00:00.000Z",
  });
  assert.equal(track.paperId, paperId);
  assert.deepEqual((await r.tracks.getByPaperId(paperId))?.seenCitingIds, ["s2-a"]);
});

test("track is idempotent on paperId", async () => {
  const r = await setup(await testDb());
  const paperId = await seedPaper(r);
  const first = await r.tracks.track({ paperId, seenCitingIds: ["a"] });
  const second = await r.tracks.track({ paperId, seenCitingIds: ["a", "b"] });
  assert.equal(first.id, second.id);
  assert.deepEqual(second.seenCitingIds, ["a", "b"]);
  assert.equal((await r.tracks.listForProject()).length, 1);
});

test("untrack removes the row", async () => {
  const r = await setup(await testDb());
  const paperId = await seedPaper(r);
  await r.tracks.track({ paperId });
  await r.tracks.untrack(paperId);
  assert.equal(await r.tracks.getByPaperId(paperId), null);
});

test("save updates lastCheckedAt and seen ids", async () => {
  const r = await setup(await testDb());
  const paperId = await seedPaper(r);
  const track = await r.tracks.track({ paperId, seenCitingIds: [] });
  await r.tracks.save({
    ...track,
    lastCheckedAt: "2026-07-02T00:00:00.000Z",
    seenCitingIds: ["new"],
  });
  const saved = await r.tracks.getByPaperId(paperId);
  assert.equal(saved?.lastCheckedAt, "2026-07-02T00:00:00.000Z");
  assert.deepEqual(saved?.seenCitingIds, ["new"]);
});
