import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLogEntryRepository } from "../../../src/testing/in-memory-log-entry-repository.js";
import { AddLogEntryUseCase } from "../../../src/features/logbook/application/add-log-entry.use-case.js";
import type { Clock, IdGenerator } from "../../../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

test("add persists a new log entry", async () => {
  const repo = new InMemoryLogEntryRepository();
  const uc = new AddLogEntryUseCase({ repository: repo, clock, ids: seqIds() });
  const e = await uc.add({ body: "Implemented the encoder." });
  assert.equal((await repo.getById(e.id))?.body, "Implemented the encoder.");
  assert.equal(e.entryDate, "2026-06-24");
});

test("add propagates validation errors from the domain", async () => {
  const repo = new InMemoryLogEntryRepository();
  const uc = new AddLogEntryUseCase({ repository: repo, clock, ids: seqIds() });
  await assert.rejects(() => uc.add({ body: "  " }));
  assert.equal((await repo.list()).length, 0);
});
