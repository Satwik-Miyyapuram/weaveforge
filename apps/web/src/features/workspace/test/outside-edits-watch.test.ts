import assert from "node:assert/strict";
import { before, test } from "node:test";

import { forgetOwnWrites, recordOwnWrite } from "@/backend/providers/files/own-writes";
import { loadTestCore } from "@/lib/test/load-test-core";
import { chooseDesktopFolder, closeFolder, onOutsideEditsTakenIn } from "../application/workspace-folder";

before(async () => {
  await loadTestCore();
});

/** A shell that reports folder changes and reads files from `texts`; a path not in it is absent. */
function fakeShell(texts: Record<string, string>) {
  let listeners: ((paths: string[]) => void)[] = [];
  const bridge = {
    fetchTitle: () => Promise.resolve(null),
    vaultRoot: () => Promise.resolve({ path: "/vault" }),
    chooseVaultRoot: () => Promise.resolve({ path: "/vault" }),
    writePreference: () => Promise.resolve(),
    readVaultFile: (path: string) => Promise.resolve(texts[path] ?? null),
    commitVault: () => Promise.resolve({ commit: null, reason: "Folder history is switched off." }),
    onVaultChange(cb: (paths: string[]) => void) {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((each) => each !== cb);
      };
    },
  };
  (globalThis as { window?: unknown }).window = { weaveforge: bridge };
  return {
    changed: (paths: string[]) => listeners.forEach((cb) => cb(paths)),
  };
}

async function connect(t: { after: (fn: () => void) => void }, texts: Record<string, string>) {
  forgetOwnWrites();
  const shell = fakeShell(texts);
  t.after(closeFolder);
  assert.deepEqual(await chooseDesktopFolder({ git: false }), { warnings: [] });
  const heard: number[] = [];
  const off = onOutsideEditsTakenIn((n) => heard.push(n));
  t.after(off);
  return { shell, heard };
}

async function waitFor(heard: number[], tries: number) {
  for (let i = 0; i < tries && heard.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("an outside edit is announced once", async (t) => {
  const { shell, heard } = await connect(t, { "notes/outside.md": "edited" });
  shell.changed(["notes/outside.md"]);
  await waitFor(heard, 50);
  assert.deepEqual(heard, [1]);
});

test("the app's own write echoing back is not an outside edit", async (t) => {
  const { shell, heard } = await connect(t, { "notes/outside.md": "edited" });
  recordOwnWrite("notes/outside.md", "edited");
  shell.changed(["notes/outside.md"]);
  await waitFor(heard, 10);
  assert.deepEqual(heard, []);
});

test("an edit made after the app's own write is an outside edit", async (t) => {
  const { shell, heard } = await connect(t, { "notes/outside.md": "edited" });
  recordOwnWrite("notes/outside.md", "old");
  shell.changed(["notes/outside.md"]);
  await waitFor(heard, 50);
  assert.deepEqual(heard, [1]);
});

test("an unreadable path (deleted file or directory) is not announced", async (t) => {
  const { shell, heard } = await connect(t, {});
  shell.changed(["notes/gone.md"]);
  await waitFor(heard, 10);
  assert.deepEqual(heard, []);
});

test("two edited files in one event are announced together", async (t) => {
  const { shell, heard } = await connect(t, { "notes/a.md": "one", "notes/b.md": "two" });
  shell.changed(["notes/a.md", "notes/b.md"]);
  await waitFor(heard, 50);
  assert.deepEqual(heard, [2]);
});

test("a Windows-separator echo of the app's own write is not an outside edit", async (t) => {
  const { shell, heard } = await connect(t, {
    "notes/outside.md": "edited",
    "notes\\outside.md": "edited",
  });
  recordOwnWrite("notes/outside.md", "edited");
  shell.changed(["notes\\outside.md"]);
  await waitFor(heard, 10);
  assert.deepEqual(heard, []);
});
