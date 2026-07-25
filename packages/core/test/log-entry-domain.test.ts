import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLogEntry,
  LogEntryValidationError,
} from "../src/features/logbook/domain/log-entry.js";
import type { Clock, IdGenerator } from "../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
let counter = 0;
const ids: IdGenerator = { newId: () => `id-${++counter}` };

test("createLogEntry applies defaults", () => {
  counter = 0;
  const e = createLogEntry({ body: "  worked on β-VAE  " }, { clock, ids });
  assert.equal(e.body, "worked on β-VAE"); // trimmed
  assert.equal(e.kind, "daily");
  assert.equal(e.entryDate, "2026-06-24"); // derived from clock
  assert.deepEqual(e.links, []);
  assert.equal(e.createdAt, "2026-06-24T12:00:00.000Z");
  assert.equal(e.id, "id-1");
});

test("createLogEntry honors explicit date, kind, and links", () => {
  const e = createLogEntry(
    {
      body: "weekly review",
      kind: "weekly",
      entryDate: "2026-06-20",
      links: [{ type: "experiment", id: "x1" }],
    },
    { clock, ids },
  );
  assert.equal(e.kind, "weekly");
  assert.equal(e.entryDate, "2026-06-20");
  assert.deepEqual(e.links, [{ type: "experiment", id: "x1" }]);
});

test("createLogEntry rejects empty body", () => {
  assert.throws(
    () => createLogEntry({ body: "   " }, { clock, ids }),
    LogEntryValidationError,
  );
});
