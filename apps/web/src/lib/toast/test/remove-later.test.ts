/** The shared delete-with-Undo used by cards and pages (D10, D-07). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { removeLater } from "../remove-later";
import { toasts } from "../toast-store";

const settle = () => new Promise((r) => setTimeout(r, 0));

test("hides at once, runs onHidden, and deletes then reloads when the toast closes", async () => {
  const log: string[] = [];
  removeLater({
    key: "exp:1",
    message: '"Run A" deleted',
    remove: async () => void log.push("remove"),
    onHidden: () => log.push("hidden"),
    onDeleted: () => log.push("reload"),
  });
  assert.deepEqual(log, ["hidden"]);
  assert.ok(toasts.hiddenKeys().has("exp:1"));
  assert.equal(toasts.snapshot().at(-1)?.message, '"Run A" deleted');
  toasts.flush();
  await settle();
  assert.deepEqual(log, ["hidden", "remove", "reload"]);
  assert.equal(toasts.hiddenKeys().has("exp:1"), false);
});

test("Undo deletes nothing and shows the item again", async () => {
  let removed = 0;
  removeLater({ key: "exp:2", message: "x", remove: async () => void removed++ });
  toasts.undoLatest();
  toasts.flush();
  await settle();
  assert.equal(removed, 0);
  assert.equal(toasts.hiddenKeys().has("exp:2"), false);
});

test("a failed delete still reloads and says what failed", async () => {
  let reloads = 0;
  removeLater({ key: "exp:3", message: "x", remove: () => Promise.reject(new Error("offline")), onDeleted: () => void reloads++ });
  toasts.flush();
  await settle();
  assert.equal(reloads, 1);
  assert.match(toasts.snapshot().at(-1)?.message ?? "", /Could not delete: offline/);
  toasts.flush();
});
