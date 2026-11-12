import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { LocalFiles } from "@/backend/providers/local/parts-1";
import { localVectorStore } from "@/features/search/infrastructure/vector-store";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../db/migrations-local");

async function database() {
  const pg = new PGlite();
  for (const file of ["0006_local_blobs.sql", "0021_local_blobs_on_disk.sql"]) {
    await pg.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  return async (sql: string, params: unknown[]) => (await pg.query(sql, params)).rows;
}

function fakeFiles() {
  const stored = new Map<string, Uint8Array>();
  const files: LocalFiles = {
    read: async (b, p) => stored.get(`${b}/${p}`) ?? null,
    write: async (b, p, bytes) => void stored.set(`${b}/${p}`, bytes.slice()),
    remove: async (b, p) => void stored.delete(`${b}/${p}`),
  };
  return { stored, files };
}

const value = (n: number) => ({ model: "m", dimensions: 2, bytes: new Uint8Array(Float32Array.from([n, n + 1]).buffer), revision: "r" });
const floats = (v: { bytes: Uint8Array } | null) => (v ? [...new Float32Array(v.bytes.slice().buffer)] : null);

test("with files, vectors go to a file and the row is only an index", async () => {
  const run = await database();
  const { stored, files } = fakeFiles();
  const store = localVectorStore(run, files);
  await store.set("p1", value(1));
  await store.set(null, value(5));
  assert.deepEqual(await run("select path, bytes, on_disk from local_blobs order by path", []), [
    { path: "-", bytes: null, on_disk: true },
    { path: "p1", bytes: null, on_disk: true },
  ]);
  assert.deepEqual(floats(await store.get("p1")), [1, 2]);
  assert.deepEqual(floats(await store.get(null)), [5, 6]);
  assert.equal(await store.get("nope"), null);
  await store.clear();
  assert.equal(stored.size, 0);
  assert.equal(await store.get("p1"), null);
});

test("vectors stored inline before are still read, and rewritten to a file", async () => {
  const run = await database();
  await localVectorStore(run).set("p1", value(3));
  const { stored, files } = fakeFiles();
  const store = localVectorStore(run, files);
  assert.deepEqual(floats(await store.get("p1")), [3, 4]);
  await store.set("p1", value(7));
  assert.equal(stored.size, 1);
  assert.deepEqual(floats(await store.get("p1")), [7, 8]);
});

test("an on-disk row with no file reads as nothing to restore", async () => {
  const run = await database();
  const { stored, files } = fakeFiles();
  await localVectorStore(run, files).set("p1", value(1));
  stored.clear();
  assert.equal(await localVectorStore(run, files).get("p1"), null);
  assert.equal(await localVectorStore(run).get("p1"), null);
});
