import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ManageSettingsUseCase, normalizeUserSettings } from "../../../src/features/settings/index.js";
import { CURRENT_DISCLAIMER_VERSION } from "../../../src/features/settings/domain/privacy-disclaimer.js";
import { InMemorySettingsRepository } from "../../../src/testing/in-memory-settings-repository.js";
import { fixedClock } from "../../../src/testing/fakes.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");

describe("normalizeUserSettings", () => {
  it("trims and drops empty strings", () => {
    assert.deepEqual(
      normalizeUserSettings({
        zoteroApiKey: "  abc  ",
        zoteroLibrary: "",
        semanticScholarKey: "   ",
      }),
      {
        zoteroApiKey: "abc",
        integrations: { zotero: { apiKey: "abc" } },
      },
    );
  });
});

describe("ManageSettingsUseCase", () => {
  it("normalizes on save", async () => {
    const repo = new InMemorySettingsRepository();
    const uc = new ManageSettingsUseCase({ repository: repo, clock });
    await uc.save({ zoteroApiKey: "  key  ", zoteroLibrary: "users/1" });
    assert.deepEqual(await uc.get(), {
      zoteroApiKey: "key",
      zoteroLibrary: "users/1",
      integrations: { zotero: { apiKey: "key", library: "users/1" } },
    });
  });

  it("saveAppearance merges with existing settings", async () => {
    const repo = new InMemorySettingsRepository();
    const uc = new ManageSettingsUseCase({ repository: repo, clock });
    await uc.save({ zoteroApiKey: "key" });
    await uc.saveAppearance({ mode: "dark", darkTheme: "dracula" });
    assert.deepEqual(await uc.get(), {
      zoteroApiKey: "key",
      integrations: { zotero: { apiKey: "key" } },
      appearance: { mode: "dark", darkTheme: "dracula" },
    });
  });

  it("acceptDisclaimer records current version", async () => {
    const repo = new InMemorySettingsRepository();
    const uc = new ManageSettingsUseCase({ repository: repo, clock });
    await uc.acceptDisclaimer();
    const settings = await uc.get();
    assert.equal(settings.disclaimerAcceptedAt, "2026-06-24T12:00:00.000Z", "time from the injected clock");
    assert.equal(settings.disclaimerVersion, CURRENT_DISCLAIMER_VERSION);
  });

  it("acceptDisclaimer updates only disclaimer metadata", async () => {
    const repo = new InMemorySettingsRepository();
    const uc = new ManageSettingsUseCase({ repository: repo, clock });
    await uc.save({ zoteroApiKey: "encrypted-secret-placeholder" });
    await uc.acceptDisclaimer();
    const settings = await uc.get();
    assert.equal(settings.zoteroApiKey, "encrypted-secret-placeholder");
    assert.equal(settings.disclaimerVersion, CURRENT_DISCLAIMER_VERSION);
  });
});
