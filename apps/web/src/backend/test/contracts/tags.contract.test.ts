// contract-repos: tags, paper_tags
import assert from "node:assert/strict";
import test from "node:test";
import type { IPaperTagRepository, ITagManager, ITagRepository, Paper } from "@weaveforge/core";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `ITagRepository` and `IPaperTagRepository` contract, end to end: Rust
 * plans each query, the TS sender runs it against PGlite with the real
 * migrations and RLS. Ported from the deleted `tag-repository-contract.ts` and
 * `paper-tag-repository-contract.ts` suites.
 */

type Tag = Parameters<ITagRepository["save"]>[0];
type PaperTagLink = Parameters<IPaperTagRepository["link"]>[0];

async function reposFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const client = clientFor(db, userId);
  const ctx = projectFor(projectId);
  const tags = rustRepository<ITagRepository & ITagManager>(
    client,
    "tags",
    [
      "getById",
      "findByName",
      "list",
      "listAll",
      "listWithCounts",
      "listForPaper",
      "listPapersForTag",
      "listPaperTagLinks",
      "save",
      "delete",
      "setManualTags",
      "mergeTags",
      "removeManualTag",
      "reconcileSources",
      "mergeConcepts",
      "refreshPaperCache",
    ],
    projectUserCtx(ctx),
  );
  const paperTags = rustRepository<IPaperTagRepository>(client, "paper_tags", [
    "listForPaper",
    "listForTag",
    "listAll",
    "link",
    "unlink",
    "unlinkBySource",
    "reconcile",
  ]);
  return { tags, paperTags, papers: rustPaperRepository(client, ctx) };
}

function sampleTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "vae",
    color: overrides.color,
  };
}

function samplePaper(id: string): Paper {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id,
    title: `Paper ${id.slice(0, 8)}`,
    authors: ["Kingma"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function link(paperId: string, tagId: string, source: PaperTagLink["source"] = "manual"): PaperTagLink {
  return { paperId, tagId, source };
}

/** Papers and tags the link rows point at, so foreign keys hold. */
async function seedLinkTargets(
  repos: Awaited<ReturnType<typeof reposFor>>,
  paperIds: string[],
  tagIds: string[],
) {
  for (const id of paperIds) await repos.papers.save(samplePaper(id));
  for (const id of tagIds) await repos.tags.save(sampleTag({ id, name: `tag-${id.slice(0, 8)}` }));
}

test("findByName returns null when absent", async () => {
  const { tags } = await reposFor(await testDb());
  assert.equal(await tags.findByName("missing"), null);
});

test("save then getById round-trips", async () => {
  const { tags } = await reposFor(await testDb());
  const tag = sampleTag();
  await tags.save(tag);
  const got = await tags.getById(tag.id);
  assert.ok(got);
  assert.equal(got.id, tag.id);
  assert.equal(got.name, tag.name);
  assert.equal(got.color, undefined);
});

test("list returns sorted tags", async () => {
  const { tags } = await reposFor(await testDb());
  await tags.save(sampleTag({ id: crypto.randomUUID(), name: "beta" }));
  await tags.save(sampleTag({ id: crypto.randomUUID(), name: "alpha" }));
  const names = (await tags.list()).map((t) => t.name);
  assert.deepEqual(names, ["alpha", "beta"]);
});

test("listWithCounts reflects distinct papers per tag", async () => {
  const repos = await reposFor(await testDb());
  const t1 = sampleTag({ id: crypto.randomUUID(), name: "vae" });
  const t2 = sampleTag({ id: crypto.randomUUID(), name: "gan" });
  const [p1, p2] = [crypto.randomUUID(), crypto.randomUUID()];
  await seedLinkTargets(repos, [p1, p2], []);
  await repos.tags.save(t1);
  await repos.tags.save(t2);
  await repos.paperTags.link(link(p1, t1.id));
  await repos.paperTags.link(link(p2, t1.id));
  await repos.paperTags.link(link(p1, t2.id));
  const counts = await repos.tags.listWithCounts();
  const byName = new Map(counts.map((c) => [c.name, c.paperCount]));
  assert.equal(byName.get("vae"), 2);
  assert.equal(byName.get("gan"), 1);
});

test("link then listForPaper", async () => {
  const repos = await reposFor(await testDb());
  const [p1, t1] = [crypto.randomUUID(), crypto.randomUUID()];
  await seedLinkTargets(repos, [p1], [t1]);
  await repos.paperTags.link(link(p1, t1));
  const links = await repos.paperTags.listForPaper(p1);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.tagId, t1);
});

test("unlink removes matching source only", async () => {
  const repos = await reposFor(await testDb());
  const [p1, t1] = [crypto.randomUUID(), crypto.randomUUID()];
  await seedLinkTargets(repos, [p1], [t1]);
  await repos.paperTags.link(link(p1, t1, "manual"));
  await repos.paperTags.link(link(p1, t1, "zotero_annotation"));
  await repos.paperTags.unlink(p1, t1, "manual");
  const links = await repos.paperTags.listForPaper(p1);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.source, "zotero_annotation");
});

test("reconcile replaces links for given sources", async () => {
  const repos = await reposFor(await testDb());
  const [p1, t1, t2, t3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await seedLinkTargets(repos, [p1], [t1, t2, t3]);
  await repos.paperTags.link(link(p1, t1, "manual"));
  await repos.paperTags.link(link(p1, t2, "manual"));
  await repos.paperTags.reconcile(p1, [link(p1, t3, "manual")], ["manual"]);
  const links = await repos.paperTags.listForPaper(p1);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.tagId, t3);
});

test("listForTag returns all memberships", async () => {
  const repos = await reposFor(await testDb());
  const [p1, p2, t1] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await seedLinkTargets(repos, [p1, p2], [t1]);
  await repos.paperTags.link(link(p1, t1));
  await repos.paperTags.link(link(p2, t1));
  assert.equal((await repos.paperTags.listForTag(t1)).length, 2);
});
