import { test } from "node:test";
import assert from "node:assert/strict";

import { isPaperPage } from "../ui/back-to-paper";

test("the paper page the reader was opened from is that paper's page", () => {
  assert.equal(isPaperPage("https://app.local/papers?paper=p1", "p1"), true);
  assert.equal(isPaperPage("https://app.local/papers?status=read&paper=p%201", "p 1"), true);
});

test("any other entry, or none, is not the paper page", () => {
  assert.equal(isPaperPage(undefined, "p1"), false);
  assert.equal(isPaperPage("https://app.local/papers", "p1"), false);
  assert.equal(isPaperPage("https://app.local/papers?paper=p2", "p1"), false);
  assert.equal(isPaperPage("https://app.local/workspace?paper=p1", "p1"), false);
  assert.equal(isPaperPage("not a url", "p1"), false);
});
