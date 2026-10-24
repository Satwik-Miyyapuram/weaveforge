/**
 * A zip handed to the user is one helper (xhelp-23): the Overleaf and data
 * exports both made their own `application/zip` Blob from fflate's bytes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipToBlob } from "../blob-output";

test("zipToBlob makes an application/zip Blob holding exactly the bytes", async () => {
  const blob = zipToBlob(new Uint8Array([80, 75, 3, 4, 255]));
  assert.equal(blob.type, "application/zip");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [80, 75, 3, 4, 255]);
});

test("zipToBlob copies only the view, not the whole backing buffer", async () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
  const view = backing.subarray(2, 5);
  const blob = zipToBlob(view);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
});

test("zipToBlob does not share memory with its input", async () => {
  const bytes = new Uint8Array([1, 2]);
  const blob = zipToBlob(bytes);
  bytes[0] = 7;
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2]);
});

test("zipToBlob of no bytes is an empty zip-typed Blob", () => {
  const blob = zipToBlob(new Uint8Array());
  assert.equal(blob.size, 0);
  assert.equal(blob.type, "application/zip");
});
