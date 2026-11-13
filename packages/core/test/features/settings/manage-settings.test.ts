import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ManageSettingsUseCase, type ISettingsRepository, type UserSettings } from "../../../src/index.js";
import { fixedClock } from "../../support/clock.js";

/** Keeps the saved settings in memory; only what this test needs. */
class InMemorySettingsRepository implements ISettingsRepository {
  private settings = {} as UserSettings;
  async get(): Promise<UserSettings> {
    return structuredClone(this.settings);
  }
  async getMetadata() {
    return { disclaimerAcceptedAt: undefined, disclaimerVersion: undefined, appearance: undefined };
  }
  async save(settings: UserSettings): Promise<void> {
    this.settings = structuredClone(settings);
  }
  async saveDisclaimer(): Promise<void> {}
}

const clock = fixedClock("2026-06-24T12:00:00.000Z");

// saveAppearance, acceptDisclaimer and the normalize rules are ported to Rust
// (repos/user_settings.rs, settings/user_settings.rs). Save and get stay here: they seal
// credentials through the server route.
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
});
