import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyUserIntegrationFields,
  getUserIntegrationField,
  integrationsBagFromLegacy,
  isUserIntegrationConnected,
} from "../src/features/settings/domain/user-integration-credentials.js";

describe("user integration credentials", () => {
  it("reads from integrations bag", () => {
    const settings = {
      integrations: { zotero: { apiKey: "k", library: "users/1" } },
    };
    assert.equal(getUserIntegrationField(settings, "zotero", "apiKey"), "k");
    assert.equal(getUserIntegrationField(settings, "zotero", "library"), "users/1");
  });

  it("falls back to legacy flat columns", () => {
    const settings = { zoteroApiKey: "legacy-key", semanticScholarKey: "s2" };
    assert.equal(getUserIntegrationField(settings, "zotero", "apiKey"), "legacy-key");
    assert.equal(getUserIntegrationField(settings, "semantic-scholar", "apiKey"), "s2");
  });

  it("applyUserIntegrationFields updates bag and legacy keys", () => {
    const next = applyUserIntegrationFields({}, "zotero", {
      apiKey: "new",
      library: "users/9",
    });
    assert.deepEqual(next.integrations?.zotero, { apiKey: "new", library: "users/9" });
    assert.equal(next.zoteroApiKey, "new");
    assert.equal(next.zoteroLibrary, "users/9");
  });

  it("isUserIntegrationConnected checks any field", () => {
    assert.equal(
      isUserIntegrationConnected({ zoteroApiKey: "x" }, "zotero", ["apiKey", "library"]),
      true,
    );
    assert.equal(
      isUserIntegrationConnected({}, "zotero", ["apiKey", "library"]),
      false,
    );
  });

  it("integrationsBagFromLegacy builds provider bags", () => {
    assert.deepEqual(
      integrationsBagFromLegacy({ zoteroApiKey: "a", zoteroLibrary: "users/1" }),
      { zotero: { apiKey: "a", library: "users/1" } },
    );
  });
});
