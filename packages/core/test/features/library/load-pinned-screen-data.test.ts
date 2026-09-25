/**
 * loadPinnedScreenData: the preamble six screens shared, and the one argument
 * that must not be spelled twice.
 *
 * Each screen used to fetch its own pins and shares — `listForProject()` and
 * `listSharedWithMe(resourceType)` with an empty-list fallback for each — and
 * then hand the same resource type to `mergePinnedScreenData` a line later. The
 * type appearing in two places is the hazard: a mismatch merges against another
 * type's shares, and both calls succeed, so the screen's comment and edit rights
 * are simply wrong with nothing to show for it. These tests pin the pairing, the
 * fallback, and the pass-through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadPinnedScreenData } from "../../../src/features/library/application/load-pinned-screen-data.js";
import type { LibraryPin } from "../../../src/features/library/domain/library-pin.js";
import type { Share } from "../../../src/features/sharing/domain/share.js";

interface Item {
  id: string;
  title: string;
}

const item = (id: string, title = `Item ${id}`): Item => ({ id, title });

function pin(resourceType: LibraryPin["resourceType"], resourceId: string): LibraryPin {
  return { id: `pin-${resourceId}`, projectId: "proj", resourceType, resourceId, ownerId: "alice" };
}

function share(resourceType: Share["resourceType"], resourceId: string): Share {
  return {
    id: `share-${resourceId}`,
    ownerId: "alice",
    recipientId: "me",
    resourceType,
    resourceId,
    access: "comment",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("pins and shares are read under the one resource type, and it is the caller's", async () => {
  const asked: (string | undefined)[] = [];
  const merged = await loadPinnedScreenData(
    {
      pins: {
        listForProject: async () => [pin("paper", "p1"), pin("milestone", "m1")],
      },
      shares: {
        listSharedWithMe: async (resourceType) => {
          asked.push(resourceType);
          return [share("paper", "p1"), share("milestone", "m1")];
        },
      },
    },
    {
      resourceType: "paper",
      owned: [item("p1")],
      loadById: async (id) => item(id),
    },
  );

  assert.deepEqual(asked, ["paper"], "the repository is asked for this screen's type, not all of them");
  assert.deepEqual([...merged.pinnedSharedBy.keys()], ["p1"], "the milestone pin is another screen's");
  assert.deepEqual(
    [...merged.items].map((x) => x.id),
    ["p1"],
  );
});

test("a deployment with no pins or shares still gets a merge", async () => {
  // Both repositories are genuinely optional: a local copy has neither.
  const merged = await loadPinnedScreenData(
    {},
    {
      resourceType: "paper",
      owned: [item("p1")],
      loadById: async (id) => item(id),
    },
  );

  assert.deepEqual(
    [...merged.items].map((x) => x.id),
    ["p1"],
  );
  assert.equal(merged.pinnedSharedBy.size, 0);
  assert.equal(merged.canComment.size, 0);
});

test("the pass-through keeps the full row for the projection the screen paints", async () => {
  // The merged result is `TSummary[]`, and a pinned row the caller does not own
  // has to arrive in that shape: the two type parameters are what stop a summary
  // being treated as a full entity and written back.
  const merged = await loadPinnedScreenData(
    {
      pins: { listForProject: async () => [pin("paper", "pinned")] },
      shares: { listSharedWithMe: async () => [] },
    },
    {
      resourceType: "paper",
      owned: [item("owned")],
      loadById: async (id) => item(id, `Loaded ${id}`),
    },
  );

  assert.deepEqual(
    [...merged.items].map((x) => [x.id, x.title]),
    [
      ["owned", "Item owned"],
      ["pinned", "Loaded pinned"],
    ],
    "the pinned row was loaded through loadById, not invented",
  );
});
