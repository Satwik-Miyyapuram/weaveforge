/**
 * mergePinnedScreenData: what six screens rely on being true.
 *
 * This is the only place that knows how to fold pinned and shared rows into an
 * owned list, and six screen use-cases call it. It had no test at all, which is
 * why a compensation for its O(pins × shares) scan could be written that
 * silently dropped "share everything" grants — the second loop exists precisely
 * to cover the blanket case the first loop skips (`shareCoversResource` matches
 * `resourceId === null`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergePinnedScreenData } from "../../../src/features/library/application/merge-pinned-screen-data.js";
import type { Share, ShareAccess } from "../../../src/features/sharing/domain/share.js";

interface Summary {
  id: string;
  title: string;
}

function share(input: {
  resourceId: string | null;
  ownerId?: string;
  access?: ShareAccess;
  resourceType?: Share["resourceType"];
}): Share {
  return {
    id: `s-${input.resourceId ?? "all"}-${input.ownerId ?? "alice"}-${input.access ?? "comment"}`,
    ownerId: input.ownerId ?? "alice",
    recipientId: "me",
    resourceType: input.resourceType ?? "paper",
    resourceId: input.resourceId,
    access: input.access ?? "comment",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const pin = (resourceId: string, ownerId = "alice") => ({
  id: `pin-${resourceId}`,
  projectId: "proj",
  resourceType: "paper" as const,
  resourceId,
  ownerId,
});

async function merge(input: {
  owned: Summary[];
  pins: ReturnType<typeof pin>[];
  shares: Share[];
}) {
  return mergePinnedScreenData<Summary, Summary>({
    resourceType: "paper",
    owned: input.owned,
    pins: input.pins,
    shares: input.shares,
    loadById: async (id) => ({ id, title: `loaded ${id}` }),
  });
}

test("merge: a pinned resource the project does not own joins the list", async () => {
  const merged = await merge({
    owned: [{ id: "p1", title: "Owned" }],
    pins: [pin("p9")],
    shares: [share({ resourceId: "p9" })],
  });

  assert.deepEqual(
    merged.items.map((item) => item.id),
    ["p1", "p9"],
    "the screen's own rows keep their order and the extra arrives after them",
  );
  assert.equal(merged.pinnedSharedBy.get("p9"), "alice");
});

test("merge: a blank share grants comment and edit on every pin by that owner", async () => {
  // The case a resource-id index alone would lose: `resourceId === null` means
  // "everything of this type owned by me", and the recipient pinned one of them.
  const merged = await merge({
    owned: [],
    pins: [pin("p9")],
    shares: [share({ resourceId: null, access: "edit" })],
  });

  assert.equal(merged.canComment.get("p9"), true);
  assert.equal(merged.canEdit.get("p9"), true);
});

test("merge: grants are indexed by resource id, so access follows the row", async () => {
  // Documents the first loop's actual semantics rather than an aspiration: it
  // calls `shareAllowsComment(s, type, s.resourceId, s.ownerId)`, which is
  // tautological in its resource and owner arguments — so a share addressed to
  // this recipient marks the row grantable whatever owner it names. Two owners
  // cannot collide on one uuid, so this is latent rather than exploitable. The
  // owner-scoped grant index that replaces the second scan (audit PERF-02) is
  // where it should be tightened, and this assertion should change with it.
  const merged = await merge({
    owned: [],
    pins: [pin("p9", "alice")],
    shares: [share({ resourceId: "p9", ownerId: "bob", access: "edit" })],
  });

  assert.equal(merged.canEdit.get("p9"), true);
  assert.equal(
    merged.pinnedSharedBy.get("p9"),
    "alice",
    "the pin is still attributed to its own owner, not to the sharer",
  );
});

test("merge: view access is neither comment nor edit", async () => {
  const merged = await merge({
    owned: [],
    pins: [pin("p9")],
    shares: [share({ resourceId: "p9", access: "view" })],
  });

  assert.equal(merged.canComment.get("p9"), false);
  assert.equal(merged.canEdit.get("p9"), false);
});

test("merge: a pin the project already owns is not listed twice", async () => {
  const merged = await merge({
    owned: [{ id: "p1", title: "Owned" }],
    pins: [pin("p1")],
    shares: [],
  });

  assert.deepEqual(
    merged.items.map((item) => item.id),
    ["p1"],
  );
  assert.equal(
    merged.pinnedSharedBy.get("p1"),
    "alice",
    "it is still reported as pinned, so the screen can badge it",
  );
});

test("merge: a grant for another resource type does not grant access here", async () => {
  const merged = await merge({
    owned: [],
    pins: [pin("p9")],
    shares: [share({ resourceId: "p9", resourceType: "experiment", access: "edit" })],
  });

  // An explicit `false`, not an absent key: the first loop records an entry for
  // every shared row it walked. Consumers read `.get(id) ?? false` and
  // `!map.get(id)`, so the two spellings are the same answer to them.
  assert.equal(merged.canComment.get("p9"), false);
  assert.equal(merged.canEdit.get("p9"), false);
});
