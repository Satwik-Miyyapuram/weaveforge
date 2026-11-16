import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { mirrorWorkspace } from "../application/parts-2";
import { keepMirrorBases, readMirrorBase, writeMirrorManifest } from "../application/parts-3";

// A pull brings the remote's manifest along with the remote's files, and that
// manifest's digests match what came in. Left as it is, the next mirror run
// reads every pulled file as its own last write and puts the database's older
// copy back over it. These tests pin the guard that keeps the pulled files.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";

const snapshot = (over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  papers: [], vaultPages: [], readingLists: [], readingListItems: [],
  reportSections: [], experiments: [], milestones: [], logEntries: [],
  relations: [], tags: [], readerAnnotations: [], collectedAt: AT, ...over,
});

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

/** Mirror a snapshot into a folder and record its manifest, as a sync run does. */
async function mirrorRun(fs: MemoryWorkspaceFs, input: WorkspaceSnapshot) {
  const root = core.projectDir(PROJECT);
  const base = await readMirrorBase(fs, root);
  const result = await mirrorWorkspace(core, input, fs, { project: PROJECT, previousPaths: Object.keys(base), base });
  await writeMirrorManifest(fs, root, Object.keys(result.mirrored), result.mirrored);
  return result;
}

const local = snapshot({ vaultPages: [note("n1", "Method", "What this machine last wrote.")] });
const remote = snapshot({ vaultPages: [note("n1", "Method", "A line written on the other machine.")] });

/** This machine's folder after one sync, and a stand-in for `git pull` bringing the remote's whole tree. */
async function setUp() {
  const folder = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(folder, local);
  const other = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(other, remote);
  const pull = async (kind: "fast-forward" | "up-to-date") => {
    if (kind === "fast-forward") {
      for (const [path, text] of Object.entries(other.toRecord())) await folder.writeFile(path, text);
    }
    return { url: "u", hasToken: true, pull: kind === "fast-forward" ? { kind, oid: "abc" } : { kind } };
  };
  const notePath = Object.keys(other.toRecord()).find((p) => p.endsWith(".md") && other.toRecord()[p]?.includes("other machine"));
  assert.ok(notePath, "the remote has the note");
  return { folder, other, pull, notePath: notePath as string };
}

const moved = (reply: { pull?: { kind: string } }) => reply.pull?.kind === "fast-forward" || reply.pull?.kind === "merged";

test("without the guard, the next mirror writes the database's older copy over a pulled file", async () => {
  const { folder, pull, notePath } = await setUp();
  await pull("fast-forward");
  await mirrorRun(folder, local);
  assert.match(folder.toRecord()[notePath] ?? "", /What this machine last wrote/);
});

test("with the guard, the pulled file survives the next mirror and is held back for import", async () => {
  const { folder, pull, notePath } = await setUp();
  await keepMirrorBases(folder, () => pull("fast-forward"), moved);
  const result = await mirrorRun(folder, local);
  assert.match(folder.toRecord()[notePath] ?? "", /A line written on the other machine/);
  assert.ok(result.heldBack.includes(notePath), "held back, so the folder watcher's import offers it");
});

test("a pull that moved nothing leaves the manifest as it is", async () => {
  const { folder, pull } = await setUp();
  const before = folder.toRecord();
  await keepMirrorBases(folder, () => pull("up-to-date"), moved);
  assert.deepEqual(folder.toRecord(), before);
});

test("a pull that fails leaves the manifest as it is and passes the error on", async () => {
  const { folder } = await setUp();
  const before = folder.toRecord();
  await assert.rejects(
    keepMirrorBases(folder, (): Promise<{ pull?: { kind: string } }> => Promise.reject(new Error("network down")), moved),
    /network down/,
  );
  assert.deepEqual(folder.toRecord(), before);
});

// --- a pull as git does it now: the project manifests stay out of the history ---

/** A project manifest is this machine's own record; git leaves it out of every pull. */
const machineOnly = (path: string) => path.startsWith(".weaveforge/") || path.endsWith("/.weaveforge/mirror.json");

/** A stand-in for `git pull` moving this folder to the other's tree: files in, files out, manifests untouched. */
function gitPull(folder: MemoryWorkspaceFs, other: MemoryWorkspaceFs) {
  return async () => {
    const theirs = other.toRecord();
    for (const path of Object.keys(folder.toRecord())) {
      if (!machineOnly(path) && !Object.hasOwn(theirs, path)) await folder.remove(path);
    }
    for (const [path, text] of Object.entries(theirs)) {
      if (!machineOnly(path)) await folder.writeFile(path, text);
    }
    return { url: "u", hasToken: true, pull: { kind: "fast-forward", oid: "abc" } };
  };
}

