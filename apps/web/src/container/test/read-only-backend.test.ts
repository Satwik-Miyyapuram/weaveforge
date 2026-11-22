import assert from "node:assert/strict";
import { before, test } from "node:test";

import { ManageSettingsUseCase } from "@weaveforge/core";
import { systemClock } from "@/lib/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { READ_ONLY_KEYS, READ_ONLY_MESSAGE, READ_ONLY_METHODS, readOnlyBackend } from "../read-only-repositories";

before(loadTestCore);

test("readOnlyBackend wraps every personal key, alias and the settings use case, by explicit list", () => {
  const bag: Record<string, unknown> = { config: { x: 1 }, shareRepository: { save: () => "live" } };
  for (const key of READ_ONLY_KEYS) {
    if (key === "manageSettings") continue;
    const repo: Record<string, () => unknown> = { save: () => "w" };
    for (const read of READ_ONLY_METHODS[key] ?? []) repo[read] = () => ["a"];
    bag[key] = repo;
  }
  const out = readOnlyBackend(bag) as Record<string, Record<string, () => unknown>>;
  for (const key of READ_ONLY_KEYS) {
    if (key === "manageSettings") continue;
    const repo = out[key] as { save: () => unknown } & Record<string, () => unknown>;
    assert.throws(() => repo.save(), new RegExp(READ_ONLY_MESSAGE), key);
    for (const read of READ_ONLY_METHODS[key] ?? []) assert.deepEqual((repo[read] as () => unknown)(), ["a"], `${key}.${read} reads pass`);
  }
  assert.equal((out.shareRepository as unknown as { save: () => unknown }).save(), "live", "org keys are not in the explicit list");
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
  const repo = { list: () => ["a"], save: () => "written" };
  const bag = {
    paperRepository: repo,
    db: { from: (_table: string) => ({ select: (..._args: unknown[]) => "rows" }) },
  };
  const out = readOnlyBackend(bag);
  assert.deepEqual(out.paperRepository.list(), ["a"]);
  assert.throws(() => out.paperRepository.save(), new RegExp(READ_ONLY_MESSAGE));
  assert.equal(out.db.from("papers").select(), "rows", "db reads still pass");
});
