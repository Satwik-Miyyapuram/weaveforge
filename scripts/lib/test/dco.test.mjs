import assert from "node:assert/strict";
import { test } from "node:test";

import { hasOwnSignOff, isBotAuthor, isMergeCommit } from "../dco.mjs";

const DEPENDABOT = "49699333+dependabot[bot]@users.noreply.github.com";

test("a bot address is exempt only on a pull request GitHub says a bot opened (41-07)", () => {
  assert.equal(isBotAuthor(DEPENDABOT, "Bot"), true);
  // Anyone can set any commit email, so the address alone proves nothing.
  assert.equal(isBotAuthor(DEPENDABOT, "User"), false);
  assert.equal(isBotAuthor(DEPENDABOT, undefined), false);
  assert.equal(isBotAuthor(DEPENDABOT, ""), false);
});

test("a person's address is never exempt, even on a bot's pull request", () => {
  assert.equal(isBotAuthor("someone@example.com", "Bot"), false);
});

test("merge commits have more than one parent", () => {
  assert.equal(isMergeCommit("a b"), true);
  assert.equal(isMergeCommit("a"), false);
  assert.equal(isMergeCommit(""), false);
});

test("a sign-off must name the author, matched literally", () => {
  assert.equal(hasOwnSignOff("x\n\nSigned-off-by: A <a+b@x.io>", "a+b@x.io"), true);
  assert.equal(hasOwnSignOff("x\n\nSigned-off-by: A <ab@x.io>", "a+b@x.io"), false);
});
