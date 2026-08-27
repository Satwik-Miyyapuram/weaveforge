import assert from "node:assert/strict";
import { test } from "node:test";

import { MIRROR_MANIFEST_PATH } from "../application/mirror-manifest";
import {
  chooseDesktopFolder,
  clearExternalChanges,
  closeFolder,
  externalChanges,
  onExternalChange,
} from "../application/workspace-folder";

/**
 * A shell that reports folder changes and nothing else.
 *
 * Only the handful of members this path touches are real; the rest is absent,
 * which is the point -- `desktop()` checks the bridge by shape, and a stub that
 * satisfied the whole interface would stop testing that.
 */
function fakeShell() {
  let listeners: ((paths: string[]) => void)[] = [];
  const bridge = {
    fetchTitle: () => Promise.resolve(null),
    vaultRoot: () => Promise.resolve({ path: "/vault" }),
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
    watching: () => listeners.length,
  };
}

async function connected() {
  const shell = fakeShell();
  assert.equal(await chooseDesktopFolder({ git: false, reuse: true }), true);
  return shell;
}

test("a folder change outside the app is remembered, not applied", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  shell.changed(["notes/one.note.md", "notes/two.note.md"]);
  assert.deepEqual(externalChanges(), ["notes/one.note.md", "notes/two.note.md"]);
});

test("the manifest changing is not somebody else's edit", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  shell.changed([MIRROR_MANIFEST_PATH]);
  assert.deepEqual(externalChanges(), []);
});

test("listeners hear the paths, and only when the set grows", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  const heard: string[][] = [];
  const off = onExternalChange((paths) => heard.push(paths));
  shell.changed(["a.md"]);
  // The same file reported again is the same news.
  shell.changed(["a.md"]);
  off();
  shell.changed(["b.md"]);
  assert.deepEqual(heard, [["a.md"]]);
});

test("clearing forgets them and says so", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  const heard: string[][] = [];
  onExternalChange((paths) => heard.push(paths));
  shell.changed(["a.md"]);
  clearExternalChanges();
  assert.deepEqual(externalChanges(), []);
  assert.deepEqual(heard.at(-1), []);
});

test("disconnecting stops listening", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  assert.equal(shell.watching(), 1);
  closeFolder();
  assert.equal(shell.watching(), 0);
  shell.changed(["a.md"]);
  assert.deepEqual(externalChanges(), []);
});
