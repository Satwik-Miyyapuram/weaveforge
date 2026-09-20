/**
 * `LoadVaultScreenUseCase`: owned versus pinned, and what `flat` must contain.
 *
 * The screen shows two sections — your notes, and the notes shared with you —
 * and tells them apart by ownership. Ownership used to be derived from a tree
 * field that nothing rendered, which made the field load-bearing in a way no
 * type said. Rebuilding that tree from the *merged* list (the obvious-looking
 * fix for "shared notes are missing from the tree") would then have made every
 * pinned note count as owned, dropping it from both sections at once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { LoadVaultScreenUseCase } from "../application/load-vault-screen.use-case";

const summary = (id: string, title: string) => ({
  id,
  title,
  parentId: null,
  projectId: "proj",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function useCase(options: { pinned?: boolean } = {}) {
  const owned = [summary("mine", "My note")];
  const shared = summary("theirs", "Shared note");
  return new LoadVaultScreenUseCase({
    pages: {
      listSummaries: async () => owned,
      list: async () => owned,
      getById: async (id: string) => (id === "theirs" ? shared : owned[0]),
    } as never,
    lists: { list: async () => [] } as never,
    listItems: { listItemsForLists: async () => [] } as never,
    pins: {
      listForProject: async () =>
        options.pinned
          ? [{ id: "pin-1", projectId: "proj", resourceType: "vault_page", resourceId: "theirs", ownerId: "alice" }]
          : [],
    } as never,
    shares: {
      listSharedWithMe: async () =>
        options.pinned
          ? [
              {
                id: "s1",
                ownerId: "alice",
                recipientId: "me",
                resourceType: "vault_page",
                resourceId: "theirs",
                access: "edit",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ]
          : [],
    } as never,
  });
}

test("vault screen: the flat list holds owned notes", async () => {
  const data = await useCase().execute();
  assert.deepEqual(data.flat.map((page) => page.id), ["mine"]);
  assert.deepEqual([...data.ownedIds], ["mine"]);
});

test("vault screen: a pinned note is listed but is not owned", async () => {
  const data = await useCase({ pinned: true }).execute();

  assert.deepEqual(
    data.flat.map((page) => page.id),
    ["mine", "theirs"],
    "a note shared with you belongs in the list",
  );
  assert.equal(data.ownedIds.has("theirs"), false, "…and it is not one of yours");
  assert.equal(data.ownedIds.has("mine"), true);
  assert.equal(data.pinnedSharedBy.get("theirs"), "alice");
  assert.equal(data.vaultCanEdit.get("theirs"), true);
});
