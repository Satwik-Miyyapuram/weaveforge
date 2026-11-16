import assert from "node:assert/strict";
import { before, test } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { runEditCommand, type EditClipboard, type EditDocument } from "../menu-edit";

before(loadTestCore);

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

function spyToast(): ((message: string) => void) & { messages: string[] } {
  const messages: string[] = [];
  return Object.assign((message: string) => void messages.push(message), { messages });
}

test("pasting an empty clipboard inserts nothing and says the clipboard is empty", async () => {
  const doc = fakeDoc();
  const toast = spyToast();
  const clipboard: EditClipboard = { readText: () => Promise.resolve("") };
  assert.equal(await runEditCommand("edit-paste", doc, clipboard, toast), false);
  assert.deepEqual(doc.calls, []);
  assert.deepEqual(toast.messages, ["Clipboard is empty"]);
});

test("a refused clipboard read says paste was blocked and still rejects for logging", async () => {
  const doc = fakeDoc();
  const toast = spyToast();
  const clipboard: EditClipboard = { readText: () => Promise.reject(new Error("denied")) };
  await assert.rejects(runEditCommand("edit-paste", doc, clipboard, toast), /denied/);
  assert.deepEqual(doc.calls, []);
  assert.deepEqual(toast.messages, ["Paste was blocked — use Ctrl+V"]);
});

test("a successful paste shows no toast", async () => {
  const doc = fakeDoc();
  const toast = spyToast();
  const clipboard: EditClipboard = { readText: () => Promise.resolve("text") };
  assert.equal(await runEditCommand("edit-paste", doc, clipboard, toast), true);
  assert.deepEqual(toast.messages, []);
});

test("execCommand's own answer is passed back", async () => {
  const doc = fakeDoc(false);
  assert.equal(await runEditCommand("edit-copy", doc, noClipboard), false);
});

test("other commands are not edit commands and run nothing", async () => {
  for (const command of ["search", "edit-", "undo", "edit-delete", ""]) {
    const doc = fakeDoc();
    assert.equal(readyCore().isEditCommand(command), false, command);
    assert.equal(await runEditCommand(command, doc, noClipboard), false, command);
    assert.deepEqual(doc.calls, [], command);
  }
  assert.equal(readyCore().isEditCommand("edit-paste"), true);
});
