import assert from "node:assert/strict";
import { test } from "node:test";

import type { DesktopVaultSync, DesktopVaultSyncAction } from "@/lib/desktop/desktop-bridge";

import {
  describeRemoteSync,
  disconnectRemote,
  folderRemoteSync,
  forgetRemoteToken,
  remoteSyncAvailable,
  saveRemoteSyncSettings,
} from "../application/folder-remote-sync";

/** A shell with only what this path touches, recording each call. */
function fakeShell(reply: (action: DesktopVaultSyncAction) => Promise<DesktopVaultSync>) {
  const calls: unknown[][] = [];
  const bridge = {
    fetchTitle: () => Promise.resolve(null),
    vaultSync: (action: DesktopVaultSyncAction) => {
      calls.push(["sync", action]);
      return reply(action);
    },
    writePreference: (name: string, value: unknown) => {
      calls.push(["pref", name, value]);
      return Promise.resolve();
    },
    writeSecret: (name: string, value: string) => {
      calls.push(["secret", name, value]);
      return Promise.resolve();
    },
    clearSecret: (name: string) => {
      calls.push(["clear", name]);
      return Promise.resolve();
    },
  };
  (globalThis as { window?: unknown }).window = { weaveforge: bridge };
  return calls;
}

const reply = (extra: Partial<DesktopVaultSync> = {}) => async (): Promise<DesktopVaultSync> => ({
  url: "https://github.com/me/notes.git",
  hasToken: true,
  ...extra,
});

test("not available in a browser, or on a shell too old to sync", () => {
  delete (globalThis as { window?: unknown }).window;
  assert.equal(remoteSyncAvailable(), false);
  (globalThis as { window?: unknown }).window = { weaveforge: { fetchTitle: () => Promise.resolve(null) } };
  assert.equal(remoteSyncAvailable(), false);
  fakeShell(reply());
  assert.equal(remoteSyncAvailable(), true);
});

test("saving checks the URL first and stores nothing when it is not https", async () => {
  const calls = fakeShell(reply());
  await assert.rejects(saveRemoteSyncSettings({ url: "http://x.test/r.git", token: "t" }), /https/);
  await assert.rejects(saveRemoteSyncSettings({ url: "https://me:pw@x.test/r.git", token: "" }), /token/i);
  assert.deepEqual(calls, []);
});

test("saving writes the URL, and the token only when one was typed", async () => {
  const calls = fakeShell(reply());
  await saveRemoteSyncSettings({ url: " https://github.com/me/notes.git ", token: "" });
  await saveRemoteSyncSettings({ url: "https://github.com/me/notes.git", token: " ghp_new " });
  assert.deepEqual(calls, [
    ["pref", "vault-git-remote", "https://github.com/me/notes.git"],
    ["pref", "vault-git-remote", "https://github.com/me/notes.git"],
    ["secret", "git-sync-token", "ghp_new"],
  ]);
});

test("saving returns the URL as stored, trimmed", async () => {
  fakeShell(reply());
  assert.equal(await saveRemoteSyncSettings({ url: " https://github.com/me/notes.git ", token: "" }), "https://github.com/me/notes.git");
});

test("forgetting the token clears it, whatever the URL field holds", async () => {
  const calls = fakeShell(reply());
  await forgetRemoteToken();
  assert.deepEqual(calls, [["clear", "git-sync-token"]]);
});

test("disconnecting forgets both the URL and the token", async () => {
  const calls = fakeShell(reply());
  await disconnectRemote();
  assert.deepEqual(calls, [
    ["pref", "vault-git-remote", null],
    ["clear", "git-sync-token"],
  ]);
});

test("forgetting and disconnecting need the shell", async () => {
  delete (globalThis as { window?: unknown }).window;
  await assert.rejects(forgetRemoteToken(), /desktop app/);
  await assert.rejects(disconnectRemote(), /desktop app/);
});

test("each action goes to the shell as named", async () => {
  const calls = fakeShell(reply({ push: { kind: "pushed" } }));
  const result = await folderRemoteSync("push");
  assert.deepEqual(result.push, { kind: "pushed" });
  assert.deepEqual(calls, [["sync", "push"]]);
});

test("without the shell, an action is refused rather than ignored", async () => {
  delete (globalThis as { window?: unknown }).window;
  await assert.rejects(folderRemoteSync("pull"), /desktop app/);
});

test("the outcome reads as one line, a conflict naming its files", () => {
  const base = { url: "https://x.test/r.git", hasToken: false };
  assert.match(describeRemoteSync({ ...base, pull: { kind: "conflict", files: ["a.md", "b.md"] } }), /a\.md, b\.md/);
  assert.match(describeRemoteSync({ ...base, push: { kind: "rejected", reason: "Pull first." } }), /Pull first/);
  assert.equal(
    describeRemoteSync({ ...base, status: { url: "https://x.test/r.git", branch: "main", ahead: 2, behind: 1 } }),
    "2 commits to push, 1 to pull on main.",
  );
  assert.equal(
    describeRemoteSync({ ...base, status: { url: "https://x.test/r.git", branch: "main", ahead: 0, behind: 0 } }),
    "In step with the remote on main.",
  );
  assert.equal(
    describeRemoteSync({ ...base, status: { url: null, branch: "main", ahead: 0, behind: 0 } }),
    "Not connected yet.",
  );
});
