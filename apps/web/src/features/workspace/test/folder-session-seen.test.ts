import assert from "node:assert/strict";
import { test } from "node:test";

import { forgetSessionSeen, recordSessionSeen, sessionSeen } from "../application/folder-session-seen";

// The in-session record decides which existing files a mirror may rewrite. It starts empty,
// is kept per project, and is dropped whenever the database is replaced or re-imported.

test("the session record starts empty for every project", () => {
  forgetSessionSeen();
  assert.equal(sessionSeen("p1"), undefined);
});

test("the record is kept per project as the mirror leaves it", () => {
  forgetSessionSeen();
  recordSessionSeen("p1", { "a.md": "d1" });
  recordSessionSeen("p2", { "b.md": "d2" });
  assert.deepEqual(sessionSeen("p1"), { "a.md": "d1" });
  assert.deepEqual(sessionSeen("p2"), { "b.md": "d2" });
});

test("forgetting drops every project's record, so nothing existing is rewritten next", () => {
  recordSessionSeen("p1", { "a.md": "d1" });
  forgetSessionSeen();
  assert.equal(sessionSeen("p1"), undefined);
  assert.equal(sessionSeen("p2"), undefined);
});
