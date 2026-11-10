import assert from "node:assert/strict";
import { before, test } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

function createdPageOf<P extends { id: string; title: string; parentId?: string | null }>(
  item: { kind: string; payload?: Record<string, unknown> | null },
  pages: readonly P[],
): P | null {
  const index = readyCore().createdPageIndex(item, pages) as number | null;
  return index === null ? null : (pages[index] ?? null);
}

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
