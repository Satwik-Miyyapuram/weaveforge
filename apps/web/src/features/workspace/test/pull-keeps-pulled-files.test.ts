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
