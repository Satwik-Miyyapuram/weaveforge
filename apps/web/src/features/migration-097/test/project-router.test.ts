import assert from "node:assert/strict";
import test from "node:test";
import { createProjectRouter } from "../infrastructure/project-router";

const router = () =>
  createProjectRouter([
    { id: "main", folder: "thesis--aaaaaa" },
    { id: "side", folder: "side--bbbbbb" },
  ]);

test("project router: with no projects every row goes to the root", () => {
  const r = createProjectRouter([]);
  assert.deepEqual(r.folders, [""]);
  assert.equal(r.folderOf("papers", { id: "p", projectId: "x" }), "");
});

test("project router: a row goes to its project's folder", () => {
  assert.equal(router().folderOf("papers", { id: "p", projectId: "side" }), "side--bbbbbb");
});

test("project router: a row with no project, or one not exported, goes to the main project", () => {
  const r = router();
  assert.equal(r.folderOf("papers", { id: "p1" }), "thesis--aaaaaa");
  assert.equal(r.folderOf("papers", { id: "p2", projectId: "gone" }), "thesis--aaaaaa");
});

test("project router: a child follows its parent's folder over its own projectId", () => {
  const r = router();
  r.folderOf("papers", { id: "p", projectId: "side" });
  assert.equal(r.folderOf("annotations", { id: "a", paperId: "p", projectId: "main" }), "side--bbbbbb");
  r.folderOf("readingLists", { id: "l", projectId: "side" });
  r.folderOf("readingListItems", { id: "i", listId: "l" });
  assert.equal(r.folderOf("screening", { id: "s", itemId: "i" }), "side--bbbbbb");
});

test("project router: root kinds stay at the root, and a comment with no home stays at the root", () => {
  const r = router();
  assert.equal(r.folderOf("settings", { id: "s", projectId: "side" }), "");
  assert.equal(r.folderOf("quotationTypes", { id: "q" }), "");
  assert.equal(r.folderOf("comments", { id: "c", resourceId: "nowhere" }), "");
});
