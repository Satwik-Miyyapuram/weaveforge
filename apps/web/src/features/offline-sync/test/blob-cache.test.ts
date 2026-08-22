import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localSqlDb, type LocalSqlDb } from "./local-sql";
import { BlobCache } from "../domain/blob-cache";
import { OfflineScope } from "../domain/offline-scope";

/** A storage that only remembers what it was asked to delete. */
function storage() {
  const removed: string[] = [];
  return { removed, remove: async (path: string) => void removed.push(path) };
}

const PROJECT = "00000000-0000-4000-8000-0000000f0001";
const OTHER = "00000000-0000-4000-8000-0000000f0002";

async function cache(quota: number): Promise<{
  db: LocalSqlDb;
  cache: BlobCache;
  scope: OfflineScope;
  removed: string[];
}> {
  const db = await localSqlDb();
  const store = storage();
  return { db, cache: new BlobCache(db, store, quota), scope: new OfflineScope(db), removed: store.removed };
}

describe("the offline blob cache", () => {
  it("keeps one row per file and reports what the device is spending", async () => {
    const { db, cache: blobs } = await cache(1000);
    await blobs.store("a.pdf", PROJECT, 300);
    await blobs.store("a.pdf", PROJECT, 400);
    await blobs.store("b.pdf", PROJECT, 100);

    assert.deepEqual(await blobs.usage(), { bytes: 500, files: 2, quota: 1000 });
    await db.close();
  });

  it("evicts the least recently used file until it is back under quota", async () => {
    const { db, cache: blobs, scope, removed } = await cache(500);
    await scope.enable(PROJECT);
    await blobs.store("old.pdf", PROJECT, 300);
    await blobs.store("new.pdf", PROJECT, 300);
    // Reading the older one makes the newer one the oldest use.
    await blobs.touch("old.pdf");

    const dropped = await blobs.evict();

    assert.deepEqual(
      dropped.map((blob) => blob.path),
      ["new.pdf"],
    );
    assert.deepEqual(removed, ["new.pdf"]);
    assert.equal((await blobs.usage()).bytes, 300);
    await db.close();
  });

  it("drops a switched-off project's files even with room to spare", async () => {
    const { db, cache: blobs, scope, removed } = await cache(10_000);
    await scope.enable(PROJECT);
    await blobs.store("kept.pdf", PROJECT, 100);
    await blobs.store("released.pdf", OTHER, 100);

    const dropped = await blobs.evict();

    assert.deepEqual(
      dropped.map((blob) => blob.path),
      ["released.pdf"],
    );
    assert.deepEqual(removed, ["released.pdf"]);
    await db.close();
  });

  it("leaves a file with no project alone: nothing claims it and nothing released it", async () => {
    const { db, cache: blobs, removed } = await cache(10_000);
    await blobs.store("loose.pdf", null, 100);

    assert.deepEqual(await blobs.evict(), []);
    assert.deepEqual(removed, []);
    await db.close();
  });

  it("turning a project off releases its files without deleting them first", async () => {
    const { db, cache: blobs, scope, removed } = await cache(10_000);
    await scope.enable(PROJECT);
    await blobs.store("paper.pdf", PROJECT, 100);
    await scope.disable(PROJECT);

    assert.deepEqual(await scope.list(), []);
    // Still on disk until a sweep says otherwise.
    assert.deepEqual(removed, []);
    assert.equal((await blobs.usage()).files, 1);
    await db.close();
  });
});
