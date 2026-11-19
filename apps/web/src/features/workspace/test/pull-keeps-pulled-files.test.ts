import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { mirrorWorkspace } from "../application/parts-2";
import { keepMirrorBases, readMirrorBase, writeMirrorManifest } from "../application/parts-3";

// A pull brings the remote's manifest along with the remote's files, and that
// manifest's digests match what came in. The mirror must not treat a pulled file
// as its own last write: the first mirror after start rewrites nothing that
// already exists, and a later rewrite happens only for an edit made in the app
// during the same session. Sync never removes a file.

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

/** Mirror a snapshot into a folder and record its manifest, as a sync run does. `seen` is this session's record. */
async function mirrorRun(
  fs: MemoryWorkspaceFs,
  input: WorkspaceSnapshot,
  seen?: Readonly<Record<string, string>>,
) {
  const root = core.projectDir(PROJECT);
  const base = await readMirrorBase(fs, root);
  const result = await mirrorWorkspace(core, input, fs, { project: PROJECT, seen, base });
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

test("the first mirror after start does not overwrite a pulled file", async () => {
  const { folder, pull, notePath } = await setUp();
  await pull("fast-forward");
  await mirrorRun(folder, local);
  assert.match(folder.toRecord()[notePath] ?? "", /A line written on the other machine/);
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

test("a note deleted on the other machine is written back from the database, and nothing else is removed", async () => {
  const folder = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(folder, both);
  const other = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(other, both);
  const deleted = Object.keys(folder.toRecord()).find((p) => p.endsWith(".md") && folder.toRecord()[p]?.includes("Deleted on the other"));
  assert.ok(deleted, "this machine has the note the other will delete");
  await other.remove(deleted as string);
  await gitPull(folder, other)();
  assert.ok(!Object.hasOwn(folder.toRecord(), deleted as string), "the pull removed it");

  const run = await mirrorRun(folder, both);
  assert.ok(Object.hasOwn(folder.toRecord(), deleted as string), "the database restores the missing file");
  assert.deepEqual(run.removed, [], "no file is removed");
});

test("a file the database never had is never removed", async () => {
  const folder = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(folder, local);
  const extra = `${core.projectDir(PROJECT)}/notes/extra.note.md`;
  await folder.writeFile(extra, "Written by the reader, not in the database.");
  await mirrorRun(folder, snapshot());
  assert.equal(folder.toRecord()[extra], "Written by the reader, not in the database.");
});

test("an edit made in the app this session rewrites its file", async () => {
  const folder = new MemoryWorkspaceFs(() => AT);
  const first = await mirrorRun(folder, local);
  const notePath = Object.keys(first.mirrored).find((p) => p.endsWith("/notes/method.note.md"));
  assert.ok(notePath, "the note was mirrored");

  const edited = snapshot({ vaultPages: [note("n1", "Method", "Edited in the app.")] });
  await mirrorRun(folder, edited, first.served);
  assert.match(folder.toRecord()[notePath as string] ?? "", /Edited in the app\./);
});

/** A machine that never mirrored the project, pulling the other's folder. */
async function setUpNewProject() {
  const folder = new MemoryWorkspaceFs(() => AT);
  const other = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(other, remote);
  const notePath = Object.keys(other.toRecord()).find((p) => p.endsWith(".md") && other.toRecord()[p]?.includes("other machine"));
  assert.ok(notePath);
  return { folder, pull: gitPull(folder, other), notePath: notePath as string };
}

test("a project folder new to this machine keeps its pulled files through the next mirror", async () => {
  const { folder, pull, notePath } = await setUpNewProject();
  await pull();
  await mirrorRun(folder, local);
  assert.match(folder.toRecord()[notePath] ?? "", /A line written on the other machine/);
});
