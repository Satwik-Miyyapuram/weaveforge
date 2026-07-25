import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readIntegrationConfig } from "../config";

describe("readIntegrationConfig", () => {
  it("defaults to zotero + mattermost + gitlab + semantic-scholar + git read", () => {
    const c = readIntegrationConfig({});
    assert.equal(c.bibliography, "zotero");
    assert.equal(c.notifications, "mattermost");
    assert.equal(c.logSync, "gitlab");
    assert.equal(c.citation, "semantic-scholar");
    assert.deepEqual(c.gitRead, ["github", "gitlab"]);
  });

  it("honours env overrides", () => {
    const c = readIntegrationConfig({
      NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER: "none",
      NEXT_PUBLIC_NOTIFICATION_PROVIDER: "none",
      NEXT_PUBLIC_LOG_SYNC_PROVIDER: "none",
      NEXT_PUBLIC_CITATION_PROVIDER: "none",
      NEXT_PUBLIC_GIT_READ_PROVIDERS: "gitlab",
    });
    assert.equal(c.bibliography, "none");
    assert.equal(c.notifications, "none");
    assert.equal(c.logSync, "none");
    assert.equal(c.citation, "none");
    assert.deepEqual(c.gitRead, ["gitlab"]);
  });

  it("allows disabling git read with none", () => {
    const c = readIntegrationConfig({ NEXT_PUBLIC_GIT_READ_PROVIDERS: "none" });
    assert.deepEqual(c.gitRead, []);
  });

  it("falls back on unknown provider ids", () => {
    const c = readIntegrationConfig({
      NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER: "mendeley",
    });
    assert.equal(c.bibliography, "zotero");
  });
});
