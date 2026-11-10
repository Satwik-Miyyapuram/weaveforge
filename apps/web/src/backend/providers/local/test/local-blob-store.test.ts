import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { BlobNotFoundError } from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";
import { LocalBlobStore, type LocalFiles } from "../local-blob-store";
import type { LocalQuery } from "../pglite-client";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../../db/migrations-local");

/** Files in memory, keyed like the shell's: one per (bucket, path). */
class FakeFiles implements LocalFiles {
  stored = new Map<string, Uint8Array>();
  failWrites = false;

  async read(bucket: string, p: string): Promise<Uint8Array | null> {
    return this.stored.get(`${bucket}\0${p}`) ?? null;
  }
  async write(bucket: string, p: string, bytes: Uint8Array): Promise<void> {
    if (this.failWrites) throw new Error("disk full");
    this.stored.set(`${bucket}\0${p}`, bytes.slice());
  }
  async remove(bucket: string, p: string): Promise<void> {
    this.stored.delete(`${bucket}\0${p}`);
  }
}

async function database(): Promise<LocalQuery> {
  const pg = new PGlite();
  for (const file of ["0006_local_blobs.sql", "0021_local_blobs_on_disk.sql"]) {
    await pg.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  return async (sql, params) => (await pg.query(sql, params as unknown[])).rows;
}

const png = (...b: number[]) => new Blob([new Uint8Array(b)], { type: "image/png" });

describe("the local blob store", () => {
  let run: LocalQuery;
  let files: FakeFiles;

  beforeEach(async () => {
    run = await database();
    files = new FakeFiles();
  });

  it("with files, keeps bytes on disk and only the index in the table", async () => {
    const store = new LocalBlobStore(run, files);
    await store.upload("att", "u/a.png", png(137, 80, 78, 71));
    const [row] = (await run("select bytes, on_disk, content_type from local_blobs", [])) as {
      bytes: string | null;
      on_disk: boolean;
      content_type: string;
    }[];
    assert.deepEqual(row, { bytes: null, on_disk: true, content_type: "image/png" });
    assert.deepEqual([...(await store.fetchBytes("att", "u/a.png"))], [137, 80, 78, 71]);
    const blob = await store.fetchBlob("att", "u/a.png");
    assert.equal(blob.type, "image/png");
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [137, 80, 78, 71]);
    assert.deepEqual(await store.signedUrls("att", ["u/a.png", "nope"], 60), [
      `data:image/png;base64,${readyCore().encodeBase64(new Uint8Array([137, 80, 78, 71]))}`,
      null,
    ]);
  });

  it("overwrites and removes both the row and the file", async () => {
    const store = new LocalBlobStore(run, files);
    await store.upload("att", "x", png(1));
    await store.upload("att", "x", png(2, 3));
    assert.deepEqual([...(await store.fetchBytes("att", "x"))], [2, 3]);
    await store.remove("att", "x");
    assert.equal(files.stored.size, 0);
    await assert.rejects(store.fetchBytes("att", "x"), BlobNotFoundError);
    await store.remove("att", "x"); // removing twice is fine
  });

  it("still reads rows written inline before, and moves one to disk on overwrite", async () => {
    await new LocalBlobStore(run).upload("att", "old", png(9, 8));
    const store = new LocalBlobStore(run, files);
    assert.deepEqual([...(await store.fetchBytes("att", "old"))], [9, 8]);
    const blobs = await store.fetchBlobs("att", ["old", "missing"]);
    assert.deepEqual([...blobs.keys()], ["old"]);
    await store.upload("att", "old", png(7));
    const [row] = (await run("select bytes, on_disk from local_blobs", [])) as { bytes: unknown; on_disk: boolean }[];
    assert.deepEqual(row, { bytes: null, on_disk: true });
    await store.remove("att", "old");
    assert.equal(files.stored.size, 0);
  });

  it("without files, keeps writing inline as before", async () => {
    const store = new LocalBlobStore(run);
    await store.upload("att", "a", png(5));
    const [row] = (await run("select bytes, on_disk from local_blobs", [])) as { bytes: string; on_disk: boolean }[];
    assert.deepEqual(row, { bytes: readyCore().encodeBase64(new Uint8Array([5])), on_disk: false });
    assert.deepEqual([...(await store.fetchBytes("att", "a"))], [5]);
    await store.remove("att", "a");
    await assert.rejects(store.fetchBytes("att", "a"), BlobNotFoundError);
  });

  it("an on-disk row reads as missing when the file is gone or there are no files", async () => {
    await new LocalBlobStore(run, files).upload("att", "a", png(1));
    await assert.rejects(new LocalBlobStore(run).fetchBytes("att", "a"), BlobNotFoundError);
    files.stored.clear();
    await assert.rejects(new LocalBlobStore(run, files).fetchBytes("att", "a"), BlobNotFoundError);
    assert.deepEqual(await new LocalBlobStore(run, files).signedUrls("att", ["a"], 60), [null]);
  });

  it("a failed file write leaves no row", async () => {
    files.failWrites = true;
    await assert.rejects(new LocalBlobStore(run, files).upload("att", "a", png(1)), /disk full/);
    assert.deepEqual(await run("select path from local_blobs", []), []);
  });

  it("the table refuses a row with neither bytes nor a file", async () => {
    await assert.rejects(run("insert into local_blobs (bucket, path, bytes) values ('b', 'p', null)", []));
  });
});
