import assert from "node:assert/strict";
import { test } from "node:test";

import { parseWorkspaceFile, stampWorkspaceId } from "../../src/workspace/index.js";

test("a hand-written file with frontmatter keeps it, plus an id", () => {
  const stamped = stampWorkspaceId("---\ntitle: My idea\ntags:\n  - a\n---\n\nthe body\n", "n1")!;
  assert.equal(stamped, "---\nweaveforge-id: n1\ntitle: My idea\ntags:\n  - a\n---\n\nthe body\n");
});

test("a file with no frontmatter gets one, and keeps every word of its body", () => {
  const stamped = stampWorkspaceId("# My idea\n\nthe body\n", "n1")!;
  assert.equal(stamped, "---\nweaveforge-id: n1\n---\n\n# My idea\n\nthe body\n");
});

test("a file that already claims an id is left alone", () => {
  const content = "---\nweaveforge-id: n9\ntitle: Mine\n---\n\nbody\n";
  assert.equal(stampWorkspaceId(content, "n1"), null);
});

test("an unclosed fence is body, not frontmatter to edit", () => {
  const stamped = stampWorkspaceId("---\nnot really frontmatter\n", "n1")!;
  assert.ok(stamped.startsWith("---\nweaveforge-id: n1\n---\n\n---\n"));
});

test("CRLF stays CRLF", () => {
  const stamped = stampWorkspaceId("---\r\ntitle: Mine\r\n---\r\n\r\nbody\r\n", "n1")!;
  assert.equal(stamped, "---\r\nweaveforge-id: n1\r\ntitle: Mine\r\n---\r\n\r\nbody\r\n");
  assert.ok(!stamped.includes("\n\n"));
});

test("the stamped file parses back as that entity", () => {
  const stamped = stampWorkspaceId("---\ntitle: My idea\n---\n\nthe body\n", "n1")!;
  const parsed = parseWorkspaceFile("notes/My idea.md", stamped)!;
  assert.equal(parsed.id, "n1");
  assert.equal(parsed.title, "My idea");
  assert.equal(parsed.body.trim(), "the body");
});
