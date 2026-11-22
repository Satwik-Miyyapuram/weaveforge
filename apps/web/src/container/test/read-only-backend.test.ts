import assert from "node:assert/strict";
import { test } from "node:test";

import { READ_ONLY_MESSAGE, readOnlyBackend } from "../read-only-repositories";

test("readOnlyBackend wraps every *Repository and *Store field, not only paperRepository", () => {
  const bag = { noteStore: { saveNote: () => "w" }, fooRepository: { deleteFoo: () => "w" } };
  const out = readOnlyBackend(bag);
  assert.throws(() => out.noteStore.saveNote(), new RegExp(READ_ONLY_MESSAGE));
  assert.throws(() => out.fooRepository.deleteFoo(), new RegExp(READ_ONLY_MESSAGE));
});

test("readOnlyBackend refuses writes on repository fields and leaves the rest alone", () => {
  const repo = { getAll: () => ["a"], saveOne: () => "written" };
  const useCase = { saveOne: () => "still-live" };
  const bag = { paperRepository: repo, manageSettings: useCase, db: { from: (_table: string) => ({ select: (..._args: unknown[]) => "rows" }) }, config: { x: 1 } };
  const out = readOnlyBackend(bag);
  assert.deepEqual(out.paperRepository.getAll(), ["a"]);
  assert.throws(() => out.paperRepository.saveOne(), new RegExp(READ_ONLY_MESSAGE));
  assert.equal(out.manageSettings.saveOne(), "still-live");
  assert.equal(out.db.from("papers").select(), "rows", "db reads still pass");
  assert.equal(out.config, bag.config);
});
