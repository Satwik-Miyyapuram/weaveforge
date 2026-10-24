import assert from "node:assert/strict";
import { test } from "node:test";

import { MIRROR_MANIFEST_PATH } from "../application/mirror-manifest";
import {
  chooseDesktopFolder,
  clearExternalChanges,
  closeFolder,
  describeSync,
  externalChanges,
  folderHistory,
  onExternalChange,
  settleExternalChanges,
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
    // Every path but a directory reads as a file somebody edited.
    readVaultFile: (path: string) => Promise.resolve(path.endsWith(".md") ? "edited" : null),
    vaultLog: (limit: number) =>
      Promise.resolve([{ oid: "abc123", message: `last ${limit}`, authoredAt: "2026-08-27T00:00:00.000Z", author: "WeaveForge" }]),
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

/** Changed paths are checked against the manifest before they are reported. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connected() {
  const shell = fakeShell();
  assert.equal(await chooseDesktopFolder({ git: false, reuse: true }), true);
  return shell;
}

test("a folder change outside the app is remembered, not applied", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  shell.changed(["notes/one.note.md", "notes/two.note.md"]);
  await settle();
  assert.deepEqual(externalChanges(), ["notes/one.note.md", "notes/two.note.md"]);
});

test("the manifest changing is not somebody else's edit", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  shell.changed([MIRROR_MANIFEST_PATH]);
  assert.deepEqual(externalChanges(), []);
});

test("a directory event is not an edit", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  shell.changed(["thesis--ab12cd34"]);
  await settle();
  assert.deepEqual(externalChanges(), []);
});

test("listeners hear the paths, and only when the set grows", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  const heard: string[][] = [];
  const off = onExternalChange((paths) => heard.push(paths));
  shell.changed(["a.md"]);
  await settle();
  // The same file reported again is the same news.
  shell.changed(["a.md"]);
  await settle();
  off();
  shell.changed(["b.md"]);
  await settle();
  assert.deepEqual(heard, [["a.md"]]);
});

test("clearing forgets them and says so", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  const heard: string[][] = [];
  onExternalChange((paths) => heard.push(paths));
  shell.changed(["a.md"]);
  await settle();
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
  await settle();
  assert.deepEqual(externalChanges(), []);
});

test("after a preview the outside list is what the preview found changed, no more", async (t) => {
  t.after(closeFolder);
  const shell = await connected();
  shell.changed(["notes/one.note.md", "notes/two.note.md"]);
  await settle();
  settleExternalChanges({
    entries: [
      { action: "unchanged", entity: { path: "notes/one.note.md" } },
      { action: "updated", entity: { path: "notes/two.note.md" } },
    ],
    json: { entries: [{ action: "removed", path: "data/tags.json" }, { action: "unchanged", path: "data/lists.json" }] },
  } as never);
  assert.deepEqual(externalChanges(), ["data/tags.json", "notes/two.note.md"]);
});

test("a failed commit is reported, not read as up to date", () => {
  const mirror = { written: [], removed: [] } as never;
  assert.equal(
    describeSync({ mirror, commit: null, commitError: "fatal: adding files failed" }),
    "Wrote 0 files · not committed: fatal: adding files failed",
  );
  assert.equal(describeSync({ mirror, commit: null }), "Wrote 0 files — already up to date");
});

test("a desktop folder's history is the shell's git log, not an empty one", async (t) => {
  t.after(closeFolder);
  await connected();
  assert.deepEqual((await folderHistory(5)).map((c) => c.message), ["last 5"]);
});

test("a desktop history that cannot be read is an error, not an empty log (xipc-18)", async (t) => {
  t.after(closeFolder);
  await connected();
  const bridge = (globalThis as unknown as { window?: { weaveforge: Record<string, unknown> } }).window!.weaveforge;
  bridge.vaultLog = () => Promise.reject(new Error("fatal: bad object HEAD"));
  await assert.rejects(() => folderHistory(5), /bad object HEAD/);
});
