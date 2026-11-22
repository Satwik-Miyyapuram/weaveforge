import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { ReportSection } from "@weaveforge/core";
import { NotFoundError, ReportSectionValidationError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileReportSectionRepository } from "../file-report-section-repo";

before(loadTestCore);

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, repo: new FileReportSectionRepository(fs, () => "thesis") };
}

function section(over: Partial<ReportSection> = {}): ReportSection {
  return {
    id: crypto.randomUUID(),
    title: "Introduction",
    status: "not_started",
    wordCount: 0,
    sortOrder: 0,
    createdAt: "2026-06-24T00:00:00.000Z",
    ...over,
  };
}

test("T4: every field round-trips; unicode and duplicate titles are two files", async () => {
  const { fs, repo } = setup();
  const full = section({
    title: "Ünïcode: «résumé» / 1",
    sectionNo: "3.2",
    parentId: "p1",
    status: "review",
    wordCount: 1200,
    targetWords: 3000,
    deadline: "2026-07-01",
    draftUrl: "https://overleaf.com/x",
    notes: "Body with [[Some Note]] link.\n\nSecond paragraph.",
    sortOrder: 4,
  });
  const twin = section({ title: full.title });
  await repo.save(full);
  await repo.save(twin);
  const { updatedAt, ...got } = (await repo.getById(full.id))!;
  assert.deepEqual(got, full);
  assert.match(updatedAt ?? "", /^\d{4}-\d\d-\d\dT/);
  assert.equal((await repo.getById(twin.id))?.title, full.title);
  const files: string[] = [];
  for await (const e of fs.walk("thesis")) if (e.kind === "file") files.push(e.path);
  assert.equal(files.length, 2);
});

test("every save stamps a new updatedAt, so a stale AI revision is caught", async () => {
  const { repo } = setup();
  const s = section({ updatedAt: "2000-01-01T00:00:00.000Z" });
  await repo.save(s);
  const saved = (await repo.getById(s.id))!.updatedAt!;
  assert.notEqual(saved, s.updatedAt);
  const noted = await repo.setNotes(s.id, "new words");
  assert.ok(noted.updatedAt! > saved, "an update moves updatedAt forward");
  assert.equal((await repo.getById(s.id))!.updatedAt, noted.updatedAt);
  const again = await repo.setStatus(s.id, "done");
  assert.ok(again.updatedAt! > noted.updatedAt!, "back-to-back updates never share a revision");
  const made = await repo.add({ title: "New" });
  assert.equal((await repo.getById(made.id))!.updatedAt, made.updatedAt);
  assert.ok(made.updatedAt);
});

test("getById is null when absent; save upserts on id", async () => {
  const { repo } = setup();
  assert.equal(await repo.getById("nope"), null);
  const id = crypto.randomUUID();
  await repo.save(section({ id, title: "v1" }));
  await repo.save(section({ id, title: "v2" }));
  assert.equal((await repo.getById(id))?.title, "v2");
  assert.equal((await repo.list()).length, 1);
});

test("list filters by status, top level, title; orders by sortOrder then sectionNo", async () => {
  const { repo } = setup();
  const chap = section({ sortOrder: 2, sectionNo: "2", status: "done", title: "Methods" });
  const child = section({ sortOrder: 1, sectionNo: "2.1", parentId: chap.id, title: "Data" });
  const first = section({ sortOrder: 1, sectionNo: "1", title: "Intro" });
  for (const s of [chap, child, first]) await repo.save(s);
  assert.deepEqual((await repo.list()).map((s) => s.id), [first.id, child.id, chap.id]);
  assert.deepEqual((await repo.list({ status: "done" })).map((s) => s.id), [chap.id]);
  assert.deepEqual((await repo.list({ parentId: null })).map((s) => s.id), [first.id, chap.id]);
  assert.deepEqual((await repo.list({ parentId: chap.id })).map((s) => s.id), [child.id]);
  assert.deepEqual((await repo.list({ titleContains: "METH" })).map((s) => s.id), [chap.id]);
});

test("getTree nests children by sortOrder", async () => {
  const { repo } = setup();
  const chap = section({ sectionNo: "3" });
  const s2 = section({ parentId: chap.id, sectionNo: "3.2", sortOrder: 2 });
  const s1 = section({ parentId: chap.id, sectionNo: "3.1", sortOrder: 1 });
  for (const s of [chap, s2, s1]) await repo.save(s);
  const tree = await repo.getTree();
  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0]!.children.map((c) => c.section.id), [s1.id, s2.id]);
});

test("add validates and saves; setTitle trims and rejects blank", async () => {
  const { repo } = setup();
  await assert.rejects(repo.add({ title: "  " }), ReportSectionValidationError);
  const made = await repo.add({ title: "Results" });
  assert.deepEqual(await repo.getById(made.id), made);
  assert.equal((await repo.setTitle(made.id, "  Findings ")).title, "Findings");
  await assert.rejects(repo.setTitle(made.id, " "), ReportSectionValidationError);
  await assert.rejects(repo.setTitle("missing", "x"), NotFoundError);
});

test("setParent moves, refuses a loop, and moves back to the top", async () => {
  const { repo } = setup();
  const a = await repo.add({ title: "A" });
  const b = await repo.add({ title: "B" });
  assert.equal((await repo.setParent(b.id, a.id)).parentId, a.id);
  await assert.rejects(repo.setParent(a.id, b.id), ReportSectionValidationError);
  await assert.rejects(repo.setParent(a.id, a.id), ReportSectionValidationError);
  await assert.rejects(repo.setParent(a.id, "missing"), NotFoundError);
  assert.equal((await repo.setParent(b.id, null)).parentId, undefined);
});

test("setStatus, setProgress, setNotes keep word count in sync", async () => {
  const { repo } = setup();
  const s = await repo.add({ title: "S" });
  assert.equal((await repo.setStatus(s.id, "drafting")).status, "drafting");
  assert.equal((await repo.setProgress(s.id, 42)).wordCount, 42);
  await assert.rejects(repo.setProgress(s.id, -1), ReportSectionValidationError);
  const noted = await repo.setNotes(s.id, "three small words");
  assert.equal(noted.notes, "three small words");
  assert.equal(noted.wordCount, 3);
  const cleared = await repo.setNotes(s.id, "   ");
  assert.equal(cleared.notes, undefined);
  assert.equal(cleared.wordCount, 0);
});

test("delete and remove move the file to the trash", async () => {
  const { fs, repo } = setup();
  const a = await repo.add({ title: "A" });
  const b = await repo.add({ title: "B" });
  await repo.delete(a.id);
  await repo.remove(b.id);
  assert.equal((await repo.list()).length, 0);
  let trashed = 0;
  for await (const e of fs.walk(".weaveforge/trash")) if (e.kind === "file") trashed += 1;
  assert.equal(trashed, 2);
});
