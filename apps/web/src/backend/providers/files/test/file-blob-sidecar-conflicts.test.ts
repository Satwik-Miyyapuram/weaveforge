import { before, test } from "node:test";
import assert from "node:assert/strict";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ConflictError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FileBlobStore } from "../file-blob-store";

before(loadTestCore);

const SIDECAR_CONFLICTS = ".weaveforge/migration-0.9.7/sidecar-conflicts";

function png(...bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

test("a differing sidecar: the copy goes outside assets/, the upload throws conflict, the sidecar is kept", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new FileBlobStore(fs);
  await store.upload("notes", "n1/x.png", png(7), "image/png");
  const kept = "deadbeef\nimage/png";
  await fs.writeFile("assets/notes/n1/x.png.sha256", kept);

  await assert.rejects(
    store.upload("notes", "n1/x.png", png(7), "image/png"),
    (err: unknown) => err instanceof ConflictError && /conflict: .*x\.png\.sha256 differs/.test((err as Error).message),
  );

  assert.equal(await fs.readText("assets/notes/n1/x.png.sha256"), kept);
  const copy = await fs.readText(`${SIDECAR_CONFLICTS}/notes/n1/x.png.sha256`);
  assert.match(copy, /\nimage\/png$/);
  assert.ok(
    Object.keys(fs.toRecord())
      .filter((p) => p.startsWith("assets/"))
      .every((p) => p === "assets/notes/n1/x.png" || p === "assets/notes/n1/x.png.sha256"),
    "no conflict copy inside assets/",
  );
});

test("an extensionless asset and an asset named 'diagram (conflict)' do not collide", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new FileBlobStore(fs);
  await store.upload("notes", "diagram", png(1), "image/png");
  const original = await fs.readText("assets/notes/diagram.sha256");
  await fs.writeFile("assets/notes/diagram.sha256", "other\nimage/png");
  await assert.rejects(store.upload("notes", "diagram", png(1), "image/png"), /conflict:/);

  await store.upload("notes", "diagram (conflict)", png(2), "image/png");

  assert.deepEqual([...(await store.fetchBytes("notes", "diagram (conflict)"))], [2]);
  assert.equal(await fs.readText(`${SIDECAR_CONFLICTS}/notes/diagram.sha256`), original);
});
