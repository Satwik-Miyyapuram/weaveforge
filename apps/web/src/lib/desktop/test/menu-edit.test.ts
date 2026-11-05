import assert from "node:assert/strict";
import { test } from "node:test";

import { isEditCommand, runEditCommand, type EditClipboard, type EditDocument } from "../menu-edit";

function fakeDoc(result = true): EditDocument & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    execCommand(...args: unknown[]) {
      calls.push(args);
      return result;
    },
  } as EditDocument & { calls: unknown[][] };
}

const noClipboard: EditClipboard = {
  readText: () => Promise.reject(new Error("not used")),
};

test("each edit command runs its execCommand", async () => {
  const cases: Array<[string, string]> = [
    ["edit-undo", "undo"],
    ["edit-redo", "redo"],
    ["edit-cut", "cut"],
    ["edit-copy", "copy"],
    ["edit-select-all", "selectAll"],
  ];
  for (const [command, exec] of cases) {
    const doc = fakeDoc();
    assert.equal(await runEditCommand(command, doc, noClipboard), true, command);
    assert.deepEqual(doc.calls, [[exec]], command);
  }
});

test("paste reads the clipboard and inserts its text", async () => {
  const doc = fakeDoc();
  const clipboard: EditClipboard = { readText: () => Promise.resolve("from clipboard") };
  assert.equal(await runEditCommand("edit-paste", doc, clipboard), true);
  assert.deepEqual(doc.calls, [["insertText", false, "from clipboard"]]);
});

test("pasting an empty clipboard inserts nothing", async () => {
  const doc = fakeDoc();
  const clipboard: EditClipboard = { readText: () => Promise.resolve("") };
  assert.equal(await runEditCommand("edit-paste", doc, clipboard), false);
  assert.deepEqual(doc.calls, []);
});

test("a refused clipboard read rejects so the caller can log it", async () => {
  const doc = fakeDoc();
  const clipboard: EditClipboard = { readText: () => Promise.reject(new Error("denied")) };
  await assert.rejects(runEditCommand("edit-paste", doc, clipboard), /denied/);
  assert.deepEqual(doc.calls, []);
});

test("execCommand's own answer is passed back", async () => {
  const doc = fakeDoc(false);
  assert.equal(await runEditCommand("edit-copy", doc, noClipboard), false);
});

test("other commands are not edit commands and run nothing", async () => {
  for (const command of ["search", "edit-", "undo", "edit-delete", ""]) {
    const doc = fakeDoc();
    assert.equal(isEditCommand(command), false, command);
    assert.equal(await runEditCommand(command, doc, noClipboard), false, command);
    assert.deepEqual(doc.calls, [], command);
  }
  assert.equal(isEditCommand("edit-paste"), true);
});
