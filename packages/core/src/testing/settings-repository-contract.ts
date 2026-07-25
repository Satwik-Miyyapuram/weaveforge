import { test } from "node:test";
import assert from "node:assert/strict";
import type { UserSettings } from "../features/settings/domain/user-settings.js";
import type { ISettingsRepository } from "../features/settings/domain/settings-repository.js";

const sampleSettings = (): UserSettings => ({
  zoteroApiKey: "key-abc",
  zoteroLibrary: "users/123",
  semanticScholarKey: "s2-key",
});

export function runSettingsRepositoryContract(
  label: string,
  makeRepo: () => ISettingsRepository,
): void {
  test(`[${label}] get returns a settings object`, async () => {
    const repo = makeRepo();
    const got = await repo.get();
    assert.equal(typeof got, "object");
    assert.ok(got !== null);
  });

  test(`[${label}] save then get round-trips`, async () => {
    const repo = makeRepo();
    const settings = sampleSettings();
    await repo.save(settings);
    assert.deepEqual(await repo.get(), settings);
  });

  test(`[${label}] save overwrites prior settings`, async () => {
    const repo = makeRepo();
    await repo.save(sampleSettings());
    const next: UserSettings = { zoteroApiKey: "other" };
    await repo.save(next);
    const got = await repo.get();
    assert.equal(got.zoteroApiKey, "other");
    assert.equal(got.zoteroLibrary, undefined);
  });
}
