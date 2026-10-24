/**
 * `ReportFacade.removeSection` deletes a whole subtree (30-07, 30-20).
 *
 * The database cascades a section's delete to its subsections, so one row
 * delete removes the subtree atomically. The images in every removed
 * section's notes are cleaned too, and only after the row is gone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportSection, ReportSectionTreeNode } from "@weaveforge/core";

import { ReportFacade } from "../facades/report";

const sec = (id: string, notes?: string): ReportSection =>
  ({ id, title: id, status: "drafting", wordCount: 0, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", notes }) as ReportSection;

const tree: ReportSectionTreeNode[] = [
  {
    section: sec("root", "![](reportimg:u/root/a.png)"),
    children: [
      { section: sec("child", "![](reportimg:u/child/b.png) ![](reportimg:u/root/a.png)"), children: [{ section: sec("leaf", "![](reportimg:u/leaf/c.png)"), children: [] }] },
    ],
  },
  { section: sec("other", "![](reportimg:u/other/d.png)"), children: [] },
];

function harness(opts: { deleteFails?: boolean; removeFails?: boolean; treeFails?: boolean } = {}) {
  const calls: string[] = [];
  const facade = new ReportFacade({
    load: {} as never,
    sections: {
      getTree: async () => {
        if (opts.treeFails) throw new Error("offline");
        return tree;
      },
    } as never,
    manageReportSection: {
      remove: async (id: string) => {
        calls.push(`delete:${id}`);
        if (opts.deleteFails) throw new Error("row delete failed");
      },
    } as never,
    images: {
      remove: async (path: string) => {
        calls.push(`blob:${path}`);
        if (opts.removeFails) throw new Error("storage down");
      },
    } as never,
  });
  return { facade, calls };
}

test("deleting a section deletes one row and the images of its whole subtree", async () => {
  const { facade, calls } = harness();
  await facade.removeSection(tree[0]!.section);
  assert.equal(calls[0], "delete:root");
  assert.deepEqual(calls.filter((c) => c.startsWith("delete:")), ["delete:root"]);
  assert.deepEqual(
    calls.filter((c) => c.startsWith("blob:")).sort(),
    ["blob:u/child/b.png", "blob:u/leaf/c.png", "blob:u/root/a.png"],
  );
});

test("a failed row delete keeps every image and rejects", async () => {
  const { facade, calls } = harness({ deleteFails: true });
  await assert.rejects(facade.removeSection(tree[0]!.section), /row delete failed/);
  assert.deepEqual(calls, ["delete:root"]);
});

test("a failed image removal does not fail the delete", async () => {
  const { facade, calls } = harness({ removeFails: true });
  await facade.removeSection(tree[0]!.children[0]!.section);
  assert.deepEqual(calls.filter((c) => c.startsWith("delete:")), ["delete:child"]);
  assert.deepEqual(calls.filter((c) => c.startsWith("blob:")).sort(), ["blob:u/child/b.png", "blob:u/leaf/c.png", "blob:u/root/a.png"]);
});

test("a section not in the tree still has its own images cleaned", async () => {
  const { facade, calls } = harness({ treeFails: true });
  await facade.removeSection(sec("solo", "![](reportimg:u/solo/e.png)"));
  assert.deepEqual(calls, ["delete:solo", "blob:u/solo/e.png"]);
});
