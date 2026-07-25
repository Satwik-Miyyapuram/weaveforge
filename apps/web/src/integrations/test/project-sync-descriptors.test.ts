import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectSyncDescriptorsForConfig } from "../descriptors";
import { readIntegrationConfig } from "../config";

describe("projectSyncDescriptorsForConfig", () => {
  it("merges GitLab git-read and log-sync into one row when both enabled", () => {
    const config = readIntegrationConfig({
      NEXT_PUBLIC_GIT_READ_PROVIDERS: "gitlab",
      NEXT_PUBLIC_LOG_SYNC_PROVIDER: "gitlab",
    });
    const rows = projectSyncDescriptorsForConfig(config);
    assert.equal(rows.filter((r) => r.provider === "gitlab").length, 1);
    assert.equal(rows.find((r) => r.provider === "gitlab")?.id, "gitlab-combined");
  });

  it("shows separate GitLab rows when only one port is enabled", () => {
    const readOnly = readIntegrationConfig({
      NEXT_PUBLIC_GIT_READ_PROVIDERS: "gitlab",
      NEXT_PUBLIC_LOG_SYNC_PROVIDER: "none",
    });
    assert.equal(
      projectSyncDescriptorsForConfig(readOnly).some((r) => r.id === "gitlab-git-read"),
      true,
    );
    assert.equal(
      projectSyncDescriptorsForConfig(readOnly).some((r) => r.id === "gitlab-log-sync"),
      false,
    );
  });
});
