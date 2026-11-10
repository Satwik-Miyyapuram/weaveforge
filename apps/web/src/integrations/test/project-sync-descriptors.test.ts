import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadTestCore } from "@/lib/test/load-test-core";
import { projectSyncDescriptorsForConfig, sharedProviderHint } from "../descriptors-resolve";
import { readIntegrationConfig } from "../config";
import type { ProjectSyncDescriptor } from "../descriptors-types";

before(async () => {
  await loadTestCore();
});

describe("sharedProviderHint", () => {
  const row = (id: string, provider: string, title: string) =>
    ({ id, provider, title }) as ProjectSyncDescriptor;

  it("is undefined when no other descriptor shares the provider", () => {
    const all = [row("a", "gitlab", "A"), row("b", "zotero", "B")];
    assert.equal(sharedProviderHint(all[0] as ProjectSyncDescriptor, all as ProjectSyncDescriptor[]), undefined);
  });

  it("names the first sibling's title on the same provider", () => {
    const all = [row("git", "gitlab", "GitLab — Git tab"), row("log", "gitlab", "GitLab — Logbook")];
    assert.equal(
      sharedProviderHint(all[1] as ProjectSyncDescriptor, all as ProjectSyncDescriptor[]),
      "Uses the same stored credentials as “GitLab — Git tab”.",
    );
  });
});

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
