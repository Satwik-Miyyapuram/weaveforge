import assert from "node:assert/strict";
import test from "node:test";

import { splitProposalContent } from "../application/proposal-preview";

test("an MCP draft gives its summary as the title and its reason apart", () => {
  const split = splitProposalContent("**Edit note: Ideas**\n\nWhy: Tighter.\n\nbody:\n\n# Ideas\n- one");
  assert.deepEqual(split, { title: "Edit note: Ideas", why: "Tighter.", body: "body:\n\n# Ideas\n- one" });
});

test("plain content keeps everything in the body", () => {
  assert.deepEqual(splitProposalContent("Just an addition."), { title: null, why: null, body: "Just an addition." });
});

test("bold text that is not the first line stays in the body", () => {
  const split = splitProposalContent("Intro\n\n**Not a title**");
  assert.equal(split.title, null);
  assert.equal(split.body, "Intro\n\n**Not a title**");
});
