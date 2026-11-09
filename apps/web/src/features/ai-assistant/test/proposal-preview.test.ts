import assert from "node:assert/strict";
import test from "node:test";

import { createdPageOf } from "../application/proposal-preview";

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
