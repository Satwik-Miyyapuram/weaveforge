import { before, test } from "node:test";
import assert from "node:assert/strict";
import { LibraryPinError, NotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileLibraryPinRepository } from "../file-library-pin-repo";

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
  return { fs, papers, pins: new FileLibraryPinRepository(papers) };
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

test("only papers can be pinned in files mode", async () => {
  const { pins } = await setup();
  await assert.rejects(pins.pin({ resourceType: "experiment", resourceId: "e1", ownerId: "me" }), LibraryPinError);
});

test("pinning a paper that does not exist throws NotFoundError", async () => {
  const { pins } = await setup();
  await assert.rejects(pins.pin({ resourceType: "paper", resourceId: "nope", ownerId: "me" }), NotFoundError);
});
