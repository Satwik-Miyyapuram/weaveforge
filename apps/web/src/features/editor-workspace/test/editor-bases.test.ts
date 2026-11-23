/**
 * A section or log entry tab saves against the text its editor opened with,
 * not the text the workspace last reloaded (REVIEW-B P1). The editor keeps its
 * own text when the workspace reloads, so basing a save on the reloaded text
 * overwrote an outside edit without a conflict.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorBases } from "../application/parts";

/** A store that refuses a save whose base is not the text on disk. */
function disk(text: string) {
  const state = { text, conflicts: 0 };
  const write = (next: string) => async (base: string | undefined) => {
    if (base !== state.text) {
      state.conflicts += 1;
      throw Object.assign(new Error("changed on disk"), { name: "ConflictError" });
    }
    state.text = next;
    return next;
  };
  return { state, write };
}

test("a reload with outside text does not move the base of the editor that is open", async () => {
  const { state, write } = disk("first");
  const bases = new EditorBases();
  const slot = bases.slot("report_section:s1", "first");
  state.text = "outside edit";
  // The workspace reloads and renders the tab again with the new text; the editor still holds "first".
  assert.equal(bases.slot("report_section:s1", "outside edit"), slot);
  await assert.rejects(bases.saves.run(slot, "outside edit", write("first, mine")), { name: "ConflictError" });
  assert.equal(state.text, "outside edit", "the outside edit is kept");
});

test("after a conflict the open editor keeps being refused until it is re-seeded", async () => {
  const { state, write } = disk("first");
  const bases = new EditorBases();
  const slot = bases.slot("log_entry:e1", "first");
  state.text = "outside edit";
  await assert.rejects(bases.saves.run(slot, "outside edit", write("mine 1")), { name: "ConflictError" });
  await assert.rejects(bases.saves.run(slot, "outside edit", write("mine 2")), { name: "ConflictError" });
  assert.equal(state.text, "outside edit");
  bases.reseed("log_entry:e1");
  const fresh = bases.slot("log_entry:e1", "outside edit");
  assert.notEqual(fresh, slot, "a new slot remounts the editor");
  // A save the old editor still had queued is refused, not based on the reloaded text.
  await assert.rejects(bases.saves.run(slot, "outside edit", write("mine 3")), { name: "ConflictError" });
  await bases.saves.run(fresh, "outside edit", write("outside edit, mine"));
  assert.equal(state.text, "outside edit, mine");
});

test("saves of one editor chain: each is based on what the last one stored", async () => {
  const { state, write } = disk("a");
  const bases = new EditorBases();
  const slot = bases.slot("report_section:s1", "a");
  await Promise.all([bases.saves.run(slot, "a", write("b")), bases.saves.run(slot, "a", write("c"))]);
  assert.equal(state.text, "c");
  assert.equal(state.conflicts, 0);
});
