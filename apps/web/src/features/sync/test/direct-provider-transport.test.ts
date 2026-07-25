import assert from "node:assert/strict";
import test from "node:test";
import { GitClient } from "../infrastructure/git-client";
import { GitLabLogExporter } from "../infrastructure/gitlab-log-exporter";
import { MattermostNotifier } from "../infrastructure/mattermost-notifier";
import type { Integration } from "../domain/integration";

function ok(body: unknown = []): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

test("Git provider reads send tokens directly to the provider", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = new GitClient(async (url, init) => {
    requests.push({ url: String(url), init });
    return ok([]);
  });
  const github: Integration = { provider: "github", enabled: true, token: "gh-secret", repo: "org/repo", branch: "main" };
  const gitlab: Integration = { provider: "gitlab", enabled: true, token: "gl-secret", repo: "group/project", branch: "main" };
  await client.listBranches(github);
  await client.listBranches(gitlab);
  assert.equal(requests[0]?.url, "https://api.github.com/repos/org/repo/branches?per_page=100");
  assert.equal(new Headers(requests[0]?.init?.headers).get("Authorization"), "Bearer gh-secret");
  assert.match(requests[1]?.url ?? "", /^https:\/\/gitlab\.com\/api\/v4\/projects\//);
  assert.equal(new Headers(requests[1]?.init?.headers).get("PRIVATE-TOKEN"), "gl-secret");
});

test("GitLab and Mattermost writes have no Thesis Tracker credential relay", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return ok({});
  };
  const gitlab: Integration = { provider: "gitlab", enabled: true, token: "gl-secret", repo: "group/project", branch: "main" };
  await new GitLabLogExporter(fetchFn).push(gitlab, {
    id: "entry-12345678", entryDate: "2026-07-15", kind: "daily", body: "Private update",
    links: [], createdAt: "2026-07-15T00:00:00.000Z",
  });
  const mattermost: Integration = { provider: "mattermost", enabled: true, token: "mm-secret", repo: "https://chat.example.com/path", branch: "channel-id" };
  await new MattermostNotifier(fetchFn).post(mattermost, "Private update");
  assert.match(requests[0]?.url ?? "", /^https:\/\/gitlab\.com\/api\/v4\/projects\//);
  assert.equal(new Headers(requests[0]?.init?.headers).get("PRIVATE-TOKEN"), "gl-secret");
  assert.equal(requests[1]?.url, "https://chat.example.com/api/v4/posts");
  assert.equal(new Headers(requests[1]?.init?.headers).get("Authorization"), "Bearer mm-secret");
});
