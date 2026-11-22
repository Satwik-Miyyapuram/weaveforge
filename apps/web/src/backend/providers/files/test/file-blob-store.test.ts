import { test } from "node:test";
import assert from "node:assert/strict";
import { BlobNotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FileBlobStore } from "../file-blob-store";

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

test("remove deletes both files and a second remove does not throw", async () => {
  const { fs, store } = setup();
  await store.upload("notes", "n1/a.png", png(8), "image/png");
  await store.remove("notes", "n1/a.png");
  assert.deepEqual(Object.keys(fs.toRecord()), []);
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
