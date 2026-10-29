import assert from "node:assert/strict";
import { test } from "node:test";

import { NoOpWorkspaceGit } from "../../src/workspace/git-port.js";
import {
  checkGitRemoteUrl,
  checkSyncBranch,
  describePull,
  describePush,
  redactSecret,
  SYNC_AUTHOR,
} from "../../src/workspace/git-remote.js";

test("an https remote URL is accepted and normalised", () => {
  assert.deepEqual(checkGitRemoteUrl("  https://github.com/me/notes.git "), {
    ok: true,
    url: "https://github.com/me/notes.git",
  });
});

test("non-https, credentialed, empty or path-less remote URLs are refused", () => {
  for (const raw of [
    "",
    "   ",
    undefined,
    42,
    "not a url",
    "http://github.com/me/notes.git",
    "git@github.com:me/notes.git",
    "file:///C:/repos/notes",
    "ssh://git@github.com/me/notes.git",
    "https://me:ghp_secret@github.com/me/notes.git",
    "https://ghp_secret@github.com/me/notes.git",
    "https://github.com",
    "https://github.com/",
  ]) {
    const result = checkGitRemoteUrl(raw);
    assert.equal(result.ok, false, `expected ${String(raw)} to be refused`);
  }
});

test("a token is never echoed back in the refusal for a credentialed URL", () => {
  const result = checkGitRemoteUrl("https://me:ghp_secret@github.com/me/notes.git");
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("ghp_secret"));
});

test("branch names: default, safe names, and refusals", () => {
  assert.equal(checkSyncBranch(undefined), "main");
  assert.equal(checkSyncBranch(""), "main");
  assert.equal(checkSyncBranch("thesis/draft-2"), "thesis/draft-2");
  for (const bad of ["-x", "a..b", "a b", "x.lock", "../etc", 7, "a;rm"]) {
    assert.equal(checkSyncBranch(bad), null, `expected ${String(bad)} to be refused`);
  }
});

test("redactSecret removes every occurrence of the token, and leaves text alone without one", () => {
  assert.equal(redactSecret("auth abc failed for abc", "abc"), "auth *** failed for ***");
  assert.equal(redactSecret("nothing here", undefined), "nothing here");
  assert.equal(redactSecret("nothing here", ""), "nothing here");
});

test("pull and push outcomes read as one sentence; conflicts name the files and say nothing changed", () => {
  assert.equal(describePull({ kind: "up-to-date" }), "Already up to date.");
  const many = describePull({ kind: "conflict", files: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"] });
  assert.match(many, /6 files/);
  assert.match(many, /a\.md, b\.md, c\.md, d\.md, e\.md, …/);
  assert.match(many, /left as they were/);
  assert.match(describePull({ kind: "conflict", files: ["a.md"] }), /1 file changed/);
  assert.equal(describePush({ kind: "rejected", reason: "pull first" }), "Not pushed: pull first");
});

test("the no-git backend reports no remote and refuses to sync", async () => {
  const git = new NoOpWorkspaceGit();
  assert.deepEqual(await git.remoteStatus({ url: "https://x.test/r.git" }), {
    url: null,
    branch: "main",
    ahead: 0,
    behind: 0,
  });
  await assert.rejects(git.pull({ url: "https://x.test/r.git" }, SYNC_AUTHOR), /history/);
  await assert.rejects(git.push({ url: "https://x.test/r.git" }, SYNC_AUTHOR), /history/);
  await assert.rejects(git.connect({ url: "https://x.test/r.git" }, SYNC_AUTHOR), /history/);
});
