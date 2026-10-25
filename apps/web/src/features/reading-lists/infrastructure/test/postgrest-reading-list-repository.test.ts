import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestReadingListRepository } from "../postgrest-reading-list-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";

/**
 * Reading-list reads over the real local client, with every select answered
 * by fixed rows. Names are encrypted at rest, so `nameContains` filters after
 * the rows are read (36-15), the same way the in-memory repository does.
 */
function returning(found: Record<string, unknown>[]) {
  const run: LocalQuery = async () => found as never;
  return new PostgrestReadingListRepository(
    createLocalClient(run) as unknown as SupabaseClient,
    { projectId: "p1" },
  );
}

function listRow(id: string, name: string, parent: string | null = null) {
  return { id, name, description: null, parent_id: parent, sort_order: 0, color: null, created_at: "2026-01-01T00:00:00Z" };
}

test("reading lists: nameContains keeps names containing it, ignoring case", async () => {
  const found = [listRow("a", "Core Papers"), listRow("b", "Later"), listRow("c", "core methods")];
  const names = (await returning(found).list({ nameContains: "CORE" })).map((l) => l.name);
  assert.deepEqual(names, ["Core Papers", "core methods"]);
});

test("reading lists: no nameContains keeps every row", async () => {
  const found = [listRow("a", "Core Papers"), listRow("b", "Later")];
  assert.equal((await returning(found).list()).length, 2);
});

test("reading lists: the tree nests children under their parent (36-16)", async () => {
  const found = [listRow("a", "Root"), listRow("b", "Child", "a")];
  const tree = await returning(found).getTree();
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.list.id, "a");
  assert.deepEqual(tree[0]!.children.map((c) => c.list.id), ["b"]);
});
