import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryReportSectionRepository } from "../../../src/testing/in-memory-report-section-repository.js";
import { ManageReportSectionUseCase } from "../../../src/features/report/application/manage-report-section.use-case.js";
import { fixedClock, seqIds } from "../../../src/testing/fakes.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");

function makeUseCase() {
  const repo = new InMemoryReportSectionRepository();
  const uc = new ManageReportSectionUseCase({ repository: repo, clock, ids: seqIds() });
  return { repo, uc };
}

test("add persists a new section", async () => {
  const { repo, uc } = makeUseCase();
  const s = await uc.add({ title: "Method", sectionNo: "3" });
  assert.equal((await repo.getById(s.id))?.title, "Method");
});

test("setStatus updates only the status", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "Results" });
  const updated = await uc.setStatus(s.id, "done");
  assert.equal(updated.status, "done");
  assert.equal(updated.title, "Results");
});

test("setProgress updates the word count", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "Discussion" });
  const updated = await uc.setProgress(s.id, 1200);
  assert.equal(updated.wordCount, 1200);
});

test("setStatus throws for unknown id", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(() => uc.setStatus("nope", "done"));
});

test("setTitle renames, and rejects an empty title", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "Draft" });
  assert.equal((await uc.setTitle(s.id, "  Final ")).title, "Final");
  await assert.rejects(() => uc.setTitle(s.id, "  "));
});

test("setParent nests, clears with null, and refuses a loop", async () => {
  const { uc } = makeUseCase();
  const chapter = await uc.add({ title: "Chapter" });
  const section = await uc.add({ title: "Section" });
  assert.equal((await uc.setParent(section.id, chapter.id)).parentId, chapter.id);
  await assert.rejects(() => uc.setParent(chapter.id, section.id), /inside itself/);
  assert.equal((await uc.setParent(section.id, null)).parentId, undefined);
});

test("setParent keeps its exact refusals: self, descendant, missing parent (xhelp-18)", async () => {
  const { repo, uc } = makeUseCase();
  const a = await uc.add({ title: "A" });
  const b = await uc.add({ title: "B" });
  const c = await uc.add({ title: "C" });
  await uc.setParent(b.id, a.id);
  await uc.setParent(c.id, b.id);
  const inside = { name: "ReportSectionValidationError", message: "A section cannot be moved inside itself." };
  await assert.rejects(() => uc.setParent(a.id, a.id), inside);
  await assert.rejects(() => uc.setParent(a.id, c.id), inside);
  await assert.rejects(() => uc.setParent(a.id, "nope"), { name: "NotFoundError", message: 'No report section with id "nope".' });
  // A missing ancestor still names the requested parent.
  await repo.save({ ...(await repo.getById(b.id))!, parentId: "ghost" });
  await assert.rejects(() => uc.setParent(a.id, c.id), { name: "NotFoundError", message: `No report section with id "${c.id}".` });
});

test("setParent under a loop already in the data still moves", async () => {
  const { repo, uc } = makeUseCase();
  const x = await uc.add({ title: "X" });
  const y = await uc.add({ title: "Y" });
  const m = await uc.add({ title: "M" });
  await repo.save({ ...(await repo.getById(x.id))!, parentId: y.id });
  await repo.save({ ...(await repo.getById(y.id))!, parentId: x.id });
  assert.equal((await uc.setParent(m.id, x.id)).parentId, x.id);
});
