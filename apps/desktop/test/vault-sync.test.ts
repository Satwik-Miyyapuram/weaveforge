import assert from "node:assert/strict";
import { test } from "node:test";

import type { GitRemoteConfig, IWorkspaceGitRemote, VaultRepoState } from "@weaveforge/core";

import { syncVault, type VaultSyncSettings } from "../src/vault-git";

/** A remote that records what it was asked and never touches a disk or network. */
function fakeRemote(fail?: string) {
  const calls: { op: string; remote: GitRemoteConfig }[] = [];
  const answer = async <T>(op: string, remote: GitRemoteConfig, value: T): Promise<T> => {
    calls.push({ op, remote });
    if (fail) throw new Error(fail);
    return value;
  };
  const repo: IWorkspaceGitRemote & { calls: typeof calls } = {
    calls,
    connect: (remote) => answer("connect", remote, { url: remote.url, branch: "main", ahead: 0, behind: 0 }),
    remoteStatus: (remote) => answer("status", remote, { url: remote.url, branch: "main", ahead: 2, behind: 1 }),
    pull: (remote) => answer("pull", remote, { kind: "up-to-date" as const }),
    push: (remote) => answer("push", remote, { kind: "pushed" as const }),
  };
  return repo;
}

const own = async (): Promise<VaultRepoState> => ({ kind: "own" });
const none = async (): Promise<VaultRepoState> => ({ kind: "none" });
const settings: VaultSyncSettings = { enabled: true, url: "https://github.com/me/notes.git", token: "ghp_tok" };

test("settings answers what is stored without starting git or saying the token", async () => {
  const repo = fakeRemote();
  let probed = 0;
  const reply = await syncVault("/v", "settings", settings, repo, async () => {
    probed++;
    return { kind: "own" };
  });
  assert.deepEqual(reply, { url: settings.url, hasToken: true });
  assert.equal(probed, 0);
  assert.deepEqual(repo.calls, []);
  assert.deepEqual(await syncVault("/v", "settings", { enabled: false, url: null, token: null }, repo, own), {
    url: null,
    hasToken: false,
  });
});

test("each action reaches the remote with the stored URL and token, and answers with its outcome", async () => {
  const repo = fakeRemote();
  assert.deepEqual((await syncVault("/v", "status", settings, repo, own)).status?.ahead, 2);
  assert.deepEqual((await syncVault("/v", "pull", settings, repo, own)).pull, { kind: "up-to-date" });
  assert.deepEqual((await syncVault("/v", "push", settings, repo, own)).push, { kind: "pushed" });
  assert.equal((await syncVault("/v", "connect", settings, repo, none)).status?.url, settings.url);
  assert.deepEqual(
    repo.calls.map((c) => c.op),
    ["status", "pull", "push", "connect"],
  );
  for (const call of repo.calls) assert.deepEqual(call.remote, { url: settings.url, token: "ghp_tok" });
});

test("without a token the remote is called with none (a public repo, or git's own credentials)", async () => {
  const repo = fakeRemote();
  await syncVault("/v", "pull", { ...settings, token: null }, repo, own);
  assert.deepEqual(repo.calls[0]!.remote, { url: settings.url });
});

test("refused: history off, an enclosing repository, no URL, a bad URL, an unknown action", async () => {
  const repo = fakeRemote();
  await assert.rejects(syncVault("/v", "pull", { ...settings, enabled: false }, repo, own), /history/i);
  await assert.rejects(
    syncVault("/v", "push", settings, repo, async () => ({ kind: "enclosing", root: "/up" })),
    /inside the repository/,
  );
  await assert.rejects(syncVault("/v", "pull", { ...settings, url: null }, repo, own), /URL/);
  await assert.rejects(syncVault("/v", "pull", { ...settings, url: "http://x.test/r.git" }, repo, own), /https/);
  await assert.rejects(syncVault("/v", "force-push", settings, repo, own), /not a sync action/);
  // Only the remote call that would run "connect" on a folder with no repo initialises it; nothing ran here.
  assert.deepEqual(repo.calls, []);
});

test("status on a folder with no repository yet does not create one", async () => {
  const repo = fakeRemote();
  const reply = await syncVault("/v", "status", settings, repo, none);
  assert.deepEqual(reply.status, { url: null, branch: "main", ahead: 0, behind: 0 });
  assert.deepEqual(repo.calls, []);
});

test("a failure from git comes back without the token in it", async () => {
  const repo = fakeRemote("fatal: Authentication failed for ghp_tok");
  await assert.rejects(syncVault("/v", "pull", settings, repo, own), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("ghp_tok"), error.message);
    assert.match(error.message, /Authentication failed/);
    return true;
  });
});

test("calls on one folder run one at a time, so git never meets its own index lock", async () => {
  let running = 0;
  let peak = 0;
  const slow: IWorkspaceGitRemote = {
    connect: async () => ({ url: null, branch: "main", ahead: 0, behind: 0 }),
    remoteStatus: async () => ({ url: null, branch: "main", ahead: 0, behind: 0 }),
    pull: async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      return { kind: "up-to-date" };
    },
    push: async () => ({ kind: "up-to-date" }),
  };
  await Promise.all([1, 2, 3].map(() => syncVault("/v", "pull", settings, slow, own)));
  assert.equal(peak, 1);
});
