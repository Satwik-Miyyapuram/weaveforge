import assert from "node:assert/strict";
import test from "node:test";
import { formatQuoteCiteClipboard } from "../application/sync-annotation-excerpts";

test("formats multiline annotation text as a quote followed by a paper wikilink", () => {
  assert.equal(
    formatQuoteCiteClipboard("first\nsecond", "Paper title"),
    "> first\n> second\n\n[[Paper title]]\n",
  );
});
