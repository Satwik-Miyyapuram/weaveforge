/** Deleting a paper: gone at once, deleted when the Undo toast closes (D10, D-07). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { toasts } from "@/lib/toast/toast-store";
import { removePaper, type PaperRemover } from "../remove-paper";

const summary = { id: "p1", title: "Attention is all you need", authors: [] } as never;

function fakePapers() {
  const deleted: string[] = [];
  const papers: PaperRemover = {
    getPaper: async (id) => ({ id, title: "t", metadata: {} }) as never,
    deletePaper: async (p) => void deleted.push((p as { id: string }).id),
  };
  return { papers, deleted };
}

test("the card hides at once and the row is deleted only when the toast closes", async () => {
  const { papers, deleted } = fakePapers();
  let hidden = 0;
  let changed = 0;
  removePaper(summary, { onHidden: () => void hidden++, onDeleted: () => void changed++ }, papers);
  assert.equal(hidden, 1);
  assert.ok(toasts.hiddenKeys().has("paper:p1"));
  assert.match(toasts.snapshot().at(-1)?.message ?? "", /"Attention is all you need" deleted/);
  assert.deepEqual(deleted, []);
  toasts.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, ["p1"]);
  assert.equal(changed, 1);
});

test("Undo keeps the paper and never deletes it", async () => {
  const { papers, deleted } = fakePapers();
  removePaper(summary, {}, papers);
  assert.equal(toasts.undoLatest(), true);
  toasts.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, []);
  assert.equal(toasts.hiddenKeys().has("paper:p1"), false);
});
