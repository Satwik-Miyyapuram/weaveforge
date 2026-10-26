/** A duplicate merge under rule D-07: the copies go at once, the merge runs when the Undo toast closes. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { toasts } from "@/lib/toast/toast-store";
import { mergeLater } from "../merge-later";
import { paperKey } from "../remove-paper";

const settle = () => new Promise((r) => setTimeout(r, 0));

test("hides only the copies merged away, then merges and reloads when the toast closes", async () => {
  const log: string[] = [];
  mergeLater({
    keepId: "b",
    ids: ["a", "b", "c"],
    merge: async () => void log.push("merge"),
    onMerged: () => void log.push("reload"),
  });
  const hidden = toasts.hiddenKeys();
  assert.ok(hidden.has(paperKey("a")) && hidden.has(paperKey("c")));
  assert.equal(hidden.has(paperKey("b")), false, "the kept copy stays");
  assert.equal(toasts.snapshot().at(-1)?.message, "2 duplicates merged");
  assert.deepEqual(log, []);
  toasts.flush();
  await settle();
  assert.deepEqual(log, ["merge", "reload"]);
  assert.equal(toasts.hiddenKeys().has(paperKey("a")), false);
});

test("Undo merges nothing and brings the copies back", async () => {
  let merged = 0;
  mergeLater({ keepId: "x", ids: ["x", "y"], merge: async () => void merged++, onMerged: () => {} });
  assert.equal(toasts.snapshot().at(-1)?.message, "Duplicate merged");
  toasts.undoLatest();
  toasts.flush();
  await settle();
  assert.equal(merged, 0);
  assert.equal(toasts.hiddenKeys().has(paperKey("y")), false);
});

test("a failed merge reloads and says the merge failed", async () => {
  let reloads = 0;
  mergeLater({
    keepId: "p",
    ids: ["p", "q"],
    merge: () => Promise.reject(new Error("offline")),
    onMerged: () => void reloads++,
  });
  toasts.flush();
  await settle();
  assert.equal(reloads, 1);
  assert.match(toasts.snapshot().at(-1)?.message ?? "", /^Could not merge: offline$/);
  toasts.flush();
});
