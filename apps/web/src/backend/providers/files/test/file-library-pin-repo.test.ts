import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileLibraryPinRepository, LIBRARY_PINS_PATH } from "../file-library-pin-repo";

before(loadTestCore);

const ROOT = "thesis";
const A = `${ROOT}/papers/a.paper.md`;
const B = `${ROOT}/papers/b.paper.md`;

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(A, core.writePaperRow(null, { id: "a", title: "A" }) + "Body.\n");
  await fs.writeFile(B, core.writePaperRow(null, { id: "b", title: "B" }));
  const papers = new FilePaperRepository(fs, ROOT);
  return { fs, papers, pins: new FileLibraryPinRepository(papers, fs) };
}

test("pin writes pinned: true into the paper and isPinned sees it", async () => {
  const { fs, pins } = await setup();
  await pins.pin({ resourceType: "paper", resourceId: "a", ownerId: "me" });
  assert.equal(await pins.isPinned("paper", "a"), true);
  assert.match(await fs.readText(A), /^pinned: true$/m);
});

test("unpin clears the flag and removes the key from the file", async () => {
  const { fs, pins } = await setup();
  await pins.pin({ resourceType: "paper", resourceId: "a", ownerId: "me" });
  await pins.unpin("paper", "a");
  assert.equal(await pins.isPinned("paper", "a"), false);
  assert.doesNotMatch(await fs.readText(A), /pinned/);
});

test("listForProject lists only the pinned papers, as LibraryPin rows", async () => {
  const { pins } = await setup();
  await pins.pin({ resourceType: "paper", resourceId: "b", ownerId: "me" });
  const listed = await pins.listForProject();
  // Files store no owner or timestamp, so only the pinned target is compared.
  assert.deepEqual(listed.map((p) => [p.resourceType, p.resourceId]), [["paper", "b"]]);
});

test("a pin survives renaming the paper file", async () => {
  const { fs, pins } = await setup();
  await pins.pin({ resourceType: "paper", resourceId: "a", ownerId: "me" });
  await fs.rename(A, `${ROOT}/papers/renamed.paper.md`);
  assert.deepEqual((await pins.listForProject()).map((p) => p.resourceId), ["a"]);
});

test("pin and unpin keep an unknown property in the paper", async () => {
  const { fs, pins } = await setup();
  const text = (await fs.readText(A)).replace("weaveforge-type: paper\n", "weaveforge-type: paper\nmy-note: keep\n");
  await fs.writeFile(A, text);
  await pins.pin({ resourceType: "paper", resourceId: "a", ownerId: "me" });
  await pins.unpin("paper", "a");
  assert.match(await fs.readText(A), /^my-note: keep$/m);
});

test("a pin that is not a paper in this folder is a row of library-pins.json", async () => {
  const { fs, pins } = await setup();
  await pins.pin({ resourceType: "experiment", resourceId: "e1", ownerId: "me", id: "p1", createdAt: "2026-01-01" });
  await pins.pin({ resourceType: "paper", resourceId: "elsewhere", ownerId: "them" });
  await pins.pin({ resourceType: "experiment", resourceId: "e1", ownerId: "me" });
  assert.deepEqual(
    (await pins.listForProject()).map((p) => [p.resourceType, p.resourceId, p.ownerId]),
    [["experiment", "e1", "me"], ["paper", "elsewhere", "them"]],
  );
  assert.match(await fs.readText(LIBRARY_PINS_PATH), /"p1"[^}]*"2026-01-01"|"2026-01-01"[^}]*"p1"/);
  await pins.unpin("experiment", "e1");
  await pins.unpin("paper", "elsewhere");
  assert.deepEqual(await pins.listForProject(), []);
});
