/**
 * Shared CONTRACT test suite for IReportSectionRepository.
 *
 * Every implementation (in-memory, Supabase, SQLite) must pass this identical
 * suite — the basis for Liskov substitutability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportSection } from "../features/report/domain/report-section.js";
import type { IReportSectionRepository } from "../features/report/domain/report-section-repository.js";

function sampleSection(overrides: Partial<ReportSection> = {}): ReportSection {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: overrides.id ?? "s1",
    title: overrides.title ?? "Introduction",
    status: overrides.status ?? "not_started",
    wordCount: overrides.wordCount ?? 0,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? now,
    sectionNo: overrides.sectionNo,
    parentId: overrides.parentId,
    ...overrides,
  };
}

export function runReportSectionRepositoryContract(
  label: string,
  makeRepo: () => IReportSectionRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    const section = sampleSection();
    await repo.save(section);
    const found = await repo.getById(section.id);
    assert.ok(found);
    assert.equal(found.title, section.title);
  });

  test(`[${label}] getById returns null when absent`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.getById("missing"), null);
  });

  test(`[${label}] list filters by status`, async () => {
    const repo = makeRepo();
    await repo.save(sampleSection({ id: "a", status: "done" }));
    await repo.save(sampleSection({ id: "b", status: "drafting" }));
    const done = await repo.list({ status: "done" });
    assert.equal(done.length, 1);
    assert.equal(done[0]?.id, "a");
  });

  test(`[${label}] list filters top-level by parentId null`, async () => {
    const repo = makeRepo();
    await repo.save(sampleSection({ id: "chap", parentId: undefined }));
    await repo.save(sampleSection({ id: "sec", parentId: "chap" }));
    const tops = await repo.list({ parentId: null });
    assert.equal(tops.length, 1);
    assert.equal(tops[0]?.id, "chap");
  });

  test(`[${label}] list orders by sortOrder then sectionNo`, async () => {
    const repo = makeRepo();
    await repo.save(sampleSection({ id: "b", sortOrder: 2, sectionNo: "2" }));
    await repo.save(sampleSection({ id: "a", sortOrder: 1, sectionNo: "1" }));
    const all = await repo.list();
    assert.deepEqual(
      all.map((s) => s.id),
      ["a", "b"],
    );
  });

  test(`[${label}] getTree nests children under parents`, async () => {
    const repo = makeRepo();
    await repo.save(sampleSection({ id: "chap", sectionNo: "3", sortOrder: 0 }));
    await repo.save(
      sampleSection({ id: "s2", parentId: "chap", sectionNo: "3.2", sortOrder: 2 }),
    );
    await repo.save(
      sampleSection({ id: "s1", parentId: "chap", sectionNo: "3.1", sortOrder: 1 }),
    );
    const tree = await repo.getTree();
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.section.id, "chap");
    assert.deepEqual(
      tree[0]?.children.map((c) => c.section.id),
      ["s1", "s2"], // ordered by sortOrder
    );
  });

  test(`[${label}] delete removes the entity`, async () => {
    const repo = makeRepo();
    const section = sampleSection();
    await repo.save(section);
    await repo.delete(section.id);
    assert.equal(await repo.getById(section.id), null);
  });

  test(`[${label}] save is idempotent upsert on id`, async () => {
    const repo = makeRepo();
    await repo.save(sampleSection({ id: "a", title: "v1" }));
    await repo.save(sampleSection({ id: "a", title: "v2" }));
    assert.equal((await repo.getById("a"))?.title, "v2");
    assert.equal((await repo.list()).length, 1);
  });
}
