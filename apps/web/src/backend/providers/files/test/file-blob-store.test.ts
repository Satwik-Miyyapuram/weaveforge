import { before, test } from "node:test";
import assert from "node:assert/strict";
import { BlobNotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileBlobStore } from "../file-blob-store";

// The workspace path check runs in the Rust core, which has to be loaded first.
before(loadTestCore);

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, store: new FileBlobStore(fs) };
}

function png(...bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

test("upload then fetchBytes round-trips the exact bytes", async () => {
  const { store } = setup();
  await store.upload("notes", "n1/diagram.png", png(1, 2, 3, 250), "image/png");
  const back = await store.fetchBytes("notes", "n1/diagram.png");
  assert.deepEqual([...back], [1, 2, 3, 250]);
});

test("the file sits at assets/<bucket>/<path> with a sha256 sidecar", async () => {
  const { fs, store } = setup();
  await store.upload("notes", "n1/diagram.png", png(7), "image/png");
  assert.deepEqual(Object.keys(fs.toRecord()).sort(), [
    "assets/notes/n1/diagram.png",
    "assets/notes/n1/diagram.png.sha256",
  ]);
});

test("a tampered bytes file makes fetchBytes throw a checksum error", async () => {
  const { fs, store } = setup();
  await store.upload("notes", "n1/diagram.png", png(1, 2, 3), "image/png");
  await fs.writeFile("assets/notes/n1/diagram.png", new Uint8Array([9, 9, 9]));
  await assert.rejects(store.fetchBytes("notes", "n1/diagram.png"), /asset checksum mismatch/);
});

test("a missing asset throws BlobNotFoundError", async () => {
  const { store } = setup();
  await assert.rejects(store.fetchBytes("notes", "nope.png"), BlobNotFoundError);
});

test("re-uploading identical bytes is fine", async () => {
  const { store } = setup();
  await store.upload("notes", "n1/a.png", png(4, 5), "image/png");
  await store.upload("notes", "n1/a.png", png(4, 5), "image/png");
  assert.deepEqual([...(await store.fetchBytes("notes", "n1/a.png"))], [4, 5]);
});

test("re-uploading different bytes to the same path throws and keeps the old bytes", async () => {
  const { store } = setup();
  await store.upload("notes", "n1/a.png", png(4, 5), "image/png");
  await assert.rejects(store.upload("notes", "n1/a.png", png(6), "image/png"), /n1\/a\.png/);
  assert.deepEqual([...(await store.fetchBytes("notes", "n1/a.png"))], [4, 5]);
});

test("remove leaves no asset file behind and a second remove does not throw", async () => {
  const { fs, store } = setup();
  await store.upload("notes", "n1/a.png", png(8), "image/png");
  await store.remove("notes", "n1/a.png");
  assert.equal(Object.keys(fs.toRecord()).some((k) => k.startsWith("assets/")), false);
  await store.remove("notes", "n1/a.png");
});

test("a path with .. is rejected", async () => {
  const { store } = setup();
  await assert.rejects(store.upload("notes", "../escape.png", png(1), "image/png"), /Unsafe asset path/);
  await assert.rejects(store.fetchBytes("notes", "/abs.png"), /Unsafe asset path/);
  await assert.rejects(store.remove("notes", "a\\b.png"), /Unsafe asset path/);
});

test("signedUrls returns a null for each path", async () => {
  const { store } = setup();
  assert.deepEqual(await store.signedUrls("notes", ["a.png", "b.png"], 60), [null, null]);
});

test("remove moves the bytes and sidecar to .weaveforge/trash, so nothing is lost", async () => {
  const { fs, store } = setup();
  await store.upload("notes", "n1/a.png", png(8, 9), "image/png");
  await store.remove("notes", "n1/a.png");
  const keys = Object.keys(fs.toRecord());
  assert.equal(keys.some((k) => k.startsWith("assets/")), false);
  const trashed = keys.filter((k) => k.startsWith(".weaveforge/trash/") && k.includes("n1/a.png"));
  assert.equal(trashed.length, 2, keys.join(", "));
  assert.deepEqual([...(await fs.readFile(trashed.find((k) => !k.endsWith(".sha256"))!))], [8, 9]);
});

test("writes go to a .part file and are renamed into place, never written directly", async () => {
  const { fs, store } = setup();
  const written: string[] = [];
  const realWrite = fs.writeFile.bind(fs);
  const realRename = fs.rename.bind(fs);
  let inRename = false;
  // The memory fs writes the target inside rename; only the store's own writes count.
  fs.writeFile = (path, data) => {
    if (!inRename) written.push(path);
    return realWrite(path, data);
  };
  fs.rename = async (from, to) => {
    inRename = true;
    try {
      return await realRename(from, to);
    } finally {
      inRename = false;
    }
  };
  await store.upload("notes", "n1/a.png", png(1, 2), "image/png");
  assert.equal(written.includes("assets/notes/n1/a.png"), false);
  assert.ok(written.some((p) => /^assets\/notes\/n1\/a\.png\.[0-9a-f]{8}\.part$/.test(p)), "a unique .part temp file");
  assert.equal(Object.keys(fs.toRecord()).some((k) => k.endsWith(".part")), false);
});

test("an empty bucket or path is rejected", async () => {
  const { store } = setup();
  await assert.rejects(store.upload("", "a.png", png(1), "image/png"), /Unsafe asset path/);
  await assert.rejects(store.upload("notes", "", png(1), "image/png"), /Unsafe asset path/);
  await assert.rejects(store.fetchBytes("notes", ""), /Unsafe asset path/);
});

test("a user path ending in .sha256 is rejected, so it cannot reach a sidecar", async () => {
  const { store } = setup();
  await assert.rejects(store.upload("notes", "a.png.sha256", png(1), "image/png"), /Unsafe asset path/);
  await assert.rejects(store.fetchBytes("notes", "a.png.sha256"), /Unsafe asset path/);
  await assert.rejects(store.remove("notes", "a.png.sha256"), /Unsafe asset path/);
});

/** A workspace fs whose rename refuses to replace an existing file, as the export's guarded sink does. */
function refusingRename(fs: MemoryWorkspaceFs): MemoryWorkspaceFs {
  const rename = fs.rename.bind(fs);
  fs.rename = async (from: string, to: string) => {
    if (await fs.stat(to)) throw new Error(`refusing to replace an existing file: ${to}`);
    return rename(from, to);
  };
  return fs;
}

test("a second run of an already-exported blob is clean: no rename onto the existing sidecar", async () => {
  const fs = refusingRename(new MemoryWorkspaceFs());
  const store = new FileBlobStore(fs);
  await store.upload("notes", "n1/diagram.png", png(1, 2, 3), "image/png");
  await store.upload("notes", "n1/diagram.png", png(1, 2, 3), "image/png");
  assert.deepEqual(Object.keys(fs.toRecord()).sort(), [
    "assets/notes/n1/diagram.png",
    "assets/notes/n1/diagram.png.sha256",
  ]);
});

test("a re-upload whose sidecar differs keeps the sidecar, throws a conflict, and writes the new one outside assets/", async () => {
  const fs = refusingRename(new MemoryWorkspaceFs());
  const store = new FileBlobStore(fs);
  await store.upload("notes", "n1/diagram.png", png(1, 2, 3), "image/png");
  await assert.rejects(store.upload("notes", "n1/diagram.png", png(1, 2, 3), "image/jpeg"), /conflict: .*differs/);
  assert.match(await fs.readText("assets/notes/n1/diagram.png.sha256"), /image\/png$/, "the existing sidecar is kept");
  assert.match(
    await fs.readText(".weaveforge/migration-0.9.7/sidecar-conflicts/notes/n1/diagram.png.sha256"),
    /image\/jpeg$/,
    "the new sidecar is in a conflict copy outside assets/",
  );
});
test("an upload never overwrites a user's own <asset>.part file", async () => {
  const { fs, store } = setup();
  await fs.writeFile("assets/notes/n1/diagram.png.part", "USER");
  await store.upload("notes", "n1/diagram.png", png(1, 2, 3), "image/png");
  assert.equal(await fs.readText("assets/notes/n1/diagram.png.part"), "USER", "the user's .part file is kept");
  assert.deepEqual([...(await store.fetchBytes("notes", "n1/diagram.png"))], [1, 2, 3]);
});
