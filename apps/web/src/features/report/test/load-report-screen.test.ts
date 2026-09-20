import assert from "node:assert/strict";
import test from "node:test";

import type { LibraryPin, ReportSection, Share } from "@weaveforge/core";
import { loadPinnedScreenData } from "@weaveforge/core";
import { buildSectionTree } from "@weaveforge/core";

/**
 * The report tree is built from the **merged** set.
 *
 * It used to be built from `owned` while `flat` carried the merge, so a section
 * shared with the project appeared in one projection and not the other — and the
 * tree is the one the screen paints, so the shared section was effectively
 * invisible. Two answers to "what is in this report" from one load.
 *
 * These exercise the loader's own composition (merge, then tree) rather than the
 * whole use case, because that composition is the fix.
 */

const SHARED = "shared-section";

function section(id: string, over: Partial<ReportSection> = {}): ReportSection {
  return {
    id,
    title: `Section ${id}`,
    parentId: null,
    sortOrder: 0,
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as ReportSection;
}

function pin(resourceId: string): LibraryPin {
  return {
    id: `pin-${resourceId}`,
    userId: "me",
    projectId: "p1",
    resourceType: "report_section",
    resourceId,
    ownerId: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function share(resourceId: string): Share {
  return {
    id: `share-${resourceId}`,
    ownerId: "alice",
    recipientId: "me",
    resourceType: "report_section",
    resourceId,
    access: "comment",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** What the loader does: merge the pinned/shared rows, then build the tree. */
async function load(owned: ReportSection[], pinned: string[], pinnedParentId: string | null = null) {
  const merged = await loadPinnedScreenData(
    {
      pins: { listForProject: async () => pinned.map(pin) },
      shares: { listSharedWithMe: async () => pinned.map(share) },
    },
    {
      resourceType: "report_section",
      owned,
      // What a pinned section loads as: whatever the row holds, which is how it
      // knows where in the tree it belongs.
      loadById: async (id) => section(id, { title: `Loaded ${id}`, parentId: pinnedParentId ?? undefined }),
    },
  );
  return { merged, tree: buildSectionTree(merged.items) };
}

/** Every id in a tree, at any depth. */
function ids(tree: { section: { id: string }; children: unknown[] }[]): string[] {
  return tree.flatMap((node) => [
    node.section.id,
    ...ids(node.children as { section: { id: string }; children: unknown[] }[]),
  ]);
}

test("a shared section is in the tree, not only in the flat list", async () => {
  const { merged, tree } = await load([section("mine")], [SHARED]);

  assert.ok(merged.items.some((item) => item.id === SHARED), "the merge has always included it");
  assert.ok(ids(tree).includes(SHARED), "and now the tree does too");
});

test("a shared child sits under its parent when the parent is owned", async () => {
  // The tree is the point: a shared section that belongs under one of my own
  // sections should appear *under it*, not at the root — the tree is built from
  // the rows, so a parentId the merge carried has to be honoured.
  const { tree } = await load([section("parent")], [SHARED], "parent");

  assert.equal(tree.length, 1, "one root: my own section");
  assert.equal(tree[0]!.section.id, "parent");
  assert.deepEqual(tree[0]!.children.map((child) => child.section.id), [SHARED]);
});

test("the tree still holds only what the merge returned", async () => {
  // No duplicates and no invented rows: the tree is built from one set.
  const { merged, tree } = await load([section("a"), section("b")], []);
  assert.deepEqual(ids(tree).sort(), ["a", "b"]);
  assert.deepEqual(merged.items.map((item) => item.id).sort(), ["a", "b"]);
});
