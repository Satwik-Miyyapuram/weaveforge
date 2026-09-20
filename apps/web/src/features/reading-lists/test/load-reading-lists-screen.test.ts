import assert from "node:assert/strict";
import test from "node:test";

import type { LibraryPin, ReadingList, Share } from "@weaveforge/core";
import { buildListTree, loadPinnedScreenData } from "@weaveforge/core";

/**
 * `BUG-01`'s sibling in the reading lists: the tree came from `owned`.
 *
 * Same defect as the report screen, same fix — build the tree from the merged set
 * — and the same reason it matters: the tree is what a reader navigates, so a
 * shared list was in the flat list and absent from the only projection the screen
 * paints.
 */

const SHARED = "shared-list";

function list(id: string, over: Partial<ReadingList> = {}): ReadingList {
  return {
    id,
    name: `List ${id}`,
    parentId: null,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as ReadingList;
}

const pin = (resourceId: string): LibraryPin => ({
  id: `pin-${resourceId}`,
  userId: "me",
  projectId: "p1",
  resourceType: "reading_list",
  resourceId,
  ownerId: "alice",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const share = (resourceId: string): Share => ({
  id: `share-${resourceId}`,
  ownerId: "alice",
  recipientId: "me",
  resourceType: "reading_list",
  resourceId,
  access: "comment",
  createdAt: "2026-01-01T00:00:00.000Z",
});

/** What the loader does: merge, then build the tree. */
async function load(owned: ReadingList[], pinned: string[], parentId: string | null = null) {
  const merged = await loadPinnedScreenData(
    {
      pins: { listForProject: async () => pinned.map(pin) },
      shares: { listSharedWithMe: async () => pinned.map(share) },
    },
    {
      resourceType: "reading_list",
      owned,
      loadById: async (id) => list(id, { name: `Loaded ${id}`, parentId: parentId ?? undefined }),
    },
  );
  return { merged, tree: buildListTree(merged.items) };
}

test("a shared list is in the tree, not only in the flat list", async () => {
  const { merged, tree } = await load([list("mine")], [SHARED]);

  assert.ok(merged.items.some((item) => item.id === SHARED));
  assert.ok(
    tree.some((node) => node.list.id === SHARED),
    "the tree a reader navigates has to hold it too",
  );
});

test("a shared sub-list sits under the list it names", async () => {
  const { tree } = await load([list("parent")], [SHARED], "parent");

  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0]!.children.map((child) => child.list.id), [SHARED]);
});

test("an empty merge still produces the owned tree", async () => {
  const { tree } = await load([list("a"), list("b")], []);
  assert.deepEqual(tree.map((node) => node.list.id).sort(), ["a", "b"]);
});
