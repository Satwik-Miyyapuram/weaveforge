import assert from "node:assert/strict";
import test from "node:test";

import { createdPageOf, splitProposalContent } from "../application/proposal-preview";

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

test("an approved new note is found by its title under its parent (E27)", () => {
  const pages = [
    { id: "a", title: "Adam", parentId: "other" },
    { id: "b", title: "Adam", parentId: "wiki" },
    { id: "c", title: "GAN", parentId: "wiki" },
  ];
  const item = { kind: "create_vault_note", payload: { title: " Adam ", parentId: "wiki" } };
  assert.equal(createdPageOf(item, pages)?.id, "b");
  assert.equal(createdPageOf({ kind: "create_vault_note", payload: { title: "Adam" } }, pages), null);
  assert.equal(createdPageOf({ kind: "append_paper_note", payload: { title: "GAN", parentId: "wiki" } }, pages), null);
  assert.equal(createdPageOf({ kind: "create_vault_note", payload: {} }, pages), null);
});
