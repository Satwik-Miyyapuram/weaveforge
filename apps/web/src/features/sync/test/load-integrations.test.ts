import assert from "node:assert/strict";
import test from "node:test";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { emptyIntegration, type Integration, type SyncProvider } from "../domain/integration";
import { loadIntegrations } from "../ui/load-integrations";

const github: Integration = { provider: "github", enabled: true, repo: "o/r", branch: "dev" };

test("each provider gets its stored row, or an empty one", async () => {
  const result = await loadIntegrations(
    async (provider: SyncProvider) => (provider === "github" ? github : (null as unknown as Integration)),
    ["github", "mattermost"],
  );
  assert.deepEqual(result, {
    items: { github, mattermost: emptyIntegration("mattermost") },
    error: null,
  });
});

test("a failed read is shown and logged, not passed off as no connections (33-12)", async () => {
  await withAppLogs(async (logs) => {
    const result = await loadIntegrations(async () => {
      throw new Error("offline");
    }, ["github"]);
    assert.deepEqual(result.items, {});
    assert.match(result.error ?? "", /could not load/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.level, "warn");
    assert.equal(logs[0]?.source, "sync");
    assert.equal(logs[0]?.detail, "offline");
  });
});

test("no providers reads nothing", async () => {
  let reads = 0;
  const result = await loadIntegrations(async () => {
    reads += 1;
    return github;
  }, []);
  assert.deepEqual(result, { items: {}, error: null });
  assert.equal(reads, 0);
});
