import assert from "node:assert/strict";
import { before, test } from "node:test";

import { ManageSettingsUseCase } from "@weaveforge/core";
import { systemClock } from "@/lib/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { READ_ONLY_KEYS, READ_ONLY_MESSAGE, readOnlyBackend } from "../read-only-repositories";

before(loadTestCore);

type Writable = { saveOne: () => string; getAll: () => string[] };

test("readOnlyBackend wraps every personal key, alias and the settings use case, by explicit list", () => {
  const bag: Record<string, unknown> = { config: { x: 1 }, shareRepository: { saveOne: () => "live" } };
  for (const key of READ_ONLY_KEYS) bag[key] = { saveOne: () => "w", getAll: () => ["a"] } satisfies Writable;
  const out = readOnlyBackend(bag);
  for (const key of READ_ONLY_KEYS) {
    if (key === "manageSettings") continue;
    const repo = out[key] as Writable;
    assert.throws(() => repo.saveOne(), new RegExp(READ_ONLY_MESSAGE), key);
    assert.deepEqual(repo.getAll(), ["a"], `${key} reads pass`);
  }
  assert.equal((out.shareRepository as Writable).saveOne(), "live", "org keys are not in the explicit list");
  assert.equal(out.config, bag.config);
});

test("the explicit list names the settings, credential and Zotero keys", () => {
  for (const key of [
    "settingsRepository",
    "manageSettings",
    "integrationsStore",
    "projectBibliographyCollection",
    "bibliographyCollectionStore",
    "annotationQuotationTypeRepository",
    "screeningRepository",
  ]) {
    assert.equal(READ_ONLY_KEYS.has(key), true, `${key} must be read-only`);
  }
});

test("readOnlyBackend refuses settings, credential and Zotero writes through the rebuilt use case", async () => {
  const writes: unknown[] = [];
  const repo = {
    get: () => Promise.resolve({}),
    getMetadata: () => Promise.resolve({}),
    save: (settings: unknown) => {
      writes.push(settings);
      return Promise.resolve();
    },
    saveDisclaimer: (acceptedAt: string) => {
      writes.push(acceptedAt);
      return Promise.resolve();
    },
  };
  const live = new ManageSettingsUseCase({ repository: repo, clock: systemClock });
  const out = readOnlyBackend({ settingsRepository: repo, manageSettings: live });
  await assert.rejects(out.manageSettings.save({ zoteroApiKey: "key" }), new RegExp(READ_ONLY_MESSAGE));
  await assert.rejects(out.manageSettings.save({ disclaimerAcceptedAt: "2026-11-22" }), new RegExp(READ_ONLY_MESSAGE));
  assert.deepEqual(writes, [], "nothing reaches the settings repository");
});

test("readOnlyBackend refuses repository writes and leaves the database reads alone", () => {
  const repo = { getAll: () => ["a"], saveOne: () => "written" };
  const bag = {
    paperRepository: repo,
    db: { from: (_table: string) => ({ select: (..._args: unknown[]) => "rows" }) },
  };
  const out = readOnlyBackend(bag);
  assert.deepEqual(out.paperRepository.getAll(), ["a"]);
  assert.throws(() => out.paperRepository.saveOne(), new RegExp(READ_ONLY_MESSAGE));
  assert.equal(out.db.from("papers").select(), "rows", "db reads still pass");
});
