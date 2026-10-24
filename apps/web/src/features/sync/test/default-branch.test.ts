/**
 * One default git branch (xhelp-24): the domain, the store and both git
 * clients each spelled `"main"` themselves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogEntry } from "@weaveforge/core";
import { DEFAULT_GIT_BRANCH, emptyIntegration } from "../domain/integration";
import { GitLabLogExporter } from "../infrastructure/gitlab-log-exporter";

test("the default branch is main", () => {
  assert.equal(DEFAULT_GIT_BRANCH, "main");
});

test("a new git integration starts on the default branch; Mattermost has no branch", () => {
  assert.equal(emptyIntegration("github").branch, DEFAULT_GIT_BRANCH);
  assert.equal(emptyIntegration("gitlab").branch, DEFAULT_GIT_BRANCH);
  assert.equal(emptyIntegration("mattermost").branch, "");
});

const entry = { id: "e1", entryDate: "2026-01-02", title: "t", body: "b" } as unknown as LogEntry;

for (const op of ["push", "remove"] as const) {
  test(`GitLab ${op} with a blank branch writes to the default branch`, async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const exporter = new GitLabLogExporter(fetchFn);
    await exporter[op]({ provider: "gitlab", enabled: true, token: "t", repo: "g/r", branch: "" }, entry);
    assert.ok(bodies.length > 0);
    for (const b of bodies) assert.equal(JSON.parse(b).branch, DEFAULT_GIT_BRANCH);
  });
}
