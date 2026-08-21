import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWorkspaceFs } from "../../src/testing/memory-workspace-fs.js";
import {
  NoOpWorkspaceGit,
  describeChanges,
  mirrorWorkspace,
  type WorkspaceSnapshot,
} from "../../src/index.js";

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    papers: [], vaultPages: [], readingLists: [], readingListItems: [],
    reportSections: [], experiments: [], milestones: [], logEntries: [],
    relations: [], tags: [], collectedAt: "2026-08-05T00:00:00.000Z", ...over,
  };
}

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

test("a first mirror writes the whole folder", async () => {
  const fs = new MemoryWorkspaceFs();
  const result = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs);

  assert.ok(result.written.includes("notes/method.md"));
  assert.equal(result.unchanged, 0);
});

test("mirroring twice writes nothing the second time", async () => {
  const fs = new MemoryWorkspaceFs();
  const input = snapshot({ vaultPages: [note("n1", "Method", "Body")] });

  await mirrorWorkspace(input, fs);
  const second = await mirrorWorkspace(input, fs);

  // Determinism is what makes this possible, and it is what stops git filling
  // with commits full of untouched files.
  assert.deepEqual(second.written, []);
  assert.ok(second.unchanged > 0);
});

test("an edit rewrites only the file that changed", async () => {
  const fs = new MemoryWorkspaceFs();
  await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "One"), note("n2", "Other", "Two")] }),
    fs,
  );

  const result = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "Edited"), note("n2", "Other", "Two")] }),
    fs,
  );

  assert.deepEqual(result.written, ["notes/method.md"]);
});

test("a deleted entity's file is removed", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method"), note("n2", "Gone")] }),
    fs,
  );

  const result = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs, {
    previousPaths: first.written,
  });

  assert.ok(result.removed.includes("notes/gone.md"));
  assert.equal(await fs.stat("notes/gone.md"), null);
});

test("files the mirror does not own are left alone", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(".obsidian/workspace.json", "{}");
  await fs.writeFile("notes/my-own-file.md", "Written by hand.");

  const first = await mirrorWorkspace(snapshot({ vaultPages: [note("n1", "Method")] }), fs);
  await mirrorWorkspace(snapshot(), fs, { previousPaths: first.written });

  // Deleting unrecognised files in a folder the user can see would be an
  // unpleasant surprise the first time it happened.
  assert.ok(await fs.stat(".obsidian/workspace.json"));
  assert.ok(await fs.stat("notes/my-own-file.md"));
});

test("assets are fetched once and not re-downloaded", async () => {
  const fs = new MemoryWorkspaceFs();
  let fetches = 0;
  const input = snapshot({
    vaultPages: [note("n1", "Method", "![](vault:u1/n1/a.png)")],
  });
  const fetchAsset = async () => {
    fetches += 1;
    return new Uint8Array([1, 2, 3]);
  };

  await mirrorWorkspace(input, fs, { fetchAsset });
  await mirrorWorkspace(input, fs, { fetchAsset });

  assert.equal(fetches, 1, "storage paths carry a uuid, so an existing asset is the same file");
  assert.ok(await fs.stat("assets/notes/u1/n1/a.png"));
});

test("a missing asset does not abort the mirror", async () => {
  const fs = new MemoryWorkspaceFs();
  const result = await mirrorWorkspace(
    snapshot({ vaultPages: [note("n1", "Method", "![](vault:u1/n1/gone.png)")] }),
    fs,
    { fetchAsset: async () => null },
  );

  assert.ok(result.written.includes("notes/method.md"), "the note is still written");
});

test("git is off by default and answers without throwing", async () => {
  const git = new NoOpWorkspaceGit();

  assert.equal(git.kind, "none");
  assert.equal(await git.isRepo(), false);
  assert.equal(await git.commitAll(), null);
  assert.deepEqual(await git.log(), []);
  assert.equal(await git.readAt(), null);
});

test("commit messages describe what changed", () => {
  assert.equal(describeChanges([]), "No changes");
  assert.equal(
    describeChanges([
      { path: "a", state: "added" },
      { path: "b", state: "modified" },
      { path: "c", state: "modified" },
      { path: "d", state: "deleted" },
    ]),
    "1 added, 2 changed, 1 removed",
  );
});
