import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ManageSettingsUseCase } from "../../../src/index.js";
import { fixedClock, InMemorySettingsRepository } from "../../../src/testing/parts.js";

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
