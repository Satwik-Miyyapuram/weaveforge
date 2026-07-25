import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddLogEntryUseCase,
  LogEntryValidationError,
  type LogEntry,
  type ILogEntryRepository,
} from "../src/index.js";

class InMemoryLogRepo implements ILogEntryRepository {
  readonly rows = new Map<string, LogEntry>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(entity: LogEntry) {
    this.rows.set(entity.id, entity);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}

function makeUseCase() {
  const repo = new InMemoryLogRepo();
  let n = 0;
  const uc = new AddLogEntryUseCase({
    repository: repo,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `log-${++n}` },
  });
  return { repo, uc };
}

test("add: applies defaults (id, date, kind), trims body, and persists", async () => {
  const { repo, uc } = makeUseCase();
  const entry = await uc.add({ body: "  did the thing  " });
  assert.equal(entry.id, "log-1");
  assert.equal(entry.body, "did the thing");
  assert.equal(entry.kind, "daily");
  assert.equal(entry.entryDate, "2026-07-23");
  assert.equal(entry.createdAt, "2026-07-23T09:00:00.000Z");
  assert.deepEqual(entry.links, []);
  assert.deepEqual(await repo.getById("log-1"), entry);
});

test("add: honours explicit kind, date, and links", async () => {
  const { uc } = makeUseCase();
  const entry = await uc.add({
    body: "weekly summary",
    kind: "weekly",
    entryDate: "2026-07-20",
    links: [{ type: "experiment", id: "exp-1" }],
  });
  assert.equal(entry.kind, "weekly");
  assert.equal(entry.entryDate, "2026-07-20");
  assert.deepEqual(entry.links, [{ type: "experiment", id: "exp-1" }]);
});

test("add: rejects an empty body", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(uc.add({ body: "   " }), LogEntryValidationError);
});

test("update: edits body/kind while preserving id, date, createdAt", async () => {
  const { uc } = makeUseCase();
  const created = await uc.add({ body: "first", entryDate: "2026-07-20" });
  const updated = await uc.update(created.id, { body: "  edited  ", kind: "weekly" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.entryDate, "2026-07-20");
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.body, "edited");
  assert.equal(updated.kind, "weekly");
});

test("update: throws for a missing id", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(uc.update("nope", { body: "x", kind: "daily" }), /No log entry with id/);
});

test("update: rejects an empty body", async () => {
  const { uc } = makeUseCase();
  const created = await uc.add({ body: "first" });
  await assert.rejects(uc.update(created.id, { body: "  ", kind: "daily" }), /body is required/);
});

test("remove: deletes the entry", async () => {
  const { repo, uc } = makeUseCase();
  const created = await uc.add({ body: "temp" });
  await uc.remove(created.id);
  assert.equal(await repo.getById(created.id), null);
});
