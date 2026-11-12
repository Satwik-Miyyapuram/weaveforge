// contract-repos: report_sections
import assert from "node:assert/strict";
import test from "node:test";
import type { IReportSectionManager, IReportSectionRepository, ReportSection } from "@weaveforge/core";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `IReportSectionRepository` contract, end to end: Rust plans each query, the
 * TS sender runs it against PGlite with the real `report_sections` migration and
 * RLS. Ported from the deleted `report-section-repository-contract.ts` suite.
 */

async function repoFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  return rustRepository<IReportSectionRepository & IReportSectionManager>(
    clientFor(db, userId),
    "report_sections",
    [
      "getById",
      "list",
      "getTree",
      "save",
      "delete",
      "add",
      "setTitle",
      "setParent",
      "setStatus",
      "setProgress",
      "setNotes",
      "remove",
    ],
    projectUserCtx(projectFor(projectId)),
  );
}

function sampleSection(overrides: Partial<ReportSection> = {}): ReportSection {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    title: "Introduction",
    status: "not_started",
    wordCount: 0,
    sortOrder: 0,
    createdAt: now,
    sectionNo: undefined,
    parentId: undefined,
    ...overrides,
  };
}

test("save then getById returns the entity", async () => {
  const repo = await repoFor(await testDb());
  const section = sampleSection();
  await repo.save(section);
  const found = await repo.getById(section.id);
  assert.equal(found!.title, section.title);
});

test("getById returns null when absent", async () => {
  const repo = await repoFor(await testDb());
  assert.equal(await repo.getById(crypto.randomUUID()), null);
});

test("list filters by status", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(sampleSection({ id: a, status: "done" }));
  await repo.save(sampleSection({ status: "drafting" }));
  const done = await repo.list({ status: "done" });
  assert.equal(done.length, 1);
  assert.equal(done[0]?.id, a);
});

test("list filters top-level by parentId null", async () => {
  const repo = await repoFor(await testDb());
  const chap = crypto.randomUUID();
  await repo.save(sampleSection({ id: chap, parentId: undefined }));
  await repo.save(sampleSection({ parentId: chap }));
  const tops = await repo.list({ parentId: null });
  assert.equal(tops.length, 1);
  assert.equal(tops[0]?.id, chap);
});

test("list orders by sortOrder then sectionNo", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await repo.save(sampleSection({ id: b, sortOrder: 2, sectionNo: "2" }));
  await repo.save(sampleSection({ id: a, sortOrder: 1, sectionNo: "1" }));
  const all = await repo.list();
  assert.deepEqual(
    all.map((s) => s.id),
    [a, b],
  );
});

test("getTree nests children under parents", async () => {
  const repo = await repoFor(await testDb());
  const chap = crypto.randomUUID();
  const s1 = crypto.randomUUID();
  const s2 = crypto.randomUUID();
  await repo.save(sampleSection({ id: chap, sectionNo: "3", sortOrder: 0 }));
  await repo.save(sampleSection({ id: s2, parentId: chap, sectionNo: "3.2", sortOrder: 2 }));
  await repo.save(sampleSection({ id: s1, parentId: chap, sectionNo: "3.1", sortOrder: 1 }));
  const tree = await repo.getTree();
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.section.id, chap);
  assert.deepEqual(
    tree[0]!.children.map((c) => c.section.id),
    [s1, s2], // ordered by sortOrder
  );
});

test("delete removes the entity", async () => {
  const repo = await repoFor(await testDb());
  const section = sampleSection();
  await repo.save(section);
  await repo.delete(section.id);
  assert.equal(await repo.getById(section.id), null);
});

test("save is idempotent upsert on id", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(sampleSection({ id: a, title: "v1" }));
  await repo.save(sampleSection({ id: a, title: "v2" }));
  assert.equal((await repo.getById(a))?.title, "v2");
  assert.equal((await repo.list()).length, 1);
});
