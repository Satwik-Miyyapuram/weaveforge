/** Deleting a report section: gone at once, deleted when the Undo toast closes (D10, D-07). */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportSection } from "@weaveforge/core";

import { toasts } from "@/lib/toast/toast-store";
import { removeSectionLater, sectionKey } from "../ui/remove-section";

const section = { id: "s1", title: "Methods" } as ReportSection;
const settle = () => new Promise((r) => setTimeout(r, 0));

test("the section hides at once, names its subsections, and is deleted when the toast closes", async () => {
  const removed: string[] = [];
  let hidden = 0;
  let reloads = 0;
  removeSectionLater(section, 2, { onHidden: () => void hidden++, onDeleted: () => void reloads++ }, async (s) =>
    void removed.push(s.id),
  );
  assert.equal(hidden, 1);
  assert.ok(toasts.hiddenKeys().has(sectionKey("s1")));
  assert.equal(toasts.snapshot().at(-1)?.message, '"Methods" deleted with 2 subsection(s)');
  assert.deepEqual(removed, []);
  toasts.flush();
  await settle();
  assert.deepEqual(removed, ["s1"]);
  assert.equal(reloads, 1);
});

test("Undo keeps the section", async () => {
  const removed: string[] = [];
  removeSectionLater(section, 0, { onDeleted: () => {} }, async (s) => void removed.push(s.id));
  assert.equal(toasts.snapshot().at(-1)?.message, '"Methods" deleted');
  toasts.undoLatest();
  toasts.flush();
  await settle();
  assert.deepEqual(removed, []);
  assert.equal(toasts.hiddenKeys().has(sectionKey("s1")), false);
});

test("a failed delete still reloads, and the toast says what failed", async () => {
  let reloads = 0;
  removeSectionLater(section, 0, { onDeleted: () => void reloads++ }, () => Promise.reject(new Error("offline")));
  toasts.flush();
  await settle();
  assert.equal(reloads, 1);
  assert.match(toasts.snapshot().at(-1)?.message ?? "", /Could not delete: offline/);
  toasts.flush();
});
