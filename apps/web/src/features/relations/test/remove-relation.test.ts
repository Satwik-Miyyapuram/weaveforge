/** Deleting a graph relation: gone at once, deleted when the Undo toast closes (D10, D-07). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { toasts } from "@/lib/toast/toast-store";
import { relationKey, removeRelationLater } from "../ui/remove-relation";

const settle = () => new Promise((r) => setTimeout(r, 0));

test("the relation hides at once and is deleted when the toast closes", async () => {
  const removed: string[] = [];
  let reloads = 0;
  removeRelationLater("r1", () => void reloads++, async (id) => void removed.push(id));
  assert.ok(toasts.hiddenKeys().has(relationKey("r1")));
  assert.equal(toasts.snapshot().at(-1)?.message, "Relation deleted");
  assert.deepEqual(removed, []);
  toasts.flush();
  await settle();
  assert.deepEqual(removed, ["r1"]);
  assert.equal(reloads, 1);
});

test("Undo keeps the relation", async () => {
  const removed: string[] = [];
  removeRelationLater("r2", () => {}, async (id) => void removed.push(id));
  toasts.undoLatest();
  toasts.flush();
  await settle();
  assert.deepEqual(removed, []);
  assert.equal(toasts.hiddenKeys().has(relationKey("r2")), false);
});