const both = snapshot({ vaultPages: [note("n1", "Method", "Kept."), note("n2", "Results", "Deleted on the other machine.")] });
const onlyMethod = snapshot({ vaultPages: [note("n1", "Method", "Kept.")] });

/** Both machines had both notes; the other machine then deleted Results and pushed. */
async function setUpRemoteDelete() {
  const folder = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(folder, both);
  const other = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(other, both);
  await mirrorRun(other, onlyMethod);
  const deleted = Object.keys(folder.toRecord()).find((p) => p.endsWith(".md") && folder.toRecord()[p]?.includes("Deleted on the other"));
  assert.ok(deleted, "this machine has the note the other deleted");
  assert.ok(!Object.hasOwn(other.toRecord(), deleted as string), "the other machine removed it");
  return { folder, pull: gitPull(folder, other), deleted: deleted as string };
}

test("without the guard, a note deleted on the other machine comes back at the next mirror", async () => {
  const { folder, pull, deleted } = await setUpRemoteDelete();
  await pull();
  assert.ok(!Object.hasOwn(folder.toRecord(), deleted), "the pull removed it");
  await mirrorRun(folder, both);
  assert.ok(Object.hasOwn(folder.toRecord(), deleted), "the mirror wrote it back");
});

test("with the guard, a note deleted on the other machine stays deleted and waits for review", async () => {
  const { folder, pull, deleted } = await setUpRemoteDelete();
  await keepMirrorBases(folder, pull, moved);
  const first = await mirrorRun(folder, both);
  assert.ok(!Object.hasOwn(folder.toRecord(), deleted), "not written back");
  assert.ok(first.heldBack.includes(deleted), "held, so the review offers the removal");
  assert.ok(Object.hasOwn(await readMirrorBase(folder, core.projectDir(PROJECT)), deleted), "still in the base, so the watcher reads it as removed");
  const second = await mirrorRun(folder, both);
  assert.ok(!Object.hasOwn(folder.toRecord(), deleted), "still not written back on the next run");
  assert.ok(second.heldBack.includes(deleted));
});

test("putting the note back ends the hold", async () => {
  const { folder, pull, deleted } = await setUpRemoteDelete();
  await keepMirrorBases(folder, pull, moved);
  await mirrorRun(folder, both);
  await folder.writeFile(deleted, "Put back by the reader.");
  const run = await mirrorRun(folder, both);
  assert.ok(!run.heldBack.includes(deleted) || folder.toRecord()[deleted] === "Put back by the reader.");
  // With the hold over, a later delete in the folder is an ordinary one again.
  await folder.remove(deleted);
  await mirrorRun(folder, both);
  assert.ok(Object.hasOwn(folder.toRecord(), deleted), "no longer held as a pulled delete");
});

test("deleting the note in the app ends the hold and drops it from the base", async () => {
  const { folder, pull, deleted } = await setUpRemoteDelete();
  await keepMirrorBases(folder, pull, moved);
  await mirrorRun(folder, both);
  const run = await mirrorRun(folder, onlyMethod);
  assert.ok(!run.heldBack.includes(deleted));
  assert.ok(!Object.hasOwn(await readMirrorBase(folder, core.projectDir(PROJECT)), deleted));
  assert.ok(!Object.hasOwn(folder.toRecord(), deleted));
  // The note comes back in the app later: an ordinary write, not a held delete.
  await mirrorRun(folder, both);
  assert.ok(Object.hasOwn(folder.toRecord(), deleted));
});

/** A machine that never mirrored the project, pulling the other's folder. */
async function setUpNewProject() {
  const folder = new MemoryWorkspaceFs(() => AT);
  await folder.writeFile("papers/reading.md", "A folder of the reader's own, not a project.");
  const other = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(other, remote);
  const notePath = Object.keys(other.toRecord()).find((p) => p.endsWith(".md") && other.toRecord()[p]?.includes("other machine"));
  assert.ok(notePath);
  return { folder, pull: gitPull(folder, other), notePath: notePath as string };
}

test("without the guard, a project folder new to this machine is overwritten by the next mirror", async () => {
  const { folder, pull, notePath } = await setUpNewProject();
  await pull();
  await mirrorRun(folder, local);
  assert.match(folder.toRecord()[notePath] ?? "", /What this machine last wrote/);
});

test("with the guard, a project folder new to this machine keeps its pulled files for import", async () => {
  const { folder, pull, notePath } = await setUpNewProject();
  await keepMirrorBases(folder, pull, moved);
  const run = await mirrorRun(folder, local);
  assert.match(folder.toRecord()[notePath] ?? "", /A line written on the other machine/);
  assert.ok(run.heldBack.includes(notePath), "held back, so the import offers it");
  assert.ok(!Object.hasOwn(folder.toRecord(), "papers/.weaveforge/mirror.json"), "a folder that was already there is left alone");
});
