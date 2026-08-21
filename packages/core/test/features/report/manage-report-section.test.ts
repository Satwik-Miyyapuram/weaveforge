import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageReportSectionUseCase,
  ReportSectionValidationError,
  type ReportSection,
  type IReportSectionRepository,
} from "../../../src/index.js";

class InMemoryReportRepo implements IReportSectionRepository {
  readonly rows = new Map<string, ReportSection>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(s: ReportSection) {
    this.rows.set(s.id, s);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}

function makeUseCase() {
  const repo = new InMemoryReportRepo();
  let n = 0;
  const uc = new ManageReportSectionUseCase({
    repository: repo,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `sec-${++n}` },
  });
  return { repo, uc };
}

test("add: defaults status/wordCount, requires a title, rejects negatives", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "  Intro  " });
  assert.equal(s.title, "Intro");
  assert.equal(s.status, "not_started");
  assert.equal(s.wordCount, 0);
  await assert.rejects(uc.add({ title: " " }), ReportSectionValidationError);
  await assert.rejects(uc.add({ title: "x", wordCount: -1 }), /Word count cannot be negative/);
});

test("setStatus / setNotes: mutate the section", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "S" });
  assert.equal((await uc.setStatus(s.id, "drafting")).status, "drafting");
  const withNotes = await uc.setNotes(s.id, "todo one two");
  assert.equal(withNotes.notes, "todo one two");
  assert.equal(withNotes.wordCount, 3);
  const cleared = await uc.setNotes(s.id, "   ");
  assert.equal(cleared.notes, undefined);
  assert.equal(cleared.wordCount, 0);
});

test("setProgress: sets wordCount and rejects negatives", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "S" });
  assert.equal((await uc.setProgress(s.id, 250)).wordCount, 250);
  await assert.rejects(uc.setProgress(s.id, -5), /Word count cannot be negative/);
});

test("mutations throw for an unknown id; remove deletes", async () => {
  const { repo, uc } = makeUseCase();
  await assert.rejects(uc.setStatus("nope", "done"), /No report section with id/);
  const s = await uc.add({ title: "Temp" });
  await uc.remove(s.id);
  assert.equal(await repo.getById(s.id), null);
});
