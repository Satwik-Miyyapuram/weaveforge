/**
 * The "Backs up to" link of the workspace folder's git remote (F97-P2 item 5).
 *
 * Only http(s) remotes make a link, so a `javascript:` or `file:` remote can
 * never become an href. An scp-style remote (`git@host:owner/repo`) is shown
 * as its https page on github.com; other scp hosts get no link.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { backupTarget } from "@/features/settings/ui/folder-remote-sync-panel";

test("F97-P2-5: a github https remote links to its repository page", () => {
  assert.deepEqual(backupTarget("https://github.com/o/r.git"), {
    label: "o/r",
    href: "https://github.com/o/r",
  });
});

test("F97-P2-5: an scp-style remote links to the https page of the same repository", () => {
  assert.deepEqual(backupTarget("git@github.com:o/r.git"), {
    label: "o/r",
    href: "https://github.com/o/r",
  });
  // A host other than github.com may not serve the repository over https at that
  // path, so no link is guessed for it.
  assert.equal(backupTarget("git@git.example.org:team/notes.git"), null);
});

test("F97-P2-5: credentials in an https remote are not carried into the link", () => {
  assert.deepEqual(backupTarget("https://user:secret@git.example.org/o/r.git"), {
    label: "git.example.org/o/r",
    href: "https://git.example.org/o/r",
  });
});

test("F97-P2-5: a remote that is not http(s) or scp-style makes no link", () => {
  assert.equal(backupTarget("javascript:alert(1)"), null);
  assert.equal(backupTarget("file:///etc/passwd"), null);
  assert.equal(backupTarget("ssh://git@host/o/r.git"), null);
  assert.equal(backupTarget("not a url"), null);
});
