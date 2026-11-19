import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forgetSessionSeen,
  recordSessionSeen,
  sessionGeneration,
  sessionSeen,
} from "../application/folder-session-seen";

// The in-session record decides which existing files a mirror may rewrite. It starts empty,
// is kept per project, and is dropped whenever the database is replaced or re-imported.

test("the session record starts empty for every project", () => {
  forgetSessionSeen();
  assert.equal(sessionSeen("p1"), undefined);
});

test("the record is kept per project as the mirror leaves it", () => {
  forgetSessionSeen();
  const started = sessionGeneration();
  recordSessionSeen("p1", { "a.md": "d1" }, started);
  recordSessionSeen("p2", { "b.md": "d2" }, started);
  assert.deepEqual(sessionSeen("p1"), { "a.md": "d1" });
  assert.deepEqual(sessionSeen("p2"), { "b.md": "d2" });
});

test("forgetting drops every project's record, so nothing existing is rewritten next", () => {
  forgetSessionSeen();
  recordSessionSeen("p1", { "a.md": "d1" }, sessionGeneration());
  forgetSessionSeen();
  assert.equal(sessionSeen("p1"), undefined);
  assert.equal(sessionSeen("p2"), undefined);
});

test("a mirror that started before a forget cannot record its stale digests after it", () => {
  forgetSessionSeen();
  const started = sessionGeneration();
  // The import replaces the database while that mirror is still running.
  forgetSessionSeen();
  recordSessionSeen("p1", { "a.md": "pre-import" }, started);
  assert.equal(sessionSeen("p1"), undefined);
});

test("a mirror that started after the forget records normally", () => {
  forgetSessionSeen();
  const started = sessionGeneration();
  recordSessionSeen("p1", { "a.md": "post-import" }, started);
  assert.deepEqual(sessionSeen("p1"), { "a.md": "post-import" });
});
